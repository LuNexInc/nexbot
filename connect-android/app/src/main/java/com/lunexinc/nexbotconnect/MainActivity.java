package com.lunexinc.nexbotconnect;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public final class MainActivity extends AppCompatActivity {
    private static final String PREFS = "connect";
    private static final String BASE_URL = "baseUrl";
    private static final String TOKEN = "token";

    private SharedPreferences preferences;
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        PairingLink incoming = pairingFromIntent(getIntent());
        if (incoming != null) savePairing(incoming);
        if (savedBaseUrl() != null && savedToken() != null) showShell();
        else showPairing(null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PairingLink link = pairingFromIntent(intent);
        if (link == null) return;
        savePairing(link);
        showShell();
    }

    private PairingLink pairingFromIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return null;
        try {
            return PairingLink.parse(data.toString());
        } catch (IllegalArgumentException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
            return null;
        }
    }

    private void savePairing(PairingLink link) {
        preferences.edit().putString(BASE_URL, link.baseUrl).putString(TOKEN, link.token).apply();
    }

    private String savedBaseUrl() { return preferences.getString(BASE_URL, null); }
    private String savedToken() { return preferences.getString(TOKEN, null); }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(24), dp(28), dp(24), dp(24));
        layout.setBackgroundColor(Color.rgb(245, 246, 248));
        return layout;
    }

    private void showPairing(String error) {
        LinearLayout root = column();
        TextView title = text("NexBot Connect", 28, Color.rgb(32, 33, 36));
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));
        TextView subtitle = text("Connect your phone to the NexBot host.", 16, Color.DKGRAY);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-1, -2);
        subtitleParams.topMargin = dp(8);
        root.addView(subtitle, subtitleParams);

        EditText input = new EditText(this);
        input.setHint("Paste the pairing link");
        input.setSingleLine(false);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(-1, dp(100));
        inputParams.topMargin = dp(28);
        root.addView(input, inputParams);

        Button pair = new Button(this);
        pair.setText("Pair this device");
        LinearLayout.LayoutParams pairParams = new LinearLayout.LayoutParams(-1, -2);
        pairParams.topMargin = dp(12);
        root.addView(pair, pairParams);
        pair.setOnClickListener(v -> {
            try {
                PairingLink link = PairingLink.parse(input.getText().toString());
                savePairing(link);
                showShell();
            } catch (IllegalArgumentException parseError) {
                input.setError(parseError.getMessage());
            }
        });

        if (error != null) {
            TextView message = text(error, 14, Color.rgb(170, 50, 50));
            LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-1, -2);
            messageParams.topMargin = dp(18);
            root.addView(message, messageParams);
        }
        setContentView(root);
    }

    private void showShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), dp(4), dp(8), dp(4));
        TextView label = text("NexBot Connect", 16, Color.rgb(32, 33, 36));
        label.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(label, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button forget = new Button(this);
        forget.setText("Unpair");
        toolbar.addView(forget, new LinearLayout.LayoutParams(-2, dp(48)));
        forget.setOnClickListener(v -> {
            preferences.edit().clear().apply();
            if (webView != null) webView.destroy();
            showPairing(null);
        });
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                Uri base = Uri.parse(savedBaseUrl());
                if (base.getHost() != null && base.getHost().equalsIgnoreCase(target.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        webView.loadUrl(savedBaseUrl() + "/?token=" + Uri.encode(savedToken()));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
