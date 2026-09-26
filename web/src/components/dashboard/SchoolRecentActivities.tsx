import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { formatDateTimeForDisplay } from "../../lib/dates";
import { DASHBOARD_SYNC_EVENT, DASHBOARD_SYNC_INTERVAL_MS } from "../../lib/dashboardSync";

/** Libellé relatif français ; la date exacte reste accessible au survol. */
function relativeActivityTime(value: string, now: number): string {
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return "Date indisponible";
  const elapsed = Math.max(0, Math.floor((now - at) / 1000));
  if (elapsed < 60) return "À l'instant";
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days} jour${days > 1 ? "s" : ""}`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `Il y a ${weeks} semaine${weeks > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (days < 365) return `Il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return `Il y a ${years} an${years > 1 ? "s" : ""}`;
}

type Activity = { id: string; label: string; at: string; detail?: string | null };
type Page = { items: Activity[]; nextCursor: string | null };

export function SchoolRecentActivities({ enabled, schoolKey }: { enabled: boolean; schoolKey: string }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setError(false);
    setRevision((value) => value + 1);
  }, [schoolKey, enabled]);

  useEffect(() => {
    if (!enabled || !schoolKey) return;
    let cancelled = false;
    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const page = await api.get<Page>("/dashboard/school-activities?limit=10");
        if (cancelled) return;
        if (!page || !Array.isArray(page.items)) { setError(true); return; }
        setNow(Date.now());
        setItems((previous) => {
          const seen = new Set<string>();
          return [...page.items, ...previous].filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          }).slice(0, 60);
        });
        setCursor((previous) => previous ?? page.nextCursor);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void refresh();
    // Same-tab attendance/planning writes trigger an immediate refresh.
    // Short fallback covers updates made by other connected users.
    const timer = window.setInterval(() => void refresh(), DASHBOARD_SYNC_INTERVAL_MS);
    const onFocus = () => void refresh();
    window.addEventListener(DASHBOARD_SYNC_EVENT, onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(DASHBOARD_SYNC_EVENT, onFocus);
    };
  }, [enabled, schoolKey, revision]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.get<Page>(`/dashboard/school-activities?limit=10&cursor=${encodeURIComponent(cursor)}`);
      if (!page || !Array.isArray(page.items)) { setError(true); return; }
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  if (!enabled) return <p className="mt-4 text-sm text-muted">Activités réservées à l'administration de l'établissement.</p>;
  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      {error ? <p role="alert" className="text-sm text-rose-700">Actualisation indisponible. Réessayez ultérieurement.</p> : null}
      {!items.length && !error ? <p className="text-sm text-muted">Aucune activité récente.</p> : null}
      <ol className="max-h-[560px] space-y-2 overflow-y-auto xl:max-h-[min(75vh,900px)] pr-1">
        {items.map((item) => (
          <li key={item.id} className="border-b border-line pb-2">
            <p className="text-xs font-semibold text-ink">{item.label}</p>
            {item.detail ? <p className="text-xs text-ink">{item.detail}</p> : null}
            <time className="text-xs text-muted" dateTime={item.at} title={formatDateTimeForDisplay(item.at)}>{relativeActivityTime(item.at, now)}</time>
          </li>
        ))}
      </ol>
      {cursor ? (
        <button type="button" disabled={loading} onClick={() => void loadMore()} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50">
          {loading ? "Chargement…" : "Voir plus"}
        </button>
      ) : null}
    </div>
  );
}
