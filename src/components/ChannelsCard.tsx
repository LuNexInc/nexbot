// Per-bot Channels: Composio messaging apps this desk can use.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";

const CHANNEL_SLUGS = new Set([
  "slack",
  "discord",
  "telegram",
  "msteams",
  "microsoft_teams",
  "microsoftteams",
  "teams",
  "googlechat",
  "google_chat",
  "whatsapp",
  "mattermost",
  "zoom",
  "guilded",
]);

type Card = { slug: string; label: string; blurb: string };

function isChannel(slug: string, label: string) {
  const s = slug.toLowerCase().replace(/[-_]/g, "");
  if (CHANNEL_SLUGS.has(slug.toLowerCase())) return true;
  return ["slack", "discord", "telegram", "teams", "whatsapp", "mattermost"].some((k) => s.includes(k) || label.toLowerCase().includes(k));
}

const POLL_MS = 5_000;
const TIMEOUT_MS = 60_000;

export function ChannelsCard() {
  const { dispatch } = useStore();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Record<string, { connected: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<{ slug: string; timer: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);

  const refresh = useCallback((slugs: string[]) => {
    if (!slugs.length) return Promise.resolve({} as Record<string, { connected: boolean }>);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const next = (r.services ?? {}) as Record<string, { connected: boolean }>;
        setStatus((cur) => ({ ...cur, ...next }));
        return next;
      })
      .catch(() => ({} as Record<string, { connected: boolean }>));
  }, []);

  const stopWatch = useCallback(() => {
    const w = watchRef.current;
    if (!w) return;
    clearInterval(w.timer);
    clearTimeout(w.timeout);
    watchRef.current = null;
  }, []);

  const checkSlug = useCallback(
    async (slug: string) => {
      const next = await refresh([slug]);
      if (next[slug]?.connected) {
        stopWatch();
        setBusy((cur) => (cur === slug ? null : cur));
        return true;
      }
      return false;
    },
    [refresh, stopWatch],
  );

  const startWatch = useCallback(
    (slug: string) => {
      stopWatch();
      void checkSlug(slug);
      const timer = setInterval(() => {
        void checkSlug(slug);
      }, POLL_MS);
      const timeout = setTimeout(() => {
        stopWatch();
        setBusy((cur) => (cur === slug ? null : cur));
      }, TIMEOUT_MS);
      watchRef.current = { slug, timer, timeout };
    },
    [checkSlug, stopWatch],
  );

  useEffect(() => {
    api("/api/connectors/catalog")
      .then((r) => {
        setConfigured(Boolean(r.configured));
        const list: Card[] = (r.cards ?? []).filter((c: Card) => isChannel(c.slug, c.label));
        setCards(list);
        if (r.configured) void refresh(list.map((c) => c.slug).slice(0, 20));
      })
      .catch(() => setCards([]));
  }, [refresh]);

  useEffect(() => {
    const onReturn = () => {
      const slug = watchRef.current?.slug;
      if (!slug) return;
      if (document.visibilityState && document.visibilityState !== "visible") return;
      void checkSlug(slug);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [checkSlug]);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const connect = (slug: string) => {
    setBusy(slug);
    setError(null);
    api(`/api/connectors/${slug}/authorize`, { method: "POST" })
      .then(({ url }) => {
        window.open(url);
        startWatch(slug);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        stopWatch();
        setBusy(null);
      });
  };

  const disconnect = (slug: string) => {
    stopWatch();
    setBusy(slug);
    setError(null);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => refresh([slug]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const connected = (cards ?? []).filter((c) => status[c.slug]?.connected);
  const rest = (cards ?? []).filter((c) => !status[c.slug]?.connected).slice(0, 8);

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Channels</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        Messaging apps via Composio. Same connections as Plugins.
      </div>
      {!configured && (
        <button
          className="mt-3 text-left text-[13px] text-accent underline"
          onClick={() => dispatch({ type: "toggleAppSettings", open: true })}
        >
          Add a Composio key in Settings → Plugins to connect channels.
        </button>
      )}
      {cards === null && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-secondary">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      {connected.map((c) => (
        <div key={c.slug} className="mt-2 flex items-center justify-between gap-2 text-[13px] text-ink">
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-success" />
            {c.label}
            <span className="text-[11px] text-success">Connected</span>
          </span>
          <button
            type="button"
            disabled={busy === c.slug}
            onClick={() => disconnect(c.slug)}
            className={cn("rounded-lg bg-raised px-2.5 py-1 text-[12px] text-ink-secondary hover:text-danger disabled:opacity-50")}
          >
            {busy === c.slug ? <Loader2 size={12} className="animate-spin" /> : "Disconnect"}
          </button>
        </div>
      ))}
      {configured && rest.map((c) => (
        <div key={c.slug} className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[13px] text-ink">{c.label}</span>
          <button
            type="button"
            disabled={busy === c.slug}
            onClick={() => connect(c.slug)}
            className={cn("rounded-lg bg-raised px-2.5 py-1 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50")}
          >
            {busy === c.slug ? <Loader2 size={12} className="animate-spin" /> : "Authenticate"}
          </button>
        </div>
      ))}
      {cards !== null && configured && connected.length === 0 && rest.length === 0 && (
        <div className="mt-3 text-[13px] text-ink-secondary">No channel apps in the catalog.</div>
      )}
    </div>
  );
}
