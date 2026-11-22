package com.budgetme.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home-screen widget: "Left today" (or "Over budget") and a + button for Quick add.
 * The web app sends the text (already translated and formatted) through BudgetNativePlugin.updateWidget;
 * it never holds amounts while App lock is on or after signing out. Kept in private app storage
 * (not in backups: allowBackup=false), so it survives a restart.
 */
public class BudgetWidget extends AppWidgetProvider {
    static final String PREFS = "budget_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(ctx, mgr, id);
    }

    /** Stores the text and redraws every widget on the home screen. */
    static void save(Context ctx, String title, String value, String sub, String add) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("title", cap(title, 40))
            .putString("value", cap(value, 40))
            .putString("sub", cap(sub, 80))
            .putString("add", cap(add, 40))
            .apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, BudgetWidget.class))) draw(ctx, mgr, id);
    }

    private static String cap(String s, int max) {
        if (s == null) return "";
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static void draw(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = p.getString("value", "");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.budget_widget);
        v.setTextViewText(R.id.widget_title, p.getString("title", "Budget me"));
        v.setTextViewText(R.id.widget_value, value);
        v.setViewVisibility(R.id.widget_value, value.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.widget_sub, p.getString("sub", ctx.getString(R.string.widget_open)));
        String add = p.getString("add", ctx.getString(R.string.shortcut_add_expense));
        v.setContentDescription(R.id.widget_add, add);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 0, open, flags));
        // Same link as the "Add expense" home-screen shortcut: opens Quick add.
        Intent quickAdd = new Intent(Intent.ACTION_VIEW, Uri.parse("budgetme://add-expense"), ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(ctx, 1, quickAdd, flags));
        mgr.updateAppWidget(id, v);
    }
}
