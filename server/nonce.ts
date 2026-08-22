// 60s TTL dedupe for POST /messages. Keyed by botId + clientNonce so a
// double-submit or retry of the same send is dropped, while the same nonce
// on a different bot is not.

export const NONCE_TTL_MS = 60_000;

export type NonceCache = {
  /** true when this bot+nonce was already accepted within the TTL. */
  isDuplicate(botId: string, nonce: string | undefined, now?: number): boolean;
  record(botId: string, nonce: string | undefined, now?: number): void;
  forget(botId: string, nonce: string | undefined): void;
  prune(now?: number): void;
};

export function createNonceCache(ttlMs = NONCE_TTL_MS): NonceCache {
  const seen = new Map<string, number>();
  const keyOf = (botId: string, nonce: string) => `${botId}\0${nonce}`;

  function prune(now = Date.now()) {
    for (const [k, t] of seen) {
      if (now - t > ttlMs) seen.delete(k);
    }
  }

  return {
    prune,
    isDuplicate(botId, nonce, now = Date.now()) {
      if (!nonce) return false;
      prune(now);
      const t = seen.get(keyOf(botId, nonce));
      return t !== undefined && now - t <= ttlMs;
    },
    record(botId, nonce, now = Date.now()) {
      if (!nonce) return;
      prune(now);
      seen.set(keyOf(botId, nonce), now);
    },
    forget(botId, nonce) {
      if (!nonce) return;
      seen.delete(keyOf(botId, nonce));
    },
  };
}
