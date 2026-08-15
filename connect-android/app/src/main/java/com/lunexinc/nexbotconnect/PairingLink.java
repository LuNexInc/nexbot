package com.lunexinc.nexbotconnect;

import android.net.Uri;

/** Validated NexBot pairing data. A six-digit code is exchanged before a token is stored. */
public final class PairingLink {
    public final String baseUrl;
    public final String token;
    public final String code;

    private PairingLink(String baseUrl, String token, String code) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.code = code;
    }

    public static PairingLink parse(String raw) {
        if (raw == null) throw new IllegalArgumentException("Paste a NexBot pairing link.");
        String value = raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Paste a NexBot pairing link.");

        Uri input = Uri.parse(value);
        String outerCode = null;
        if ("nexbot".equalsIgnoreCase(input.getScheme()) && "pair".equalsIgnoreCase(input.getHost())) {
            String nested = input.getQueryParameter("url");
            if (nested == null || nested.isBlank()) throw new IllegalArgumentException("The NexBot link is incomplete.");
            outerCode = input.getQueryParameter("code");
            input = Uri.parse(nested);
        }

        String scheme = input.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || input.getHost() == null) {
            throw new IllegalArgumentException("Use a NexBot http:// or https:// pairing link.");
        }

        String code = outerCode != null ? outerCode : input.getQueryParameter("code");
        if (code != null && !code.isBlank()) {
            if (!code.matches("\\d{6}")) throw new IllegalArgumentException("The NexBot pairing code must have six digits.");
            String authority = input.getAuthority();
            String base = scheme + "://" + authority;
            return new PairingLink(base, null, code);
        }

        String token = input.getQueryParameter("token");
        if (token == null || token.isBlank()) {
            String fragment = input.getFragment();
            if (fragment != null) token = Uri.parse("?" + fragment).getQueryParameter("token");
        }
        if (token == null || !token.startsWith("nx_")) {
            throw new IllegalArgumentException("This link does not contain a NexBot device token.");
        }

        String authority = input.getAuthority();
        String base = scheme + "://" + authority;
        return new PairingLink(base, token, null);
    }

    public static PairingLink code(String baseUrl, String code) {
        String normalized = normalizeBaseUrl(baseUrl);
        if (code == null || !code.trim().matches("\\d{6}")) {
            throw new IllegalArgumentException("Enter the six-digit NexBot pairing code.");
        }
        return new PairingLink(normalized, null, code.trim());
    }

    public static PairingLink token(String baseUrl, String token) {
        if (token == null || !token.startsWith("nx_")) throw new IllegalArgumentException("The host returned an invalid device token.");
        return new PairingLink(normalizeBaseUrl(baseUrl), token, null);
    }

    private static String normalizeBaseUrl(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("Enter the NexBot host address.");
        Uri input = Uri.parse(raw.trim());
        String scheme = input.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || input.getHost() == null) {
            throw new IllegalArgumentException("Use a NexBot http:// or https:// host address.");
        }
        return scheme + "://" + input.getAuthority();
    }

    public String appUrl() {
        if (token == null) throw new IllegalStateException("Exchange the pairing code before opening NexBot.");
        return baseUrl + "/?token=" + Uri.encode(token);
    }
}
