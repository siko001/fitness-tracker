package com.neil.steady;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.LinkedHashSet;
import java.util.Set;

/** One rolling alarm per meal; no webview, network or foreground service required. */
final class MealReminderEngine {
    static final String[] MEALS = { "Breakfast", "Lunch", "Dinner" };
    static final String CHANNEL = "steady-meals";
    static final long INTERVAL = 20 * 60_000L;
    private static SharedPreferences store(Context context) { return context.getSharedPreferences("steady-meal-reminders", Context.MODE_PRIVATE); }
    private static String key(String date, String meal) { return date + ":" + meal; }
    private static Set<String> readSet(Context c, String name) { return new LinkedHashSet<>(store(c).getStringSet(name, new LinkedHashSet<>())); }
    private static Set<String> rows(JSONArray rows) throws JSONException {
        Set<String> result = new LinkedHashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String date = row.getString("date"), meal = row.getString("meal");
            LocalDate.parse(date);
            if (index(meal) < 0 && !"Snacks".equals(meal)) throw new IllegalArgumentException("Invalid meal");
            result.add(key(date, meal));
        }
        return result;
    }
    static int index(String meal) { for (int i = 0; i < MEALS.length; i++) if (MEALS[i].equals(meal)) return i; return -1; }
    static synchronized void configure(Context c, JSONObject settings, JSONArray logged, JSONArray skipped) throws JSONException {
        for (String field : new String[]{"breakfast", "lunch", "dinner", "quietStart"}) LocalTime.parse(settings.getString(field));
        Set<String> logKeys = rows(logged), skipKeys = rows(skipped);
        store(c).edit().putString("settings", settings.toString()).putStringSet("logged", logKeys).putStringSet("skipped", skipKeys).commit();
        scheduleAll(c);
    }
    private static JSONObject settings(Context c) {
        try { return new JSONObject(store(c).getString("settings", "{}")); } catch (JSONException e) { return new JSONObject(); }
    }
    private static boolean answered(Context c, JSONObject config, String date, String meal) {
        Set<String> all = readSet(c, "logged"); all.addAll(readSet(c, "skipped")); all.addAll(readSet(c, "pendingSkips"));
        if ("daily".equals(config.optString("mode"))) return all.stream().anyMatch(k -> k.startsWith(date + ":"));
        return all.contains(key(date, meal));
    }
    private static PendingIntent alarm(Context c, int meal) {
        Intent intent = new Intent(c, MealReminderReceiver.class).setAction("steady.MEAL_DUE").putExtra("meal", MEALS[meal]);
        return PendingIntent.getBroadcast(c, 700 + meal, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static ZonedDateTime start(JSONObject config, LocalDate date, int meal) {
        String field = new String[]{"breakfast", "lunch", "dinner"}[meal];
        return date.atTime(LocalTime.parse(config.optString(field, new String[]{"10:00", "14:00", "21:00"}[meal]))).atZone(ZoneId.systemDefault());
    }
    private static ZonedDateTime stop(JSONObject config, LocalDate date) {
        LocalTime quiet = LocalTime.parse(config.optString("quietStart", "23:00"));
        return (quiet.equals(LocalTime.MIDNIGHT) ? date.plusDays(1) : date).atTime(quiet).atZone(ZoneId.systemDefault());
    }
    private static boolean enabled(JSONObject config, int meal) {
        return config.optBoolean("enabled") && (!"daily".equals(config.optString("mode")) || meal == 2);
    }
    static synchronized void scheduleAll(Context c) {
        for (int i = 0; i < MEALS.length; i++) schedule(c, i);
    }
    private static void schedule(Context c, int meal) {
        AlarmManager alarms = (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
        NotificationManager notifications = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        alarms.cancel(alarm(c, meal));
        JSONObject config = settings(c);
        LocalDate today = LocalDate.now();
        if (!enabled(config, meal) || answered(c, config, today.toString(), MEALS[meal])) notifications.cancel(900 + meal);
        if (!enabled(config, meal) || !notifications.areNotificationsEnabled()) return;
        long now = System.currentTimeMillis();
        long last = store(c).getLong("last-" + MEALS[meal], 0);
        for (int offset = 0; offset < 3; offset++) {
            LocalDate date = today.plusDays(offset);
            if (answered(c, config, date.toString(), MEALS[meal])) continue;
            long first = start(config, date, meal).toInstant().toEpochMilli();
            long end = stop(config, date).toInstant().toEpochMilli();
            long next = first > now ? first : first + ((now - first) / INTERVAL + 1) * INTERVAL;
            if (offset == 0 && last > 0) next = Math.max(next, last + INTERVAL);
            if (next < end) {
                // Inexact alarms respect battery policy; never claim exact 20-minute delivery.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm(c, meal));
                return;
            }
        }
    }
    static synchronized void fire(Context c, String meal) {
        int i = index(meal); if (i < 0) return;
        JSONObject config = settings(c); LocalDate today = LocalDate.now(); long now = System.currentTimeMillis();
        if (enabled(config, i) && now >= start(config, today, i).toInstant().toEpochMilli() && now < stop(config, today).toInstant().toEpochMilli()
                && !answered(c, config, today.toString(), meal) && now - store(c).getLong("last-" + meal, 0) >= INTERVAL - 1000) {
            NotificationManager manager = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Food diary reminders", NotificationManager.IMPORTANCE_DEFAULT));
            Intent log = new Intent(c, MainActivity.class).setAction("steady.OPEN_MEAL").putExtra("steadyDate", today.toString()).putExtra("steadyMeal", meal)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent open = PendingIntent.getActivity(c, 1000 + i, log, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Intent skip = new Intent(c, MealReminderReceiver.class).setAction("steady.SKIP_MEAL").putExtra("date", today.toString()).putExtra("meal", meal);
            PendingIntent skipAction = PendingIntent.getBroadcast(c, 1100 + i, skip, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                manager.notify(900 + i, new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_steady)
                    .setContentTitle(meal + " check-in").setContentText("Log what you ate, or skip this meal today.")
                    .setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .addAction(0, "Log meal", open).addAction(0, "Skip today", skipAction).build());
                store(c).edit().putLong("last-" + meal, now).commit();
            }
        }
        schedule(c, i);
    }
    static synchronized void skip(Context c, String date, String meal) {
        try { LocalDate.parse(date); } catch (Exception e) { return; }
        int i = index(meal); if (i < 0) return;
        Set<String> pending = readSet(c, "pendingSkips"); pending.add(key(date, meal));
        store(c).edit().putStringSet("pendingSkips", pending).commit();
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(900 + i);
        schedule(c, i);
    }
    static synchronized JSONArray pendingSkips(Context c) throws JSONException {
        JSONArray result = new JSONArray();
        for (String k : readSet(c, "pendingSkips")) {
            int colon = k.indexOf(':');
            result.put(new JSONObject().put("date", k.substring(0, colon)).put("meal", k.substring(colon + 1)));
        }
        return result;
    }
    static synchronized void acknowledge(Context c, JSONArray rows) throws JSONException {
        Set<String> pending = readSet(c, "pendingSkips"); pending.removeAll(rows(rows));
        store(c).edit().putStringSet("pendingSkips", pending).commit();
    }
    static synchronized void captureOpen(Context c, Intent intent) {
        if (intent == null || !"steady.OPEN_MEAL".equals(intent.getAction())) return;
        String date = intent.getStringExtra("steadyDate"), meal = intent.getStringExtra("steadyMeal");
        try { LocalDate.parse(date); } catch (Exception e) { return; }
        if (index(meal) < 0) return;
        store(c).edit().putString("openDate", date).putString("openMeal", meal).commit();
        intent.setAction(Intent.ACTION_MAIN);
    }
    static synchronized JSONObject consumeOpen(Context c) throws JSONException {
        SharedPreferences s = store(c); JSONObject result = new JSONObject();
        if (s.contains("openDate")) result.put("date", s.getString("openDate", "")).put("meal", s.getString("openMeal", ""));
        s.edit().remove("openDate").remove("openMeal").commit(); return result;
    }
    static synchronized void clear(Context c) {
        store(c).edit().clear().commit();
        scheduleAll(c);
    }
}
