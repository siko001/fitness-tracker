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
import androidx.core.app.RemoteInput;
import android.os.Bundle;
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
    static synchronized void configure(Context c, JSONObject settings, JSONArray logged, JSONArray skipped, JSONObject quickMeals) throws JSONException {
        for (String field : new String[]{"breakfast", "lunch", "dinner", "quietStart"}) LocalTime.parse(settings.getString(field));
        Set<String> logKeys = rows(logged), skipKeys = rows(skipped);
        store(c).edit().putString("settings", settings.toString()).putStringSet("logged", logKeys).putStringSet("skipped", skipKeys).putString("quickMeals", quickMeals.toString()).commit();
        scheduleAll(c);
    }
    private static JSONObject settings(Context c) {
        try { return new JSONObject(store(c).getString("settings", "{}")); } catch (JSONException e) { return new JSONObject(); }
    }
    private static boolean answered(Context c, JSONObject config, String date, String meal) {
        Set<String> all = readSet(c, "logged"); all.addAll(readSet(c, "skipped")); all.addAll(readSet(c, "pendingSkips"));
        try { JSONArray pending = pendingEntries(c); for (int i = 0; i < pending.length(); i++) { JSONObject entry = pending.getJSONObject(i); all.add(key(entry.getString("date"), entry.getString("meal"))); } } catch (JSONException ignored) {}
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
            show(c, meal, false);
            store(c).edit().putLong("last-" + meal, now).commit();
        }
        schedule(c, i);
    }
    static final String REPLY_KEY = "steadyMealReply";
    static synchronized void show(Context c, String meal, boolean test) {
        int i = index(meal); if (i < 0) return;
        String date = LocalDate.now().toString();
        int id = test ? 42 : 900 + i;
        NotificationManager manager = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Food diary reminders", NotificationManager.IMPORTANCE_DEFAULT));
        Intent log = new Intent(c, MainActivity.class).setAction("steady.OPEN_MEAL").putExtra("steadyDate", date).putExtra("steadyMeal", meal)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(c, 1000 + id, log, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent skip = new Intent(c, MealReminderReceiver.class).setAction("steady.SKIP_MEAL").putExtra("date", date).putExtra("meal", meal).putExtra("test", test);
        PendingIntent skipAction = PendingIntent.getBroadcast(c, 1100 + id, skip, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        JSONArray options = new JSONArray();
        try { options = new JSONObject(store(c).getString("quickMeals", "{}")).optJSONArray(meal); } catch (JSONException ignored) {}
        if (options == null) options = new JSONArray();
        CharSequence[] choices = new CharSequence[Math.min(options.length(), 3) + 1]; choices[0] = "Skip today";
        for (int n = 0; n < choices.length - 1; n++) choices[n + 1] = MealQuickReply.label(options.optJSONObject(n), n);
        // Store snapshot privately; a mutable RemoteInput intent carries only a nonce.
        String nonce = java.util.UUID.randomUUID().toString();
        try { store(c).edit().putString("reply-" + id, new JSONObject().put("nonce", nonce).put("date", date).put("meal", meal).put("test", test).put("options", options).toString()).commit(); } catch (JSONException ignored) { return; }
        Intent reply = new Intent(c, MealReminderReceiver.class).setAction("steady.REPLY_MEAL").putExtra("notificationId", id).putExtra("nonce", nonce);
        PendingIntent answer = PendingIntent.getBroadcast(c, 1200 + id, reply, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        RemoteInput input = new RemoteInput.Builder(REPLY_KEY).setLabel("Choose a saved meal or skip").setChoices(choices).setAllowFreeFormInput(true).build();
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(R.drawable.ic_stat_steady, "Choose meal / skip", answer)
            .addRemoteInput(input).setAllowGeneratedReplies(false).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false).build();
        NotificationCompat.Action skipButton = new NotificationCompat.Action.Builder(R.drawable.ic_stat_steady, "Skip today", skipAction).setShowsUserInterface(false).build();
        if (android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            manager.notify(id, new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_steady)
                .setContentTitle(test ? "Steady watch action test" : meal + " check-in")
                .setContentText(test ? "Try Reply → Skip today. This test will not change your diary." : "Choose a saved meal, log on your phone, or skip today.")
                .setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(NotificationCompat.CATEGORY_REMINDER).setLocalOnly(false)
                .addAction(replyAction).addAction(0, "Log on phone", open).addAction(skipButton)
                .extend(new NotificationCompat.WearableExtender().addAction(replyAction).addAction(skipButton)).build());
        }
    }
    static synchronized void test(Context c) {
        Intent intent = new Intent(c, MealReminderReceiver.class).setAction("steady.MEAL_TEST");
        PendingIntent pending = PendingIntent.getBroadcast(c, 42, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 5000, pending);
    }
    static synchronized void testResult(Context c) {
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(42, new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_steady)
            .setContentTitle("Watch action received").setContentText("Your reply worked. No food was logged or skipped.").setAutoCancel(true).build());
    }
    static synchronized void reply(Context c, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) return;
        CharSequence raw = results.getCharSequence(REPLY_KEY); if (raw == null || raw.length() > 200) return;
        int id = intent.getIntExtra("notificationId", -1);
        try {
            JSONObject saved = new JSONObject(store(c).getString("reply-" + id, "{}"));
            if (!saved.getString("nonce").equals(intent.getStringExtra("nonce"))) return;
            String date = saved.getString("date"), meal = saved.getString("meal"), reply = raw.toString().trim();
            if (!date.equals(LocalDate.now().toString())) return;
            JSONObject entry = MealQuickReply.resolve(reply, saved.getJSONArray("options"), date, meal, LocalDate.now(), LocalTime.now());
            boolean skip = "skip today".equalsIgnoreCase(reply) || "skip".equalsIgnoreCase(reply);
            if (!skip && entry == null) return; // Unknown text never creates or skips a meal.
            if (saved.optBoolean("test")) { store(c).edit().remove("reply-" + id).commit(); testResult(c); return; }
            if (answered(c, settings(c), date, meal)) return;
            store(c).edit().remove("reply-" + id).commit();
            if (skip) { skip(c, date, meal); return; }
            JSONArray pending = pendingEntries(c); pending.put(entry);
            store(c).edit().putString("pendingEntries", pending.toString()).commit();
            ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
            scheduleAll(c);
        } catch (Exception ignored) { /* Bad or stale notification input cannot mutate the diary. */ }
    }
    static synchronized JSONArray pendingEntries(Context c) throws JSONException { return new JSONArray(store(c).getString("pendingEntries", "[]")); }
    static synchronized void acknowledgeEntries(Context c, JSONArray ids) throws JSONException {
        Set<String> done = new LinkedHashSet<>(); for (int i = 0; i < ids.length(); i++) done.add(ids.getString(i));
        JSONArray next = new JSONArray(), pending = pendingEntries(c);
        for (int i = 0; i < pending.length(); i++) { JSONObject entry = pending.getJSONObject(i); if (!done.contains(entry.getString("id"))) next.put(entry); }
        store(c).edit().putString("pendingEntries", next.toString()).commit();
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
        Intent intent = new Intent(c, MealReminderReceiver.class).setAction("steady.MEAL_TEST");
        PendingIntent test = PendingIntent.getBroadcast(c, 42, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).cancel(test);
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(42);
        scheduleAll(c);
    }
}
