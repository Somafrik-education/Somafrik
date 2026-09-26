import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { formatDateTimeForDisplay } from "../../lib/dates";

type Activity = { id: string; label: string; at: string };
type Page = { items: Activity[]; nextCursor: string | null };

export function SchoolRecentActivities({ enabled, schoolKey }: { enabled: boolean; schoolKey: string }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

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
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, schoolKey, revision]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await api.get<Page>(`/dashboard/school-activities?limit=10&cursor=${encodeURIComponent(cursor)}`);
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
    <div className="mt-4 space-y-3" aria-live="polite">
      {error ? <p role="alert" className="text-sm text-rose-700">Actualisation indisponible. Réessayez ultérieurement.</p> : null}
      {!items.length && !error ? <p className="text-sm text-muted">Aucune activité récente.</p> : null}
      <ol className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="border-b border-line pb-2">
            <p className="text-sm font-semibold text-ink">{item.label}</p>
            <time className="text-xs text-muted" dateTime={item.at}>{formatDateTimeForDisplay(item.at)}</time>
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
