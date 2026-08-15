package com.lunexinc.nexbotconnect;

import android.content.Context;

import com.wireguard.android.backend.Backend;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;
import com.wireguard.config.Config;

import java.io.BufferedReader;
import java.io.StringReader;

/**
 * Small adapter around the official embeddable WireGuard Android library.
 * The host provisioning API will supply the config in the next Connect phase.
 */
public final class WireGuardTunnelController {
    private final Backend backend;
    private final Tunnel tunnel = new Tunnel() {
        @Override
        public String getName() {
            return "nexbot";
        }

        @Override
        public void onStateChange(State newState) {
            // The activity observes state through state() after each operation.
        }
    };

    public WireGuardTunnelController(Context context) {
        backend = new GoBackend(context.getApplicationContext());
    }

    public Tunnel.State state() throws Exception {
        return backend.getState(tunnel);
    }

    public Tunnel.State connect(String wireguardConfig) throws Exception {
        Config config = Config.parse(new BufferedReader(new StringReader(wireguardConfig)));
        return backend.setState(tunnel, Tunnel.State.UP, config);
    }

    public Tunnel.State disconnect() throws Exception {
        return backend.setState(tunnel, Tunnel.State.DOWN, null);
    }
}
