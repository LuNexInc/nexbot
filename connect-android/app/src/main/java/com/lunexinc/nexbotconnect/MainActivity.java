package com.lunexinc.nexbotconnect;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.VpnService;
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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends AppCompatActivity {
    private static final String PREFS = "connect";
    private static final String BASE_URL = "baseUrl";
    private static final String TOKEN = "token";
    private static final String VPN_PRIVATE_KEY = "vpnPrivateKey";
    private static final String VPN_PUBLIC_KEY = "vpnPublicKey";
    private static final String VPN_CONFIG = "vpnConfig";
    private static final int VPN_PERMISSION_REQUEST = 7301;

    private SharedPreferences preferences;
    private WebView webView;
    private WireGuardTunnelController vpnController;
    private ExecutorService vpnExecutor;
    private Button vpnButton;
    private TextView vpnStatus;
    private String pendingVpnConfig;
    private boolean vpnActive;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        vpnController = new WireGuardTunnelController(this);
        vpnExecutor = Executors.newSingleThreadExecutor();
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
            disconnectVpn();
            preferences.edit().clear().apply();
            if (webView != null) webView.destroy();
            showPairing(null);
        });
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout vpnRow = new LinearLayout(this);
        vpnRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        vpnRow.setPadding(dp(12), dp(4), dp(12), dp(4));
        vpnStatus = text("VPN is off", 12, Color.DKGRAY);
        vpnRow.addView(vpnStatus, new LinearLayout.LayoutParams(0, dp(42), 1));
        vpnButton = new Button(this);
        vpnButton.setText("Connect VPN");
        vpnRow.addView(vpnButton, new LinearLayout.LayoutParams(-2, dp(42)));
        vpnButton.setOnClickListener(v -> toggleVpn());
        root.addView(vpnRow, new LinearLayout.LayoutParams(-1, -2));

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                Uri base = Uri.parse(savedBaseUrl());
                boolean sameHost = base.getHost() != null && base.getHost().equalsIgnoreCase(target.getHost());
                if (sameHost || (vpnActive && "10.77.0.1".equals(target.getHost()))) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        loadShellUrl(false);
        refreshVpnState();
    }

    private void toggleVpn() {
        if (vpnButton == null) return;
        vpnButton.setEnabled(false);
        if (isVpnUp()) {
            disconnectVpn();
            vpnButton.setEnabled(true);
            updateVpnUi(false, "VPN is off");
            loadShellUrl(false);
            return;
        }
        setVpnStatus("Preparing VPN…");
        vpnExecutor.execute(() -> {
            try {
                String privateKey = preferences.getString(VPN_PRIVATE_KEY, null);
                String publicKey = preferences.getString(VPN_PUBLIC_KEY, null);
                com.wireguard.crypto.KeyPair keyPair;
                if (privateKey == null || publicKey == null) {
                    keyPair = new com.wireguard.crypto.KeyPair();
                    privateKey = keyPair.getPrivateKey().toBase64();
                    publicKey = keyPair.getPublicKey().toBase64();
                }
                VpnProvisioner.ProvisionedVpn vpn = VpnProvisioner.provision(savedBaseUrl(), savedToken(), publicKey);
                String config = vpn.config(privateKey);
                String finalPrivateKey = privateKey;
                String finalPublicKey = publicKey;
                runOnUiThread(() -> {
                    preferences.edit().putString(VPN_PRIVATE_KEY, finalPrivateKey).putString(VPN_PUBLIC_KEY, finalPublicKey).putString(VPN_CONFIG, config).apply();
                    pendingVpnConfig = config;
                    requestVpnPermissionAndConnect();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showVpnError(error));
            }
        });
    }

    private void requestVpnPermissionAndConnect() {
        Intent permission = VpnService.prepare(this);
        if (permission != null) startActivityForResult(permission, VPN_PERMISSION_REQUEST);
        else startTunnel();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VPN_PERMISSION_REQUEST) return;
        if (resultCode == RESULT_OK) startTunnel();
        else {
            if (vpnButton != null) vpnButton.setEnabled(true);
            setVpnStatus("VPN permission was not granted");
        }
    }

    private void startTunnel() {
        String config = pendingVpnConfig != null ? pendingVpnConfig : preferences.getString(VPN_CONFIG, null);
        if (config == null) {
            showVpnError(new IllegalStateException("Pair this device before connecting the VPN"));
            return;
        }
        vpnExecutor.execute(() -> {
            try {
                vpnController.connect(config);
                runOnUiThread(() -> { updateVpnUi(true, "VPN is connected"); if (vpnButton != null) vpnButton.setEnabled(true); loadShellUrl(true); });
            } catch (Exception error) {
                runOnUiThread(() -> showVpnError(error));
            }
        });
    }

    private void disconnectVpn() {
        if (vpnController == null) return;
        vpnExecutor.execute(() -> {
            try { vpnController.disconnect(); } catch (Exception ignored) { }
        });
    }

    private boolean isVpnUp() {
        try { return vpnController.state() == com.wireguard.android.backend.Tunnel.State.UP; }
        catch (Exception ignored) { return false; }
    }

    private void refreshVpnState() {
        vpnExecutor.execute(() -> {
            boolean connected = isVpnUp();
            runOnUiThread(() -> { updateVpnUi(connected, connected ? "VPN is connected" : "VPN is off"); if (connected) loadShellUrl(true); });
        });
    }

    private void updateVpnUi(boolean connected, String status) {
        vpnActive = connected;
        if (vpnStatus != null) vpnStatus.setText(status);
        if (vpnButton != null) vpnButton.setText(connected ? "Disconnect VPN" : "Connect VPN");
    }

    private void loadShellUrl(boolean throughVpn) {
        if (webView == null || savedBaseUrl() == null || savedToken() == null) return;
        String address = savedBaseUrl();
        if (throughVpn) {
            Uri base = Uri.parse(address);
            String authority = "10.77.0.1" + (base.getPort() > 0 ? ":" + base.getPort() : "");
            Uri.Builder builder = new Uri.Builder().scheme(base.getScheme()).encodedAuthority(authority);
            address = builder.build().toString();
        }
        webView.loadUrl(address + "/?token=" + Uri.encode(savedToken()));
    }

    private void setVpnStatus(String status) {
        if (vpnStatus != null) vpnStatus.setText(status);
    }

    private void showVpnError(Exception error) {
        if (vpnButton != null) vpnButton.setEnabled(true);
        String message = error.getMessage() == null ? "Could not connect the VPN" : error.getMessage();
        setVpnStatus("VPN is off");
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (vpnExecutor != null) vpnExecutor.shutdownNow();
        super.onDestroy();
    }
}
