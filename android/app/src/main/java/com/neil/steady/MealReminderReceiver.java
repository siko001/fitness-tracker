package com.neil.steady;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class MealReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if ("steady.SKIP_MEAL".equals(action)) { if (intent.getBooleanExtra("test", false)) MealReminderEngine.testResult(context); else MealReminderEngine.skip(context, intent.getStringExtra("date"), intent.getStringExtra("meal")); }
        else if ("steady.REPLY_MEAL".equals(action)) MealReminderEngine.reply(context, intent);
        else if ("steady.MEAL_TEST".equals(action)) MealReminderEngine.show(context, "Lunch", true);
        else if ("steady.MEAL_DUE".equals(action)) MealReminderEngine.fire(context, intent.getStringExtra("meal"));
        else MealReminderEngine.scheduleAll(context);
    }
}
