package com.neil.steady;

import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;
import java.net.URI;

@CapacitorPlugin(name = "SteadyBackgroundHealth", permissions = {
    @Permission(alias = "backgroundHealth", strings = {"android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"})
})
public class SteadyBackgroundHealthPlugin extends Plugin {
    static final String PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND";
    private boolean available() {
        if (Build.VERSION.SDK_INT < 35) return false;
        try { getContext().getPackageManager().getPermissionInfo(PERMISSION, 0); return true; }
        catch (PackageManager.NameNotFoundException e) { return false; }
    }
    private boolean granted() { return available() && getContext().checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED; }
    @PluginMethod public void status(PluginCall call) {
        try {
            JSONObject state = BackgroundHealthStore.read(getContext());
            call.resolve(new JSObject().put("available", available()).put("granted", granted()).put("enabled", state.optBoolean("enabled"))
                .put("lastChecked", state.optString("lastChecked")).put("lastUploaded", state.optString("lastUploaded")).put("message", state.optString("message")));
        } catch (Exception e) { call.reject("Could not read background sync settings."); }
    }
    @PluginMethod public void enable(PluginCall call) {
        if (!available()) { call.reject("Background health access needs a supported Android 15 or later device."); return; }
        if (granted()) { finishEnable(call); return; }
        requestPermissionForAlias("backgroundHealth", call, "permissionResult");
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        if (granted()) finishEnable(call);
        else call.reject("Background access was not granted. Enable it in Health Connect → Steady → Additional access.");
    }
    private void finishEnable(PluginCall call) {
        try {
            synchronized (BackgroundHealthStore.LOCK) { JSONObject state = BackgroundHealthStore.read(getContext()); state.put("enabled", true).put("message", "Background checks enabled."); BackgroundHealthStore.write(getContext(), state); }
            BackgroundHealthWorker.schedule(getContext()); call.resolve();
        } catch (Exception e) { call.reject("Could not enable background checks."); }
    }
    @PluginMethod public void disable(PluginCall call) {
        try {
            synchronized (BackgroundHealthStore.LOCK) { JSONObject state = BackgroundHealthStore.read(getContext()); state.put("enabled", false).remove("config"); BackgroundHealthStore.write(getContext(), state); }
            BackgroundHealthWorker.cancel(getContext()); call.resolve();
        } catch (Exception e) { call.reject("Could not disable background checks."); }
    }
    @PluginMethod public void clear(PluginCall call) {
        try { BackgroundHealthWorker.cancel(getContext()); synchronized (BackgroundHealthStore.LOCK) { JSONObject old = BackgroundHealthStore.read(getContext()); BackgroundHealthStore.write(getContext(), new JSONObject().put("auth", old.optJSONObject("auth"))); } call.resolve(); }
        catch (Exception e) { call.reject("Could not clear background settings."); }
    }
    @PluginMethod public void authGet(PluginCall call) {
        try { JSONObject auth = BackgroundHealthStore.read(getContext()).optJSONObject("auth"); String key = call.getString("key", ""); call.resolve(new JSObject().put("value", auth == null || !auth.has(key) ? JSONObject.NULL : auth.getString(key))); }
        catch (Exception e) { call.reject("Could not read the saved sign-in."); }
    }
    @PluginMethod public void authSet(PluginCall call) {
        try { synchronized (BackgroundHealthStore.LOCK) {
            String key = call.getString("key", ""), value = call.getString("value", "");
            if (key.length() > 200 || value.length() > 150000) throw new Exception();
            JSONObject state = BackgroundHealthStore.read(getContext()), auth = state.optJSONObject("auth"); if (auth == null) auth = new JSONObject();
            if (key.endsWith("-auth-token") && auth.has(key)) {
                JSONObject previous = new JSONObject(auth.getString(key)), next = new JSONObject(value);
                if (previous.optJSONObject("user") != null && next.optJSONObject("user") != null && previous.getJSONObject("user").optString("id").equals(next.getJSONObject("user").optString("id")) && previous.optLong("expires_at") > next.optLong("expires_at")) { call.resolve(); return; }
            }
            auth.put(key, value); state.put("auth", auth); BackgroundHealthStore.write(getContext(), state);
        } call.resolve(); } catch (Exception e) { call.reject("Could not save the sign-in."); }
    }
    @PluginMethod public void authRemove(PluginCall call) {
        try { synchronized (BackgroundHealthStore.LOCK) {
            JSONObject state = BackgroundHealthStore.read(getContext()), auth = state.optJSONObject("auth"); if (auth != null) auth.remove(call.getString("key", ""));
            state.put("auth", auth); if (call.getString("key", "").endsWith("-auth-token")) state.remove("config"); BackgroundHealthStore.write(getContext(), state);
        } call.resolve(); } catch (Exception e) { call.reject("Could not remove the saved sign-in."); }
    }
    @PluginMethod public void configure(PluginCall call) {
        try {
            JSONObject config = call.getObject("config", new JSObject());
            String mode = config.optString("mode", "off");
            if (!mode.equals("off") && !mode.equals("cloud") && !mode.equals("local")) throw new Exception();
            if (!mode.equals("off")) {
                URI uri = new URI(config.getString("url"));
                boolean localHttp = mode.equals("local") && "http".equals(uri.getScheme()) && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()));
                if ((!"https".equals(uri.getScheme()) && !localHttp) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || (!uri.getPath().isEmpty() && !uri.getPath().equals("/"))) throw new Exception();
            }
            synchronized (BackgroundHealthStore.LOCK) {
                JSONObject state = BackgroundHealthStore.read(getContext()), old = state.optJSONObject("config");
                // Do not overwrite a token refreshed by the worker with an older webview session.
                if (mode.equals("cloud") && old != null && config.optString("userId").equals(old.optString("userId")) && config.optString("url").equals(old.optString("url")) && old.optLong("expiresAt") > config.optLong("expiresAt")) {
                    config.put("accessToken", old.optString("accessToken")).put("refreshToken", old.optString("refreshToken")).put("expiresAt", old.optLong("expiresAt"));
                }
                state.put("config", config); BackgroundHealthStore.write(getContext(), state);
            }
            call.resolve();
        } catch (Exception e) { call.reject("Could not configure background sync."); }
    }
    @PluginMethod public void snapshot(PluginCall call) {
        try {
            JSONObject state = BackgroundHealthStore.read(getContext()), config = state.optJSONObject("config");
            JSObject result = new JSObject().put("records", state.optJSONArray("records")).put("lastChecked", state.optString("lastChecked"));
            if (config != null && config.optString("mode").equals("cloud")) result.put("session", new JSONObject().put("userId", config.optString("userId")).put("url", config.optString("url")).put("accessToken", config.optString("accessToken")).put("refreshToken", config.optString("refreshToken")).put("expiresAt", config.optLong("expiresAt")));
            call.resolve(result);
        } catch (Exception e) { call.reject("Could not load background activity."); }
    }
}
