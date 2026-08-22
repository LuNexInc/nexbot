// Plugins marketplace, backed by Composio Connect. Catalog comes
// from /api/connectors/catalog. Icons resolve logo → favicon → monogram.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";

interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  domain: string | null;
}

function ServiceIcon({ card }: { card: ToolkitCard }) {
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return <img src={card.logo} alt="" className="size-8 rounded-md" onError={() => setStage(1)} />;
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        className="size-8 rounded-md"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className="flex size-8 items-center justify-center rounded-md bg-raised text-[13px] font-semibold text-ink-secondary">
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function ConnectorsBody({ embedded }: { embedded?: boolean }) {
  const { dispatch } = useStore();
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState(true);
  const [status, setStatus] = useState<Record<string, { connected: boolean }>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"marketplace" | "yours">("marketplace");

  const refreshStatus = useCallback((slugs: string[]) => {
    if (!slugs.length) return Promise.resolve();
    setRefreshing(true);
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => setStatus(r.services ?? {}))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setConfigured(Boolean(r.configured));
        if (r.configured) void refreshStatus((r.cards ?? []).map((c: ToolkitCard) => c.slug).slice(0, 40));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

  const connect = (slug: string) => {
    setBusySlug(slug);
    setError(null);
    api(`/api/connectors/${slug}/authorize`, { method: "POST" })
      .then(({ url }) => {
        window.open(url);
        let tries = 0;
        const timer = setInterval(() => {
          void refreshStatus([slug]);
          if (++tries >= 6 || status[slug]?.connected) clearInterval(timer);
        }, 5000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const disconnect = (slug: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const visible = (cards ?? []).filter((c) => {
    if (search && !`${c.label} ${c.slug} ${c.blurb}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (view === "yours" && !status[c.slug]?.connected) return false;
    return true;
  });

  const openSettings = () => {
    dispatch({ type: "togglePlugins", open: false });
    dispatch({ type: "toggleAppSettings", open: true });
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", embedded && "pt-1")}>
      {!embedded && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-[17px] font-semibold text-ink">Plugins</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => refreshStatus(visible.map((c) => c.slug).slice(0, 40))}
                className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
                title="Refresh connection status"
              >
                <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
              </button>
              <button
                onClick={() => dispatch({ type: "togglePlugins", open: false })}
                className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="mt-1 text-[13px] text-ink-secondary">Search and connect apps your bots can use.</div>
        </>
      )}

      <div className="mt-2 flex gap-1">
        {(["marketplace", "yours"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px]",
              view === v ? "bg-black/8 text-ink" : "text-ink-secondary hover:bg-black/4 hover:text-ink",
            )}
          >
            {v === "marketplace" ? "Marketplace" : "Yours"}
          </button>
        ))}
        <button
          onClick={() => refreshStatus((cards ?? []).map((c) => c.slug).slice(0, 40))}
          className="ml-auto rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>

      {!configured && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
          No Composio Connect key yet —{" "}
          <button className="underline" onClick={openSettings}>
            add one in App Settings
          </button>{" "}
          to connect apps.
        </div>
      )}
      {configured && source === "curated" && view === "marketplace" && (
        <div className="mt-3 text-[12px] text-ink-secondary">
          Showing a curated set.{" "}
          <button className="underline hover:text-ink" onClick={openSettings}>
            Add a Composio API key
          </button>{" "}
          to browse the full catalog.
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={view === "yours" ? "Search installed" : "Search plugins"}
        className="mt-3 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
      />

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline/40">
        {cards === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> Loading catalog…
          </div>
        ) : (
          visible.map((card, i) => {
            const connected = status[card.slug]?.connected;
            const busy = busySlug === card.slug;
            return (
              <div
                key={card.slug}
                className={cn("flex items-center gap-3 bg-card px-4 py-3", i > 0 && "border-t border-hairline/40")}
              >
                <ServiceIcon card={card} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                    {card.label}
                    {connected && <span className="size-1.5 rounded-full bg-success" />}
                  </div>
                  <div className="truncate text-[12px] text-ink-secondary">{card.blurb}</div>
                </div>
                <button
                  disabled={!configured || busy}
                  onClick={() => (connected ? disconnect(card.slug) : connect(card.slug))}
                  className={cn(
                    "w-[104px] rounded-lg py-1.5 text-[13px] disabled:opacity-50",
                    connected
                      ? "bg-raised text-ink-secondary hover:text-danger"
                      : "bg-raised text-ink hover:bg-raised-hover",
                  )}
                >
                  {busy ? (
                    <Loader2 size={13} className="mx-auto animate-spin" />
                  ) : connected ? (
                    "Disconnect"
                  ) : (
                    "Authenticate"
                  )}
                </button>
              </div>
            );
          })
        )}
        {cards !== null && visible.length === 0 && (
          <div className="py-8 text-center text-[13px] text-ink-secondary">
            {view === "yours" ? "Nothing installed yet." : "No plugins match."}
          </div>
        )}
      </div>
    </div>
  );
}

export function PluginsPanel() {
  const { dispatch } = useStore();
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/15"
      onClick={() => dispatch({ type: "togglePlugins", open: false })}
    >
      <div
        className="glass-heavy animate-panel-in flex max-h-[85%] w-[680px] flex-col rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ConnectorsBody />
      </div>
    </div>
  );
}
