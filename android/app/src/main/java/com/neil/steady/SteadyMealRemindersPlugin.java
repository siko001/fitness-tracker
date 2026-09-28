package com.neil.steady;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SteadyMealReminders")
public class SteadyMealRemindersPlugin extends Plugin {
    @PluginMethod public void configure(PluginCall call) {
        try {
            JSObject settings = call.getObject("settings");
            if (settings == null) throw new IllegalArgumentException("Settings required");
            MealReminderEngine.configure(getContext(), settings, call.getArray("logged", new JSArray()), call.getArray("skipped", new JSArray()));
            call.resolve();
        } catch (Exception e) { call.reject("Could not schedule meal reminders", e); }
    }
    @PluginMethod public void pendingSkips(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("skips", MealReminderEngine.pendingSkips(getContext())); call.resolve(result); }
        catch (Exception e) { call.reject("Could not read skipped meals", e); }
    }
    @PluginMethod public void acknowledgeSkips(PluginCall call) {
        try { MealReminderEngine.acknowledge(getContext(), call.getArray("skips", new JSArray())); call.resolve(); }
        catch (Exception e) { call.reject("Could not confirm skipped meals", e); }
    }
    @PluginMethod public void consumeOpen(PluginCall call) {
        try { call.resolve(new JSObject(MealReminderEngine.consumeOpen(getContext()).toString())); }
        catch (Exception e) { call.reject("Could not open meal", e); }
    }
    @PluginMethod public void clear(PluginCall call) {
        MealReminderEngine.clear(getContext()); call.resolve();
    }
}
