package com.budgetme.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin (updates, fingerprint unlock, app settings) must be registered before the bridge starts.
        registerPlugin(BudgetNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
