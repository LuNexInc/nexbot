package com.lunexinc.nexbotconnect;

import android.net.Uri;

/** Validated NexBot pairing data. The raw token is kept only in app storage. */
public final class PairingLink {
    public final String baseUrl;
    public final String token;

    private PairingLink(String baseUrl, String token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    public static PairingLink parse(String raw) {
        if (raw == null) throw new IllegalArgumentException("Paste a NexBot pairing link.");
        String value = raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Paste a NexBot pairing link.");

        Uri input = Uri.parse(value);
        if ("nexbot".equalsIgnoreCase(input.getScheme()) && "pair".equalsIgnoreCase(input.getHost())) {
            String nested = input.getQueryParameter("url");
            if (nested == null || nested.isBlank()) throw new IllegalArgumentException("The NexBot link is incomplete.");
            input = Uri.parse(nested);
        }

        String scheme = input.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || input.getHost() == null) {
            throw new IllegalArgumentException("Use a NexBot http:// or https:// pairing link.");
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
        return new PairingLink(base, token);
    }

    public String appUrl() {
        return baseUrl + "/?token=" + Uri.encode(token);
    }
}
