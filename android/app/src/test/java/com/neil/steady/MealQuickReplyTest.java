package com.neil.steady;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.LocalDate;
import java.time.LocalTime;
import static org.junit.Assert.*;

public class MealQuickReplyTest {
    private JSONArray options() throws Exception {
        return new JSONArray().put(new JSONObject().put("name", "Tuna ftira · Panina").put("preparation", "Ready to eat").put("grams", 180).put("estimated", true)
            .put("per100", new JSONObject().put("kcal", 250).put("protein", 12).put("carbs", 30).put("fat", 9).put("fibre", 2)));
    }
    @Test public void preservesChosenSnapshotAndUsesStableIdForDuplicateDelivery() throws Exception {
        JSONArray options = options(); LocalDate day = LocalDate.of(2026, 10, 15);
        String label = MealQuickReply.label(options.getJSONObject(0), 0);
        JSONObject first = MealQuickReply.resolve(label, options, day.toString(), "Lunch", day, LocalTime.of(14, 20));
        JSONObject again = MealQuickReply.resolve(label, options, day.toString(), "Lunch", day, LocalTime.of(14, 21));
        assertEquals(180, first.getDouble("grams"), 0); assertEquals(250, first.getJSONObject("per100").getDouble("kcal"), 0);
        assertEquals("14:20", first.getString("time")); assertEquals(first.getString("id"), again.getString("id")); assertTrue(first.getBoolean("estimated"));
    }
    @Test public void rejectsOldNotificationsUnknownRepliesAndInvalidMacros() throws Exception {
        JSONArray options = options(); LocalDate day = LocalDate.of(2026, 10, 15);
        String label = MealQuickReply.label(options.getJSONObject(0), 0);
        assertNull(MealQuickReply.resolve(label, options, "2026-10-14", "Lunch", day, LocalTime.NOON));
        assertNull(MealQuickReply.resolve("anything else", options, day.toString(), "Lunch", day, LocalTime.NOON));
        options.getJSONObject(0).getJSONObject("per100").put("kcal", -1);
        assertNull(MealQuickReply.resolve(label, options, day.toString(), "Lunch", day, LocalTime.NOON));
    }
}
