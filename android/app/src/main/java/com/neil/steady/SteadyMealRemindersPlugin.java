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
            MealReminderEngine.configure(getContext(), settings, call.getArray("logged", new JSArray()), call.getArray("skipped", new JSArray()), call.getObject("quickMeals", new JSObject()));
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
    @PluginMethod public void test(PluginCall call) { MealReminderEngine.test(getContext()); call.resolve(); }
    @PluginMethod public void pendingEntries(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("entries", MealReminderEngine.pendingEntries(getContext())); call.resolve(result); }
        catch (Exception e) { call.reject("Could not read watch meals", e); }
    }
    @PluginMethod public void acknowledgeEntries(PluginCall call) {
        try { MealReminderEngine.acknowledgeEntries(getContext(), call.getArray("ids", new JSArray())); call.resolve(); }
        catch (Exception e) { call.reject("Could not confirm watch meals", e); }
    }
    @PluginMethod public void clear(PluginCall call) {
        MealReminderEngine.clear(getContext()); call.resolve();
    }
}
