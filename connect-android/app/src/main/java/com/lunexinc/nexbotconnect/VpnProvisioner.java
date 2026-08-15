package com.lunexinc.nexbotconnect;

import android.net.Uri;

import com.wireguard.crypto.KeyPair;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Small client for the device-scoped NexBot Connect VPN endpoints.
 * The private key is generated on Android and is never sent to the host.
 */
public final class VpnProvisioner {
    private VpnProvisioner() {}

    public static ProvisionedVpn provision(String baseUrl, String token, String devicePublicKey) throws Exception {
        JSONObject deviceResponse = request(baseUrl + "/api/remote-access/device?token=" + Uri.encode(token), token, "GET", null);
        JSONObject device = deviceResponse.getJSONObject("device");
        String deviceId = device.getString("id");

        JSONObject body = new JSONObject().put("publicKey", devicePublicKey);
        JSONObject response = request(baseUrl + "/api/remote-access/devices/" + Uri.encode(deviceId) + "/wireguard", token, "POST", body.toString());
        JSONObject vpn = response.getJSONObject("vpn");
        return new ProvisionedVpn(
                deviceId,
                vpn.getString("address"),
                vpn.getString("serverPublicKey"),
                vpn.getString("endpoint"),
                vpn.optString("allowedIps", "0.0.0.0/0"),
                vpn.optString("dns", ""),
                vpn.optInt("persistentKeepalive", 25)
        );
    }

    private static JSONObject request(String address, String token, String method, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }
        int code = connection.getResponseCode();
        String response = read(code >= 400 ? connection.getErrorStream() : connection.getInputStream());
        if (code < 200 || code >= 300) {
            String message;
            try {
                message = new JSONObject(response).optString("error", "Request failed (" + code + ")");
            } catch (Exception ignored) {
                message = "Request failed (" + code + ")";
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

    public static final class ProvisionedVpn {
        public final String deviceId;
        public final String address;
        public final String serverPublicKey;
        public final String endpoint;
        public final String allowedIps;
        public final String dns;
        public final int persistentKeepalive;

        private ProvisionedVpn(String deviceId, String address, String serverPublicKey, String endpoint, String allowedIps, String dns, int persistentKeepalive) {
            this.deviceId = deviceId;
            this.address = address;
            this.serverPublicKey = serverPublicKey;
            this.endpoint = endpoint;
            this.allowedIps = allowedIps;
            this.dns = dns;
            this.persistentKeepalive = persistentKeepalive;
        }

        public String config(String privateKey) {
            StringBuilder result = new StringBuilder()
                    .append("[Interface]\n")
                    .append("PrivateKey = ").append(privateKey).append('\n')
                    .append("Address = ").append(address).append('\n');
            if (!dns.isEmpty()) result.append("DNS = ").append(dns).append('\n');
            result.append('\n')
                    .append("[Peer]\n")
                    .append("PublicKey = ").append(serverPublicKey).append('\n')
                    .append("AllowedIPs = ").append(allowedIps).append('\n')
                    .append("Endpoint = ").append(endpoint).append('\n')
                    .append("PersistentKeepalive = ").append(persistentKeepalive).append('\n');
            return result.toString();
        }
    }
}
