package com.lunexinc.nexbotconnect;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
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
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The native shell for the NexBot Connect pairing and secure-tunnel flow. */
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
    private FrameLayout shellRoot;
    private ImageView connectionFab;
    private MaterialCardView connectionSheet;
    private MaterialButton unpairButton;
    private WireGuardTunnelController vpnController;
    private ExecutorService vpnExecutor;

    private MaterialButton vpnButton;
    private MaterialButton vpnDetailsButton;
    private TextView vpnStatus;
    private TextView vpnHint;
    private TextView vpnHost;
    private TextView vpnDetail;
    private ProgressBar vpnProgress;
    private View vpnStatusDot;
    private MaterialCardView vpnCard;
    private boolean vpnDetailVisible;

    private TextInputEditText pairingHostInput;
    private TextInputEditText pairingCodeInput;
    private MaterialButton pairingButton;
    private MaterialButton pairingScanButton;
    private MaterialButton manualToggleButton;
    private TextView pairingStatus;
    private ProgressBar pairingProgress;
    private View pairingStatusDot;
    private MaterialCardView pairingStatusCard;
    private LinearLayout manualPanel;

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
            openManualPanel(true);
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
            showPairingToast();
        } else {
            showPairing(null);
            fillPairingFields(link);
            openManualPanel(true);
            pairFromInput(link, pairingButton);
        }
    }

    private PairingLink pairingFromIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return null;
        try {
            return PairingLink.parse(data.toString());
        } catch (IllegalArgumentException error) {
            showPairingError(error);
            return null;
        }
    }

    private void savePairing(PairingLink link) {
        preferences.edit().putString(BASE_URL, link.baseUrl).putString(TOKEN, link.token).apply();
    }

    private String savedBaseUrl() { return preferences.getString(BASE_URL, null); }
    private String savedToken() { return preferences.getString(TOKEN, null); }

    private int color(int resource) { return ContextCompat.getColor(this, resource); }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float size, int textColor) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(textColor);
        view.setIncludeFontPadding(false);
        return view;
    }

    private TextView heading(String value, float size) {
        TextView view = text(value, size, color(R.color.nexbot_on_surface));
        view.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        view.setLetterSpacing(-0.015f);
        return view;
    }

    private TextView eyebrow(String value) {
        TextView view = text(value, 11, color(R.color.nexbot_accent_strong));
        view.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        view.setLetterSpacing(0.12f);
        return view;
    }

    private GradientDrawable rounded(int fill, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private GradientDrawable gradient(int start, int end, float radius) {
        GradientDrawable drawable = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{start, end}
        );
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private GradientDrawable circle(int fill) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setShape(GradientDrawable.OVAL);
        return drawable;
    }

    private MaterialCardView card(int fill) {
        MaterialCardView card = new MaterialCardView(this);
        card.setCardBackgroundColor(fill);
        card.setRadius(dp(24));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(1));
        card.setStrokeColor(ColorStateList.valueOf(color(R.color.nexbot_border)));
        return card;
    }

    private MaterialButton button(String label, boolean primary) {
        MaterialButton button = new MaterialButton(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        button.setMinHeight(dp(52));
        button.setMinWidth(dp(48));
        button.setInsetTop(0);
        button.setInsetBottom(0);
        button.setCornerRadius(dp(16));
        button.setPadding(dp(16), 0, dp(16), 0);
        button.setRippleColor(ColorStateList.valueOf(color(primary ? R.color.nexbot_accent_soft : R.color.nexbot_surface_alt)));
        if (primary) {
            button.setTextColor(color(R.color.nexbot_surface));
            button.setBackgroundTintList(ColorStateList.valueOf(color(R.color.nexbot_accent)));
        } else {
            button.setTextColor(color(R.color.nexbot_accent_strong));
            button.setBackgroundTintList(ColorStateList.valueOf(color(R.color.nexbot_surface)));
            button.setStrokeWidth(dp(1));
            button.setStrokeColor(ColorStateList.valueOf(color(R.color.nexbot_border)));
        }
        return button;
    }

    private MaterialButton textButton(String label) {
        MaterialButton button = button(label, false);
        button.setMinHeight(dp(44));
        button.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        button.setStrokeWidth(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        return button;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }

    private LinearLayout.LayoutParams params(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        if (width == 0 || height == 0) params.weight = 1f;
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private LinearLayout.LayoutParams params(int width, int height) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        if (width == 0 || height == 0) params.weight = 1f;
        return params;
    }

    private ImageView brandMark(int size) {
        ImageView image = new ImageView(this);
        image.setImageResource(R.drawable.ic_nexbot);
        image.setPadding(dp(9), dp(9), dp(9), dp(9));
        image.setBackground(circle(color(R.color.nexbot_accent_soft)));
        image.setContentDescription("NexBot");
        image.setLayoutParams(params(dp(size), dp(size)));
        return image;
    }

    private void addBrandHeader(LinearLayout parent) {
        LinearLayout brand = row();
        brand.addView(brandMark(48));
        LinearLayout labels = column();
        labels.addView(heading("NexBot Connect", 16));
        TextView sub = text("PRIVATE DEVICE ACCESS", 10, color(R.color.nexbot_on_surface_secondary));
        sub.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        sub.setLetterSpacing(0.11f);
        labels.addView(sub, params(-1, -2, 0, 3, 0, 0));
        brand.addView(labels, params(0, -2, 12, 0, 0, 0));
        parent.addView(brand);
    }

    private void addPairingHero(LinearLayout parent) {
        MaterialCardView hero = card(Color.TRANSPARENT);
        hero.setCardBackgroundColor(Color.TRANSPARENT);
        hero.setBackground(gradient(color(R.color.nexbot_hero_start), color(R.color.nexbot_hero_end), 26));
        LinearLayout content = column();
        content.setPadding(dp(20), dp(20), dp(20), dp(20));

        LinearLayout step = row();
        TextView stepNumber = text("01", 11, color(R.color.nexbot_accent_strong));
        stepNumber.setGravity(Gravity.CENTER);
        stepNumber.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        stepNumber.setBackground(circle(color(R.color.nexbot_surface)));
        step.addView(stepNumber, params(dp(32), dp(32)));
        step.addView(eyebrow("PAIR THIS PHONE"), params(-1, -2, 10, 0, 0, 0));
        content.addView(step);

        content.addView(heading("Scan once. Stay connected.", 25), params(-1, -2, 0, 22, 0, 0));
        TextView copy = text("Use the QR code in NexBot Settings. Your phone gets a private device token and keeps it on this device.", 15, color(R.color.nexbot_on_surface_secondary));
        copy.setLineSpacing(dp(3), 1f);
        content.addView(copy, params(-1, -2, 0, 8, 0, 0));

        pairingScanButton = button("Scan pairing QR", true);
        pairingScanButton.setIconResource(R.drawable.ic_qr);
        pairingScanButton.setIconTint(ColorStateList.valueOf(color(R.color.nexbot_surface)));
        pairingScanButton.setIconPadding(dp(10));
        content.addView(pairingScanButton, params(-1, dp(52), 0, 20, 0, 0));
        pairingScanButton.setOnClickListener(v -> launchScanner());

        manualToggleButton = textButton("Enter a code manually");
        content.addView(manualToggleButton, params(-1, dp(44), 0, 4, 0, 0));
        manualToggleButton.setOnClickListener(v -> openManualPanel(manualPanel == null || manualPanel.getVisibility() != View.VISIBLE));

        hero.addView(content, new ViewGroup.LayoutParams(-1, -2));
        parent.addView(hero, params(-1, -2, 0, 28, 0, 0));
    }

    private void addStatusCard(LinearLayout parent) {
        pairingStatusCard = card(color(R.color.nexbot_surface));
        LinearLayout content = row();
        content.setPadding(dp(16), dp(14), dp(16), dp(14));
        pairingStatusDot = new View(this);
        pairingStatusDot.setBackground(circle(color(R.color.nexbot_accent)));
        content.addView(pairingStatusDot, params(dp(10), dp(10)));
        pairingStatus = text("Ready to pair. Scan the QR code on your host.", 13, color(R.color.nexbot_on_surface_secondary));
        pairingStatus.setLineSpacing(dp(2), 1f);
        content.addView(pairingStatus, params(0, -2, 12, 0, 0, 0));
        pairingStatusCard.addView(content, new ViewGroup.LayoutParams(-1, -2));
        parent.addView(pairingStatusCard, params(-1, -2, 0, 14, 0, 0));
        pairingProgress = new ProgressBar(this);
        pairingProgress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = params(dp(28), dp(28), 0, 10, 0, 0);
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        parent.addView(pairingProgress, progressParams);
    }

    private void addManualPanel(LinearLayout parent) {
        manualPanel = column();
        manualPanel.setPadding(dp(18), dp(18), dp(18), dp(18));
        manualPanel.setBackground(rounded(color(R.color.nexbot_surface), color(R.color.nexbot_border), 22));
        manualPanel.setVisibility(View.GONE);

        LinearLayout header = row();
        LinearLayout titles = column();
        titles.addView(heading("Enter pairing details", 17));
        titles.addView(text("Use the host address and six-digit code from Settings.", 12, color(R.color.nexbot_on_surface_secondary)), params(-1, -2, 0, 4, 0, 0));
        header.addView(titles, params(0, -2, 0, 0, 8, 0));
        MaterialButton close = textButton("Use QR");
        header.addView(close, params(-2, dp(44)));
        close.setOnClickListener(v -> openManualPanel(false));
        manualPanel.addView(header);

        TextInputLayout hostLayout = new TextInputLayout(this);
        hostLayout.setHint("Host address");
        hostLayout.setBoxBackgroundMode(TextInputLayout.BOX_BACKGROUND_OUTLINE);
        hostLayout.setBoxCornerRadii(dp(14), dp(14), dp(14), dp(14));
        pairingHostInput = new TextInputEditText(this);
        pairingHostInput.setSingleLine(true);
        pairingHostInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        pairingHostInput.setTextSize(16);
        hostLayout.addView(pairingHostInput, new LinearLayout.LayoutParams(-1, dp(56)));
        manualPanel.addView(hostLayout, params(-1, -2, 0, 18, 0, 0));

        TextInputLayout codeLayout = new TextInputLayout(this);
        codeLayout.setHint("Six-digit pairing code");
        codeLayout.setBoxBackgroundMode(TextInputLayout.BOX_BACKGROUND_OUTLINE);
        codeLayout.setBoxCornerRadii(dp(14), dp(14), dp(14), dp(14));
        pairingCodeInput = new TextInputEditText(this);
        pairingCodeInput.setSingleLine(true);
        pairingCodeInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        pairingCodeInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        pairingCodeInput.setTextSize(20);
        pairingCodeInput.setLetterSpacing(0.16f);
        codeLayout.addView(pairingCodeInput, new LinearLayout.LayoutParams(-1, dp(56)));
        manualPanel.addView(codeLayout, params(-1, -2, 0, 10, 0, 0));

        pairingButton = button("Pair this phone", true);
        pairingButton.setIconResource(R.drawable.ic_link);
        pairingButton.setIconTint(ColorStateList.valueOf(color(R.color.nexbot_surface)));
        pairingButton.setIconPadding(dp(10));
        manualPanel.addView(pairingButton, params(-1, dp(52), 0, 16, 0, 0));
        pairingButton.setOnClickListener(v -> pairFromInput(pairingHostInput.getText().toString(), pairingCodeInput.getText().toString(), pairingButton));
        parent.addView(manualPanel, params(-1, -2, 0, 14, 0, 0));
    }

    private void addPairingTrustNote(LinearLayout parent) {
        MaterialCardView note = card(color(R.color.nexbot_surface_alt));
        LinearLayout content = row();
        content.setPadding(dp(16), dp(15), dp(16), dp(15));
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_shield);
        icon.setPadding(dp(7), dp(7), dp(7), dp(7));
        icon.setBackground(circle(color(R.color.nexbot_surface)));
        content.addView(icon, params(dp(40), dp(40)));
        LinearLayout copy = column();
        copy.addView(heading("Local by design", 14));
        copy.addView(text("No account and no cloud relay. The token stays in this app.", 12, color(R.color.nexbot_on_surface_secondary)), params(-1, -2, 0, 4, 0, 0));
        content.addView(copy, params(0, -2, 12, 0, 0, 0));
        note.addView(content, new ViewGroup.LayoutParams(-1, -2));
        parent.addView(note, params(-1, -2, 0, 20, 0, 0));
    }

    private void showPairing(String error) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setBackgroundColor(color(R.color.nexbot_background));
        LinearLayout root = column();
        root.setPadding(dp(24), dp(28), dp(24), dp(34));
        scroll.addView(root, new ScrollView.LayoutParams(-1, -1));

        addBrandHeader(root);
        root.addView(heading("Bring NexBot with you.", 31), params(-1, -2, 0, 34, 0, 0));
        TextView intro = text("A private mobile window into the workspace running on your PC.", 16, color(R.color.nexbot_on_surface_secondary));
        intro.setLineSpacing(dp(3), 1f);
        root.addView(intro, params(-1, -2, 0, 9, 0, 0));
        addPairingHero(root);
        addStatusCard(root);
        addManualPanel(root);
        addPairingTrustNote(root);
        setContentView(scroll);
        if (error != null) showPairingError(error);
    }

    private void launchScanner() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt("Scan the NexBot pairing QR");
        options.setBeepEnabled(true);
        options.setOrientationLocked(false);
        qrScanner.launch(options);
    }

    private void openManualPanel(boolean open) {
        if (manualPanel == null) return;
        if (open) {
            manualPanel.setVisibility(View.VISIBLE);
            manualPanel.setAlpha(0f);
            manualPanel.setTranslationY(dp(8));
            manualPanel.animate().alpha(1f).translationY(0).setDuration(180).start();
            if (manualToggleButton != null) manualToggleButton.setText("Hide manual entry");
        } else {
            manualPanel.animate().alpha(0f).translationY(dp(8)).setDuration(140).withEndAction(() -> {
                manualPanel.setVisibility(View.GONE);
                manualPanel.setAlpha(1f);
                manualPanel.setTranslationY(0);
            }).start();
            if (manualToggleButton != null) manualToggleButton.setText("Enter a code manually");
        }
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
        pairingStatus.setTextColor(color(error ? R.color.nexbot_error : R.color.nexbot_on_surface_secondary));
        pairingStatusDot.setBackground(circle(color(error ? R.color.nexbot_error : R.color.nexbot_accent)));
        pairingStatusCard.setCardBackgroundColor(color(error ? R.color.nexbot_error_soft : R.color.nexbot_surface));
        pairingStatusCard.setStrokeColor(ColorStateList.valueOf(color(error ? R.color.nexbot_error : R.color.nexbot_border)));
    }

    private void setPairingBusy(boolean busy) {
        if (pairingButton != null) {
            pairingButton.setEnabled(!busy);
            pairingButton.setText(busy ? "Connecting…" : "Pair this phone");
        }
        if (pairingScanButton != null) pairingScanButton.setEnabled(!busy);
        if (manualToggleButton != null) manualToggleButton.setEnabled(!busy);
        if (pairingHostInput != null) pairingHostInput.setEnabled(!busy);
        if (pairingCodeInput != null) pairingCodeInput.setEnabled(!busy);
        if (pairingProgress != null) pairingProgress.setVisibility(busy ? View.VISIBLE : View.GONE);
    }

    private String friendlyPairingError(Exception error) {
        String raw = error == null ? "" : error.getMessage();
        if (raw == null || raw.isBlank()) return "Could not reach the NexBot host.";
        String lower = raw.toLowerCase();
        if (lower.contains("expired") || lower.contains("invalid")) return "That pairing code is no longer valid. Create a new code on the host.";
        if (lower.contains("timed out") || lower.contains("unable to resolve") || lower.contains("connectexception")) return "The host did not respond. Check that this phone is on the same Wi-Fi.";
        return raw.length() > 180 ? "The host returned an error. Check the address and try again." : raw;
    }

    private void showPairingError(Exception error) {
        setPairingBusy(false);
        if (pairingStatus != null) {
            setPairingStatus(friendlyPairingError(error) + "\nTry again or enter the details manually.", true);
            openManualPanel(true);
        }
    }

    private void showPairingError(String error) {
        setPairingBusy(false);
        if (pairingStatus != null) {
            String message = (error == null || error.isBlank())
                    ? "Could not reach the NexBot host."
                    : error;
            setPairingStatus(message + "\nTry again or enter the details manually.", true);
            openManualPanel(true);
        }
    }

    private void pairFromInput(String host, String code, MaterialButton pairButton) {
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
                showPairingToast();
            } else {
                fillPairingFields(link);
                openManualPanel(true);
                pairFromInput(link, pairingButton);
            }
        } catch (IllegalArgumentException error) {
            showPairingError(error);
        }
    }

    private void pairFromInput(PairingLink link, MaterialButton pairButton) {
        if (link == null || link.code == null) return;
        setPairingBusy(true);
        setPairingStatus("Connecting to the NexBot host…", false);
        vpnExecutor.execute(() -> {
            try {
                runOnUiThread(() -> setPairingStatus("Exchanging the one-time code…", false));
                PairingLink exchanged = PairingProvisioner.exchange(link.baseUrl, link.code);
                runOnUiThread(() -> {
                    savePairing(exchanged);
                    showShell();
                    showPairingToast();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showPairingError(error));
            }
        });
    }

    private void showPairingToast() {
        android.widget.Toast.makeText(this, "Paired — opening Messages", android.widget.Toast.LENGTH_SHORT).show();
    }

    private void addShellHeader(LinearLayout parent) {
        LinearLayout header = row();
        header.setPadding(dp(20), dp(12), dp(16), dp(8));
        header.addView(brandMark(44));
        LinearLayout labels = column();
        labels.addView(heading("NexBot", 19));
        labels.addView(text("Private workspace", 12, color(R.color.nexbot_on_surface_secondary)), params(-1, -2, 0, 3, 0, 0));
        header.addView(labels, params(0, -2, 12, 0, 0, 0));
        MaterialButton unpairButton = textButton("Unpair");
        header.addView(unpairButton, params(-2, dp(44), 8, 0, 0, 0));
        unpairButton.setOnClickListener(v -> {
            disconnectVpn();
            preferences.edit().clear().apply();
            if (webView != null) webView.destroy();
            showPairing(null);
        });
        parent.addView(header, params(-1, -2));
    }

    private void addVpnCard(LinearLayout parent) {
        vpnCard = card(color(R.color.nexbot_surface));
        vpnCard.setRadius(dp(18));
        LinearLayout content = row();
        content.setPadding(dp(14), dp(8), dp(10), dp(8));

        vpnStatusDot = new View(this);
        vpnStatusDot.setBackground(circle(color(R.color.nexbot_warning)));
        content.addView(vpnStatusDot, params(dp(10), dp(10), 0, 0, 10, 0));
        LinearLayout copy = column();
        copy.addView(eyebrow("VPN"));
        vpnStatus = heading("Off", 15);
        copy.addView(vpnStatus, params(-1, -2, 0, 2, 0, 0));
        vpnHint = text("Local connection", 11, color(R.color.nexbot_on_surface_secondary));
        copy.addView(vpnHint, params(-1, -2, 0, 2, 0, 0));
        content.addView(copy, params(0, -2, 0, 0, 10, 0));

        vpnProgress = new ProgressBar(this);
        vpnProgress.setVisibility(View.GONE);
        content.addView(vpnProgress, params(dp(20), dp(20), 0, 0, 8, 0));
        vpnButton = textButton("Connect");
        vpnButton.setIconResource(R.drawable.ic_shield);
        vpnButton.setIconTint(ColorStateList.valueOf(color(R.color.nexbot_accent_strong)));
        vpnButton.setIconPadding(dp(6));
        vpnButton.setMinWidth(dp(108));
        content.addView(vpnButton, params(-2, dp(42)));
        vpnButton.setOnClickListener(v -> toggleVpn());

        vpnHost = text(displayHost(false), 1, Color.TRANSPARENT);
        vpnHost.setVisibility(View.GONE);
        vpnDetailsButton = null;
        vpnDetail = null;

        vpnCard.addView(content, new ViewGroup.LayoutParams(-1, -2));
        parent.addView(vpnCard, params(-1, -2, 12, 4, 12, 6));
    }

    private void addWorkspace(LinearLayout parent) {
        webView = new WebView(this);
        webView.setBackgroundColor(color(R.color.nexbot_background));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
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
        parent.addView(webView, params(-1, 0, 0, 0, 0, 0));
        ((LinearLayout.LayoutParams) webView.getLayoutParams()).weight = 1f;
    }

    private void addWorkspace(FrameLayout parent) {
        webView = new WebView(this);
        webView.setBackgroundColor(color(R.color.nexbot_background));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
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
        parent.addView(webView, new FrameLayout.LayoutParams(-1, -1));
    }

    private void addConnectionOverlay(FrameLayout parent) {
        connectionSheet = card(color(R.color.nexbot_surface));
        connectionSheet.setVisibility(View.GONE);
        connectionSheet.setElevation(dp(18));
        LinearLayout sheetContent = column();
        sheetContent.setPadding(dp(14), dp(14), dp(14), dp(14));

        LinearLayout titleRow = row();
        LinearLayout titleCopy = column();
        titleCopy.addView(heading("Connection", 16));
        titleCopy.addView(text("Private access to this workspace", 11, color(R.color.nexbot_on_surface_secondary)), params(-1, -2, 0, 3, 0, 0));
        titleRow.addView(titleCopy, params(0, -2, 0, 0, 8, 0));
        MaterialButton close = textButton("Close");
        titleRow.addView(close, params(-2, dp(40)));
        close.setOnClickListener(v -> setConnectionSheetVisible(false));
        sheetContent.addView(titleRow);

        addVpnCard(sheetContent);

        unpairButton = textButton("Unpair this phone");
        unpairButton.setTextColor(color(R.color.nexbot_error));
        sheetContent.addView(unpairButton, params(-1, dp(42), 0, 6, 0, 0));
        unpairButton.setOnClickListener(v -> {
            setConnectionSheetVisible(false);
            disconnectVpn();
            preferences.edit().clear().apply();
            if (webView != null) webView.destroy();
            showPairing(null);
        });

        connectionSheet.addView(sheetContent, new ViewGroup.LayoutParams(-1, -2));
        FrameLayout.LayoutParams sheetParams = new FrameLayout.LayoutParams(dp(292), -2, Gravity.BOTTOM | Gravity.END);
        sheetParams.setMargins(dp(16), dp(16), dp(16), dp(156));
        parent.addView(connectionSheet, sheetParams);

        connectionFab = new ImageView(this);
        connectionFab.setImageResource(R.drawable.ic_shield);
        connectionFab.setPadding(dp(14), dp(14), dp(14), dp(14));
        connectionFab.setBackground(circle(color(R.color.nexbot_accent_soft)));
        connectionFab.setColorFilter(color(R.color.nexbot_accent_strong));
        connectionFab.setContentDescription("Connection settings");
        connectionFab.setClickable(true);
        connectionFab.setFocusable(true);
        connectionFab.setElevation(dp(12));
        connectionFab.setOnClickListener(v -> setConnectionSheetVisible(connectionSheet.getVisibility() != View.VISIBLE));
        FrameLayout.LayoutParams fabParams = new FrameLayout.LayoutParams(dp(54), dp(54), Gravity.BOTTOM | Gravity.END);
        fabParams.setMargins(dp(16), dp(16), dp(18), dp(92));
        parent.addView(connectionFab, fabParams);
    }

    private void setConnectionSheetVisible(boolean visible) {
        if (connectionSheet == null) return;
        if (visible) {
            connectionSheet.setVisibility(View.VISIBLE);
            connectionSheet.setAlpha(0f);
            connectionSheet.setTranslationY(dp(12));
            connectionSheet.animate().alpha(1f).translationY(0).setDuration(180).start();
        } else {
            connectionSheet.animate().alpha(0f).translationY(dp(12)).setDuration(140).withEndAction(() -> {
                connectionSheet.setVisibility(View.GONE);
                connectionSheet.setAlpha(1f);
                connectionSheet.setTranslationY(0);
            }).start();
        }
    }

    private String displayHost(boolean throughVpn) {
        if (throughVpn) return "10.77.0.1 · private tunnel";
        Uri base = Uri.parse(savedBaseUrl() == null ? "http://host" : savedBaseUrl());
        return base.getHost() + (base.getPort() > 0 ? ":" + base.getPort() : "") + " · local network";
    }

    private void showShell() {
        shellRoot = new FrameLayout(this);
        shellRoot.setBackgroundColor(color(R.color.nexbot_background));
        addWorkspace(shellRoot);
        addConnectionOverlay(shellRoot);
        setContentView(shellRoot);
        loadShellUrl(false);
        refreshVpnState();
    }

    private void toggleVpn() {
        if (vpnButton == null) return;
        if (isVpnUp()) {
            setVpnBusy(true);
            disconnectVpn();
            setVpnBusy(false);
            updateVpnUi(false, "Off");
            setVpnHint("Local connection");
            loadShellUrl(false);
            return;
        }
        setVpnBusy(true);
        setVpnStatus("Connecting");
        setVpnHint("Preparing tunnel…");
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
                    setVpnStatus("Permission needed");
                    setVpnHint("Approve VPN access");
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
            updateVpnUi(false, "Permission needed");
            setVpnHint("Allow VPN access to connect. You can retry at any time.");
        }
    }

    private void startTunnel() {
        String config = pendingVpnConfig != null ? pendingVpnConfig : preferences.getString(VPN_CONFIG, null);
        if (config == null) {
            showVpnError(new IllegalStateException("Pair this phone before connecting the secure tunnel."));
            return;
        }
        setVpnStatus("Starting");
        setVpnHint("Starting secure tunnel…");
        vpnExecutor.execute(() -> {
            try {
                vpnController.connect(config);
                runOnUiThread(() -> { setVpnBusy(false); updateVpnUi(true, "Connected"); setVpnHint("Private tunnel active"); loadShellUrl(true); });
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
            runOnUiThread(() -> {
                updateVpnUi(connected, connected ? "Connected" : "Off");
                setVpnHint(connected ? "Private tunnel active" : "Local connection");
                if (connected) loadShellUrl(true);
            });
        });
    }

    private void updateVpnUi(boolean connected, String status) {
        vpnActive = connected;
        if (vpnStatus != null) vpnStatus.setText(status);
        if (vpnStatusDot != null) vpnStatusDot.setBackground(circle(color(connected ? R.color.nexbot_success : R.color.nexbot_warning)));
        if (vpnHost != null) vpnHost.setText(displayHost(connected));
        if (vpnButton != null) {
            vpnButton.setText(connected ? "Disconnect" : "Connect");
            vpnButton.setIconResource(connected ? R.drawable.ic_link : R.drawable.ic_shield);
        }
        if (vpnCard != null) {
            vpnCard.setCardBackgroundColor(color(connected ? R.color.nexbot_accent_soft : R.color.nexbot_surface));
            vpnCard.setStrokeColor(ColorStateList.valueOf(color(connected ? R.color.nexbot_success : R.color.nexbot_border)));
        }
    }

    private void setVpnStatus(String status) {
        if (vpnStatus != null) vpnStatus.setText(status);
    }

    private void setVpnHint(String hint) {
        if (vpnHint != null) vpnHint.setText(hint);
    }

    private void setVpnBusy(boolean busy) {
        if (vpnButton != null) vpnButton.setEnabled(!busy);
        if (vpnProgress != null) vpnProgress.setVisibility(busy ? View.VISIBLE : View.GONE);
    }

    private String friendlyVpnError(Exception error) {
        String raw = error == null ? "" : error.getMessage();
        if (raw == null || raw.isBlank()) return "The secure tunnel could not start.";
        String lower = raw.toLowerCase();
        if (lower.contains("command failed") || lower.contains("access is denied")) return "The host could not update WireGuard. Keep NexBot running on the host and try again.";
        if (lower.contains("permission")) return "Android needs VPN permission before the tunnel can start.";
        if (lower.contains("timeout") || lower.contains("connectexception")) return "The host did not respond. Check the network and try again.";
        return raw.length() > 160 ? "The secure tunnel could not start. Try again." : raw;
    }

    private void showVpnError(Exception error) {
        setVpnBusy(false);
        updateVpnUi(false, "Could not connect");
        setVpnHint(friendlyVpnError(error) + " Tap Try again when ready.");
        if (vpnDetailsButton != null && vpnDetail != null) {
            vpnDetail.setText(error == null || error.getMessage() == null ? "" : error.getMessage());
            vpnDetailsButton.setVisibility(View.VISIBLE);
            vpnDetailVisible = false;
            vpnDetail.setVisibility(View.GONE);
            vpnDetailsButton.setText("Show technical details");
        }
        if (vpnCard != null) {
            vpnCard.setCardBackgroundColor(color(R.color.nexbot_error_soft));
            vpnCard.setStrokeColor(ColorStateList.valueOf(color(R.color.nexbot_error)));
        }
        if (vpnStatusDot != null) vpnStatusDot.setBackground(circle(color(R.color.nexbot_error)));
        if (vpnButton != null) vpnButton.setText("Try again");
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
        webView.loadUrl(address + "/m.html?token=" + Uri.encode(savedToken()));
    }

    @Override
    public void onBackPressed() {
        if (connectionSheet != null && connectionSheet.getVisibility() == View.VISIBLE) {
            setConnectionSheetVisible(false);
            return;
        }
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (vpnExecutor != null) vpnExecutor.shutdownNow();
        super.onDestroy();
    }
}
