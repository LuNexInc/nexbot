package com.lunexinc.nexbotconnect;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Exchanges a short-lived host code for a device-scoped token. */
public final class PairingProvisioner {
    private PairingProvisioner() {}

    public static PairingLink exchange(String baseUrl, String code) throws Exception {
        String base = PairingLink.code(baseUrl, code).baseUrl;
        JSONObject body = new JSONObject().put("code", code.trim());
        JSONObject response = request(base + "/api/remote-access/pair", body.toString());
        return PairingLink.token(base, response.getString("token"));
    }

    private static JSONObject request(String address, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
        int status = connection.getResponseCode();
        String response = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        if (status < 200 || status >= 300) {
            String message;
            try {
                message = new JSONObject(response).optString("error", "Pairing failed (" + status + ")");
            } catch (Exception ignored) {
                message = "Pairing failed (" + status + ")";
            }
            throw new IOException(message);
        }
        return new JSONObject(response);
    }

    private static String read(InputStream input) throws IOException {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
