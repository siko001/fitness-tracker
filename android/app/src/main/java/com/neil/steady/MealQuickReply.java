package com.neil.steady;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Pure validation of a displayed snapshot: no AI interpretation of watch replies. */
final class MealQuickReply {
    static String label(JSONObject entry, int index) {
        if (entry == null) return "Unavailable meal";
        String name = entry.optString("name", "Meal");
        if (name.length() > 34) name = name.substring(0, 31) + "…";
        return (index + 1) + ": " + name + " · " + Math.round(entry.optDouble("grams")) + " g";
    }
    static JSONObject resolve(String reply, JSONArray options, String date, String meal, LocalDate today, LocalTime time) throws Exception {
        if (!today.toString().equals(date) || !("Breakfast".equals(meal) || "Lunch".equals(meal) || "Dinner".equals(meal))) return null;
        for (int i = 0; i < Math.min(options.length(), 3); i++) {
            JSONObject option = options.getJSONObject(i);
            if (!label(option, i).equals(reply)) continue;
            String name = option.getString("name"), preparation = option.getString("preparation");
            double grams = option.getDouble("grams");
            if (name.isEmpty() || name.length() > 200 || preparation.length() > 200 || !Double.isFinite(grams) || grams <= 0 || grams > 100000) return null;
            JSONObject macros = option.getJSONObject("per100");
            for (String key : new String[]{"kcal", "protein", "carbs", "fat", "fibre"}) {
                double value = macros.getDouble(key);
                if (!Double.isFinite(value) || value < 0 || value > ("kcal".equals(key) ? 1000 : 100)) return null;
            }
            JSONObject result = new JSONObject(option.toString());
            result.put("id", UUID.nameUUIDFromBytes(("watch-meal:" + date + ":" + meal).getBytes(StandardCharsets.UTF_8)).toString());
            result.put("date", date).put("meal", meal).put("time", time.format(DateTimeFormatter.ofPattern("HH:mm")));
            return result;
        }
        return null;
    }
}
