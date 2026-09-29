package com.neil.steady;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.AggregateRecordsResponse;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.ActiveCaloriesBurnedRecord;
import android.health.connect.datatypes.AggregationType;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.units.Energy;
import android.health.connect.datatypes.units.Length;
import android.os.Build;
import android.os.OutcomeReceiver;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public final class BackgroundHealthWorker extends Worker {
    private static final String TAG = "steady-background-health";
    public BackgroundHealthWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    static void schedule(Context context) {
        WorkManager manager = WorkManager.getInstance(context);
        manager.enqueueUniquePeriodicWork(TAG, ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(BackgroundHealthWorker.class, 15, TimeUnit.MINUTES).addTag(TAG).build());
    }
    static void cancel(Context context) { WorkManager.getInstance(context).cancelAllWorkByTag(TAG); }
    private static void uploadWhenOnline(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork(TAG + "-upload", ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(BackgroundHealthWorker.class).setInputData(new Data.Builder().putBoolean("uploadOnly", true).build())
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).addTag(TAG).build());
    }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        try {
            JSONObject state = BackgroundHealthStore.read(context);
            if (!state.optBoolean("enabled") || Build.VERSION.SDK_INT < 35) return Result.success();
            if (context.checkSelfPermission(SteadyBackgroundHealthPlugin.PERMISSION) != PackageManager.PERMISSION_GRANTED) { message("Background health permission is off. Enable it in Health Connect."); return Result.success(); }
            if (!getInputData().getBoolean("uploadOnly", false)) {
                JSONArray records = new JSONArray(); String today = LocalDate.now().toString(), now = Instant.now().toString();
                int days = today.equals(state.optString("lastDay")) ? 2 : 7;
                boolean incomplete = false;
                for (int i = days - 1; i >= 0; i--) {
                    if (isStopped()) return Result.success();
                    LocalDate date = LocalDate.now().minusDays(i);
                    // Full local-day boundaries preserve Zepp's already-recorded interval totals.
                    TimeInstantRangeFilter range = new TimeInstantRangeFilter.Builder().setStartTime(date.atStartOfDay(ZoneId.systemDefault()).toInstant())
                        .setEndTime(date.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant()).build();
                    Long steps = null; Energy energy = null; Length distance = null; boolean stepsChecked = false;
                    try { if (canRead("STEPS")) { steps = aggregate(context, range, StepsRecord.STEPS_COUNT_TOTAL); stepsChecked = true; } else incomplete = true; } catch (Exception e) { incomplete = true; }
                    try { if (canRead("ACTIVE_CALORIES_BURNED")) energy = aggregate(context, range, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL); else incomplete = true; } catch (Exception e) { incomplete = true; }
                    try { if (canRead("DISTANCE")) distance = aggregate(context, range, DistanceRecord.DISTANCE_TOTAL); else incomplete = true; } catch (Exception e) { incomplete = true; }
                    if (stepsChecked || steps != null || energy != null || distance != null) records.put(new JSONObject().put("date", date.toString()).put("source", "health").put("updatedAt", now)
                        .put("stepSource", "zepp").put("steps", steps == null ? JSONObject.NULL : steps).put("activeKcal", energy == null ? JSONObject.NULL : energy.getInCalories() / 1000)
                        .put("distanceKm", distance == null ? JSONObject.NULL : distance.getInMeters() / 1000));
                }
                synchronized (BackgroundHealthStore.LOCK) {
                    state = BackgroundHealthStore.read(context); if (!state.optBoolean("enabled") || isStopped()) return Result.success();
                    if (records.length() > 0) {
                        JSONObject merged = HealthSnapshotMerge.merge(new JSONObject().put("activities", state.optJSONArray("records")), records, now);
                        JSONArray retained = new JSONArray(), all = merged.getJSONArray("activities");
                        for (int i = 0; i < all.length(); i++) if (all.getJSONObject(i).getString("date").compareTo(LocalDate.now().minusDays(30).toString()) >= 0) retained.put(all.getJSONObject(i));
                        state.put("records", retained).put("lastChecked", now).put("lastDay", today);
                    }
                    state.put("message", incomplete ? "Activity checked; some health measurements were unavailable." : records.length() > 0 ? "Activity saved on this phone." : "Waiting for activity from Health Connect.");
                    BackgroundHealthStore.write(context, state);
                }
            }
            boolean synced = upload();
            if (!synced && !getInputData().getBoolean("uploadOnly", false)) uploadWhenOnline(context);
            return synced || !getInputData().getBoolean("uploadOnly", false) ? Result.success() : getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        } catch (Exception e) { message("Background check could not finish. It will try again automatically."); return Result.success(); }
    }
    private boolean canRead(String type) { return getApplicationContext().checkSelfPermission("android.permission.health.READ_" + type) == PackageManager.PERMISSION_GRANTED; }
    static <T> T aggregate(Context context, TimeInstantRangeFilter range, AggregationType<T> type) throws Exception {
        CompletableFuture<T> result = new CompletableFuture<>();
        var request = new AggregateRecordsRequest.Builder<T>(range).addAggregationType(type);
        // Neil uses his Amazfit watch as the step source, not the phone counter.
        if (type.equals(StepsRecord.STEPS_COUNT_TOTAL)) request.addDataOriginsFilter(new DataOrigin.Builder().setPackageName("com.huami.watch.hmwatchmanager").build());
        context.getSystemService(HealthConnectManager.class).aggregate(request.build(), Runnable::run,
            new OutcomeReceiver<AggregateRecordsResponse<T>, HealthConnectException>() {
                @Override public void onResult(AggregateRecordsResponse<T> response) { result.complete(response.get(type)); }
                @Override public void onError(HealthConnectException error) { result.completeExceptionally(error); }
            });
        return result.get(15, TimeUnit.SECONDS);
    }
    private void message(String value) {
        try { synchronized (BackgroundHealthStore.LOCK) { JSONObject state = BackgroundHealthStore.read(getApplicationContext()); state.put("message", value); BackgroundHealthStore.write(getApplicationContext(), state); } } catch (Exception ignored) { }
    }
    private boolean current(JSONObject config) throws Exception {
        JSONObject state = BackgroundHealthStore.read(getApplicationContext()), latest = state.optJSONObject("config");
        return !isStopped() && state.optBoolean("enabled") && latest != null && latest.optString("mode").equals(config.optString("mode")) && latest.optString("url").equals(config.optString("url")) && latest.optString("userId").equals(config.optString("userId")) && latest.optString("key").equals(config.optString("key"));
    }
    private boolean upload() throws Exception {
        Context context = getApplicationContext(); JSONObject state = BackgroundHealthStore.read(context), config = state.optJSONObject("config");
        JSONArray records = state.optJSONArray("records");
        if (config == null || "off".equals(config.optString("mode")) || records == null || records.length() == 0) return true;
        boolean cloud = "cloud".equals(config.optString("mode"));
        try {
            if (cloud) {
                synchronized (BackgroundHealthStore.LOCK) {
                    state = BackgroundHealthStore.read(context); if (!current(config)) return true;
                    config = state.getJSONObject("config");
                    if (config.optLong("expiresAt") < Instant.now().getEpochSecond() + 120) {
                        HttpResult refresh = request(config, "/auth/v1/token?grant_type=refresh_token", new JSONObject().put("refresh_token", config.getString("refreshToken")), false);
                        if (refresh.status != 200) { message("Sign in again on the phone to resume background sync."); return true; }
                        JSONObject session = new JSONObject(refresh.text);
                        if (!session.getJSONObject("user").getString("id").equals(config.getString("userId"))) throw new Exception();
                        long expires = session.optLong("expires_at", Instant.now().getEpochSecond() + session.getLong("expires_in"));
                        session.put("expires_at", expires);
                        config.put("accessToken", session.getString("access_token")).put("refreshToken", session.getString("refresh_token")).put("expiresAt", expires);
                        // Supabase's webview client uses this same native auth storage.
                        // Reopening the app therefore starts with the refreshed session,
                        // not an obsolete refresh token which could revoke the session.
                        JSONObject auth = state.optJSONObject("auth");
                        if (auth != null) { var keys = auth.keys(); while (keys.hasNext()) { String key = keys.next(); if (!key.endsWith("-auth-token")) continue; JSONObject saved = new JSONObject(auth.getString(key)); if (saved.optJSONObject("user") != null && config.getString("userId").equals(saved.getJSONObject("user").optString("id"))) auth.put(key, session.toString()); } }
                        state.put("config", config); BackgroundHealthStore.write(context, state);
                    }
                }
            }
            for (int attempt = 0; attempt < 3; attempt++) {
                if (!current(config)) return true;
                String path = cloud ? "/rest/v1/diaries?select=revision,payload&user_id=eq." + config.getString("userId") : "/api/diary";
                HttpResult read = request(config, path, null, cloud);
                if (read.status != 200) throw new Exception();
                JSONObject remote;
                if (cloud) { JSONArray list = new JSONArray(read.text); if (list.length() == 0) { message("Open Steady and sync your diary once to finish background setup."); return true; } remote = list.getJSONObject(0); }
                else remote = new JSONObject(read.text);
                if (remote.isNull("payload")) { message("Open Steady and sync your diary once to finish background setup."); return true; }
                JSONObject payload = HealthSnapshotMerge.merge(remote.getJSONObject("payload"), records, state.optString("lastChecked"));
                if (!current(config)) return true;
                JSONObject body = cloud ? new JSONObject().put("expected_revision", remote.getLong("revision")).put("next_payload", payload) : new JSONObject().put("expectedRevision", remote.getLong("revision")).put("payload", payload);
                HttpResult saved = request(config, cloud ? "/rest/v1/rpc/save_diary" : "/api/diary", body, cloud);
                if (saved.status == 409 || cloud && saved.status == 200 && "null".equals(saved.text.trim())) continue;
                if (saved.status < 200 || saved.status >= 300) throw new Exception();
                synchronized (BackgroundHealthStore.LOCK) { if (!current(config)) return true; JSONObject latest = BackgroundHealthStore.read(context); latest.put("lastUploaded", Instant.now().toString()).put("message", "Activity synced in the background."); BackgroundHealthStore.write(context, latest); }
                return true;
            }
        } catch (Exception ignored) { }
        message("Activity saved on phone. Waiting to sync with your server."); return false;
    }
    private record HttpResult(int status, String text) { }
    private HttpResult request(JSONObject config, String path, JSONObject body, boolean auth) throws Exception {
        String base = config.getString("url").replaceAll("/+$", "");
        HttpURLConnection connection = (HttpURLConnection) URI.create(base + path).toURL().openConnection();
        connection.setConnectTimeout(12000); connection.setReadTimeout(12000); connection.setInstanceFollowRedirects(false);
        boolean cloud = "cloud".equals(config.optString("mode"));
        if (cloud) connection.setRequestProperty("apikey", config.getString("key"));
        if (auth || !cloud) connection.setRequestProperty("Authorization", "Bearer " + (cloud ? config.getString("accessToken") : config.getString("key")));
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) { connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (var out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
            int status = connection.getResponseCode();
            try (InputStream input = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (input != null) { byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) { if (out.size() + n > 20_000_000) throw new Exception(); out.write(buffer, 0, n); } }
                return new HttpResult(status, out.toString(StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }
}
