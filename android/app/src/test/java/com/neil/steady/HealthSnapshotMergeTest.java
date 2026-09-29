package com.neil.steady;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class HealthSnapshotMergeTest {
    private JSONObject activity(String source, int steps, String time) throws Exception {
        return new JSONObject().put("date", "2026-09-29").put("source", source).put("steps", steps).put("activeKcal", 10).put("distanceKm", 0.2).put("updatedAt", time);
    }
    @Test public void preservesOtherDataManualOverridesAndNewerTotals() throws Exception {
        JSONObject payload = new JSONObject().put("entries", new JSONArray().put(new JSONObject().put("name", "Lunch"))).put("futureField", "keep")
            .put("activities", new JSONArray().put(activity("manual", 300, "2026-09-29T07:00:00Z")).put(activity("health", 200, "2026-09-29T07:00:00Z")))
            .put("lastHealthSync", "2026-09-29T07:00:00Z");
        JSONObject merged = HealthSnapshotMerge.merge(payload, new JSONArray().put(activity("health", 100, "2026-09-29T06:00:00Z")), "2026-09-29T06:00:00Z");
        assertEquals("keep", merged.getString("futureField")); assertEquals(payload.getJSONArray("entries").toString(), merged.getJSONArray("entries").toString());
        assertEquals(300, merged.getJSONArray("activities").getJSONObject(0).getInt("steps")); assertEquals(200, merged.getJSONArray("activities").getJSONObject(1).getInt("steps"));
        assertEquals("2026-09-29T07:00:00Z", merged.getString("lastHealthSync"));
        JSONObject fresh = activity("health", 250, "2026-09-29T07:15:00Z").put("activeKcal", JSONObject.NULL);
        merged = HealthSnapshotMerge.merge(payload, new JSONArray().put(fresh), "2026-09-29T07:15:00Z");
        assertEquals(250, merged.getJSONArray("activities").getJSONObject(1).getInt("steps")); assertEquals(10, merged.getJSONArray("activities").getJSONObject(1).getInt("activeKcal"));
        assertEquals(200, payload.getJSONArray("activities").getJSONObject(1).getInt("steps"));
    }
}
