package com.neil.steady;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SteadyMealRemindersPlugin.class);
        registerPlugin(SteadyBackgroundHealthPlugin.class);
        MealReminderEngine.captureOpen(this, getIntent());
        super.onCreate(savedInstanceState);
    }
    @Override protected void onNewIntent(Intent intent) {
        MealReminderEngine.captureOpen(this, intent);
        super.onNewIntent(intent);
    }
}
