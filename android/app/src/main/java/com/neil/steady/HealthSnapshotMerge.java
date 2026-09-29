package com.neil.steady;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.LinkedHashMap;

/** Only activity records are changed; all other JSON is retained, including future fields. */
final class HealthSnapshotMerge {
    static JSONObject merge(JSONObject payload, JSONArray incoming, String checked) throws Exception {
        JSONObject result = new JSONObject(payload.toString());
        LinkedHashMap<String, JSONObject> rows = new LinkedHashMap<>();
        JSONArray original = result.optJSONArray("activities");
        if (original != null) for (int i = 0; i < original.length(); i++) {
            JSONObject row = original.getJSONObject(i); rows.put(row.getString("date") + ":" + row.getString("source"), row);
        }
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject row = new JSONObject(incoming.getJSONObject(i).toString());
            if (!"health".equals(row.optString("source"))) continue;
            String id = row.getString("date") + ":health";
            JSONObject old = rows.get(id);
            if (old != null && newer(old.optString("updatedAt"), row.optString("updatedAt"))) continue;
            if (old != null) for (String field : new String[]{"steps", "activeKcal", "distanceKm"}) if (row.isNull(field)) row.put(field, old.opt(field));
            rows.put(id, row);
        }
        JSONArray merged = new JSONArray(); for (JSONObject row : rows.values()) merged.put(row);
        result.put("activities", merged);
        if (!checked.isEmpty() && !newer(result.optString("lastHealthSync"), checked)) result.put("lastHealthSync", checked);
        return result;
    }
    private static boolean newer(String a, String b) {
        try { return Instant.parse(a).isAfter(Instant.parse(b)); } catch (Exception ignored) { return false; }
    }
}
