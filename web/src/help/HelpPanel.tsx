import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  filterHelpArticles,
  navigationIsAllowed,
  popularHelpArticles,
  searchHelpArticles,
  suggestHelpArticles,
  type HelpArticle,
  type HelpContext,
} from "@somafrik/help-catalog";
import { HELP_PANEL_ZCLASS } from "./helpZIndex";
import { cn } from "../lib/utils";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
  );
}

export interface HelpPanelProps {
  context: HelpContext;
  onClose: () => void;
  onNavigate: (webPath: string) => void;
}

export function HelpPanel({ context, onClose, onNavigate }: HelpPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const allowed = useMemo(() => filterHelpArticles(context), [context]);
  const suggestions = useMemo(() => suggestHelpArticles(context), [context]);
  const popular = useMemo(() => popularHelpArticles(context), [context]);
  const searchResults = useMemo(() => searchHelpArticles(context, query), [context, query]);
  const popularExclusive = useMemo(
    () => popular.filter((article) => !suggestions.some((suggestion) => suggestion.id === article.id)),
    [popular, suggestions],
  );
  const activeArticle = allowed.find((article) => article.id === activeId) ?? null;
  const related = (activeArticle?.relatedArticles ?? [])
    .map((id) => allowed.find((article) => article.id === id))
    .filter((article): article is HelpArticle => Boolean(article));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const root = panelRef.current;
    if (!root) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const nodes = focusableElements(root);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleNavigate(article: HelpArticle) {
    if (!navigationIsAllowed(article, context)) return;
    const path = article.navigate?.webPath;
    if (typeof path !== "string" || path.trim() === "") return;
    onNavigate(path);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className={cn("no-print fixed inset-0", HELP_PANEL_ZCLASS)}>
      <div
        className="absolute inset-0 bg-ink/30"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-white shadow-card"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-4">
          <h2 id="help-panel-title" className="text-base font-bold text-ink">
            Besoin d’aide ?
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-slate-50 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-label="Fermer l’aide"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {activeArticle ? (
            <ArticleView
              article={activeArticle}
              related={related}
              canNavigate={navigationIsAllowed(activeArticle, context)}
              onBack={() => setActiveId(null)}
              onOpenRelated={(id) => setActiveId(id)}
              onNavigate={() => handleNavigate(activeArticle)}
            />
          ) : (
            <BrowseView
              query={query}
              onQueryChange={setQuery}
              onSearchKeyDown={onSearchKeyDown}
              suggestions={suggestions}
              popular={popularExclusive}
              searchResults={searchResults}
              onOpen={setActiveId}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function BrowseView({
  query,
  onQueryChange,
  onSearchKeyDown,
  suggestions,
  popular,
  searchResults,
  onOpen,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  suggestions: readonly HelpArticle[];
  popular: readonly HelpArticle[];
  searchResults: readonly HelpArticle[];
  onOpen: (id: string) => void;
}) {
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="sr-only">Rechercher dans l’aide</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Rechercher dans l’aide"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        />
      </label>

      {searching ? (
        <ArticleList
          heading="Résultats"
          articles={searchResults}
          empty="Aucun article pour cette recherche."
          onOpen={onOpen}
        />
      ) : (
        <>
          <ArticleList
            heading="Suggestions pour cet écran"
            articles={suggestions}
            empty="Aucune suggestion pour cet écran."
            onOpen={onOpen}
          />
          <ArticleList
            heading="Guides populaires"
            articles={popular}
            empty="Aucun guide populaire pour votre rôle."
            onOpen={onOpen}
          />
        </>
      )}
    </div>
  );
}

function ArticleList({
  heading,
  articles,
  empty,
  onOpen,
}: {
  heading: string;
  articles: readonly HelpArticle[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{heading}</h3>
      {articles.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {articles.map((article) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => onOpen(article.id)}
                className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <span className="font-semibold text-ink">{article.title}</span>
                <span className="mt-0.5 block text-muted">{article.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ArticleView({
  article,
  related,
  canNavigate,
  onBack,
  onOpenRelated,
  onNavigate,
}: {
  article: HelpArticle;
  related: HelpArticle[];
  canNavigate: boolean;
  onBack: () => void;
  onOpenRelated: (id: string) => void;
  onNavigate: () => void;
}) {
  return (
    <article className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        Retour à l’aide
      </button>
      <div>
        <h3 className="text-lg font-bold text-ink">{article.title}</h3>
        <p className="mt-1 text-sm text-muted">{article.summary}</p>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
        {article.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {canNavigate ? (
        <button
          type="button"
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white outline-none hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          Ouvrir cet écran
        </button>
      ) : null}
      {related.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Articles liés</h4>
          <ul className="mt-2 space-y-2">
            {related.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenRelated(item.id)}
                  className="text-sm font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
