package com.lunexinc.nexbotconnect;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.VpnService;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

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
    private ProgressBar vpnProgress;
    private EditText pairingHostInput;
    private EditText pairingCodeInput;
    private Button pairingButton;
    private Button pairingScanButton;
    private TextView pairingStatus;
    private ProgressBar pairingProgress;
    private String pendingVpnConfig;
    private boolean vpnActive;
    private ActivityResultLauncher<ScanOptions> qrScanner;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        vpnController = new WireGuardTunnelController(this);
        vpnExecutor = Executors.newSingleThreadExecutor();
        qrScanner = registerForActivityResult(new ScanContract(), result -> {
            if (result.getContents() != null) pairFromScanned(result.getContents());
        });
        PairingLink incoming = pairingFromIntent(getIntent());
        if (incoming != null && incoming.token != null) savePairing(incoming);
        if (savedBaseUrl() != null && savedToken() != null) showShell();
        else showPairing(null);
        if (incoming != null && incoming.code != null) {
            fillPairingFields(incoming);
            pairFromInput(incoming, pairingButton);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PairingLink link = pairingFromIntent(intent);
        if (link == null) return;
        if (link.token != null) {
            savePairing(link);
            showShell();
        } else {
            showPairing(null);
            fillPairingFields(link);
            pairFromInput(link, pairingButton);
        }
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

    private GradientDrawable surface(int fill, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(16));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private Button actionButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setPadding(dp(16), 0, dp(16), 0);
        return button;
    }

    private TextView fieldLabel(String value) {
        TextView label = text(value, 12, Color.rgb(85, 91, 99));
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return label;
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
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));
        TextView subtitle = text("Connect this phone to your NexBot host.", 16, Color.DKGRAY);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-1, -2);
        subtitleParams.topMargin = dp(8);
        root.addView(subtitle, subtitleParams);

        pairingStatus = text(error == null ? "Scan the QR code shown in NexBot Settings to begin." : error,
                14, error == null ? Color.rgb(65, 73, 82) : Color.rgb(168, 48, 48));
        pairingStatus.setPadding(dp(16), dp(14), dp(16), dp(14));
        pairingStatus.setBackground(surface(Color.rgb(232, 238, 242), Color.rgb(210, 218, 224)));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(24);
        root.addView(pairingStatus, statusParams);

        pairingProgress = new ProgressBar(this);
        pairingProgress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(28), dp(28));
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        progressParams.topMargin = dp(12);
        root.addView(pairingProgress, progressParams);

        pairingScanButton = actionButton("Scan pairing QR");
        LinearLayout.LayoutParams scanParams = new LinearLayout.LayoutParams(-1, -2);
        scanParams.topMargin = dp(16);
        root.addView(pairingScanButton, scanParams);
        pairingScanButton.setOnClickListener(v -> {
            ScanOptions options = new ScanOptions();
            options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
            options.setPrompt("Scan the NexBot pairing QR");
            options.setBeepEnabled(true);
            options.setOrientationLocked(false);
            qrScanner.launch(options);
        });

        TextView manualLabel = text("Or enter the host details manually", 14, Color.rgb(85, 91, 99));
        manualLabel.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams manualParams = new LinearLayout.LayoutParams(-1, -2);
        manualParams.topMargin = dp(20);
        root.addView(manualLabel, manualParams);

        root.addView(fieldLabel("HOST ADDRESS"), marginParams(0, 12, 0, 0));
        pairingHostInput = new EditText(this);
        pairingHostInput.setHint("http://192.168.x.x:5199");
        pairingHostInput.setSingleLine(true);
        pairingHostInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        pairingHostInput.setMinHeight(dp(52));
        root.addView(pairingHostInput, new LinearLayout.LayoutParams(-1, -2));

        root.addView(fieldLabel("6-DIGIT CODE"), marginParams(0, 12, 0, 0));
        pairingCodeInput = new EditText(this);
        pairingCodeInput.setHint("000000");
        pairingCodeInput.setSingleLine(true);
        pairingCodeInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        pairingCodeInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        pairingCodeInput.setMinHeight(dp(52));
        pairingCodeInput.setGravity(Gravity.CENTER_VERTICAL);
        pairingCodeInput.setLetterSpacing(0.18f);
        root.addView(pairingCodeInput, new LinearLayout.LayoutParams(-1, -2));

        pairingButton = actionButton("Pair phone");
        LinearLayout.LayoutParams pairParams = new LinearLayout.LayoutParams(-1, -2);
        pairParams.topMargin = dp(16);
        root.addView(pairingButton, pairParams);
        pairingButton.setOnClickListener(v -> pairFromInput(pairingHostInput.getText().toString(), pairingCodeInput.getText().toString(), pairingButton));
        setContentView(root);
    }

    private LinearLayout.LayoutParams marginParams(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private void fillPairingFields(PairingLink link) {
        if (link == null) return;
        if (pairingHostInput != null) pairingHostInput.setText(link.baseUrl);
        if (pairingCodeInput != null) {
            pairingCodeInput.setText(link.code == null ? "" : link.code);
            pairingCodeInput.setSelection(pairingCodeInput.length());
        }
    }

    private void setPairingStatus(String message, boolean error) {
        if (pairingStatus == null) return;
        pairingStatus.setText(message);
        pairingStatus.setTextColor(error ? Color.rgb(168, 48, 48) : Color.rgb(65, 73, 82));
        pairingStatus.setBackground(surface(error ? Color.rgb(252, 237, 237) : Color.rgb(232, 238, 242),
                error ? Color.rgb(241, 198, 198) : Color.rgb(210, 218, 224)));
    }

    private void setPairingBusy(boolean busy) {
        if (pairingButton != null) {
            pairingButton.setEnabled(!busy);
            pairingButton.setText(busy ? "Connecting…" : "Pair phone");
        }
        if (pairingScanButton != null) pairingScanButton.setEnabled(!busy);
        if (pairingHostInput != null) pairingHostInput.setEnabled(!busy);
        if (pairingCodeInput != null) pairingCodeInput.setEnabled(!busy);
        if (pairingProgress != null) pairingProgress.setVisibility(busy ? View.VISIBLE : View.GONE);
    }

    private void showPairingError(Exception error) {
        setPairingBusy(false);
        String message = error == null || error.getMessage() == null
                ? "Could not connect to the NexBot host. Check the address and try again."
                : error.getMessage();
        setPairingStatus(message + "\nCheck that the phone is on the same Wi-Fi and the code is still valid.", true);
    }

    private void pairFromInput(String host, String code, Button pairButton) {
        try {
            PairingLink link = PairingLink.code(host, code);
            pairFromInput(link, pairButton);
        } catch (IllegalArgumentException parseError) {
            showPairingError(parseError);
        }
    }

    private void pairFromScanned(String raw) {
        try {
            PairingLink link = PairingLink.parse(raw);
            if (link.token != null) {
                savePairing(link);
                showShell();
            } else {
                showPairing(null);
                fillPairingFields(link);
                pairFromInput(link, pairingButton);
            }
        } catch (IllegalArgumentException error) {
            showPairing(null);
            showPairingError(error);
        }
    }

    private void pairFromInput(PairingLink link, Button pairButton) {
        if (link == null || link.code == null) return;
        setPairingBusy(true);
        setPairingStatus("Connecting to the NexBot host…", false);
        vpnExecutor.execute(() -> {
            try {
                runOnUiThread(() -> setPairingStatus("Exchanging the one-time pairing code…", false));
                PairingLink exchanged = PairingProvisioner.exchange(link.baseUrl, link.code);
                runOnUiThread(() -> {
                    savePairing(exchanged);
                    showShell();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showPairingError(error));
            }
        });
    }

    private void showShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), dp(4), dp(8), dp(4));
        TextView label = text("NexBot Connect", 16, Color.rgb(32, 33, 36));
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        toolbar.addView(label, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button forget = actionButton("Unpair");
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
        vpnRow.setPadding(dp(16), dp(10), dp(12), dp(10));
        vpnRow.setBackground(surface(Color.rgb(246, 248, 250), Color.rgb(220, 225, 230)));
        LinearLayout statusColumn = new LinearLayout(this);
        statusColumn.setOrientation(LinearLayout.VERTICAL);
        vpnStatus = text("Secure tunnel is off", 14, Color.rgb(55, 62, 70));
        vpnStatus.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        statusColumn.addView(vpnStatus, new LinearLayout.LayoutParams(-1, -2));
        TextView vpnHint = text("Connect once to use NexBot through the private network.", 12, Color.rgb(100, 107, 115));
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-1, -2);
        hintParams.topMargin = dp(3);
        statusColumn.addView(vpnHint, hintParams);
        vpnRow.addView(statusColumn, new LinearLayout.LayoutParams(0, -2, 1));
        vpnProgress = new ProgressBar(this);
        vpnProgress.setVisibility(View.GONE);
        LinearLayout.LayoutParams vpnProgressParams = new LinearLayout.LayoutParams(dp(24), dp(24));
        vpnProgressParams.setMargins(dp(8), 0, dp(8), 0);
        vpnRow.addView(vpnProgress, vpnProgressParams);
        vpnButton = actionButton("Connect secure tunnel");
        vpnRow.addView(vpnButton, new LinearLayout.LayoutParams(-2, dp(48)));
        vpnButton.setOnClickListener(v -> toggleVpn());
        root.addView(vpnRow, marginParams(12, 4, 12, 8));

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
        setVpnBusy(true);
        if (isVpnUp()) {
            disconnectVpn();
            setVpnBusy(false);
            updateVpnUi(false, "Secure tunnel is off");
            loadShellUrl(false);
            return;
        }
        setVpnStatus("Preparing the secure tunnel…");
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
                    setVpnStatus("Approve Android's VPN permission…");
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
            setVpnBusy(false);
            updateVpnUi(false, "VPN permission is required. Tap Connect secure tunnel to retry.");
        }
    }

    private void startTunnel() {
        String config = pendingVpnConfig != null ? pendingVpnConfig : preferences.getString(VPN_CONFIG, null);
        if (config == null) {
            showVpnError(new IllegalStateException("Pair this device before connecting the VPN"));
            return;
        }
        setVpnStatus("Starting the secure tunnel…");
        vpnExecutor.execute(() -> {
            try {
                vpnController.connect(config);
                runOnUiThread(() -> { setVpnBusy(false); updateVpnUi(true, "Secure tunnel connected"); loadShellUrl(true); });
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
            runOnUiThread(() -> { updateVpnUi(connected, connected ? "Secure tunnel connected" : "Secure tunnel is off"); if (connected) loadShellUrl(true); });
        });
    }

    private void updateVpnUi(boolean connected, String status) {
        vpnActive = connected;
        if (vpnStatus != null) vpnStatus.setText(status);
        if (vpnStatus != null) {
            vpnStatus.setTextColor(connected ? Color.rgb(31, 117, 87)
                    : status.startsWith("Could") || status.startsWith("VPN permission")
                    ? Color.rgb(168, 48, 48) : Color.rgb(55, 62, 70));
        }
        if (vpnButton != null) vpnButton.setText(connected ? "Disconnect secure tunnel" : "Connect secure tunnel");
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

    private void setVpnBusy(boolean busy) {
        if (vpnButton != null) vpnButton.setEnabled(!busy);
        if (vpnProgress != null) vpnProgress.setVisibility(busy ? View.VISIBLE : View.GONE);
    }

    private void showVpnError(Exception error) {
        setVpnBusy(false);
        String message = error.getMessage() == null ? "Could not connect the VPN" : error.getMessage();
        updateVpnUi(false, "Could not start the secure tunnel.\n" + message + "\nTap Connect secure tunnel to retry.");
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
