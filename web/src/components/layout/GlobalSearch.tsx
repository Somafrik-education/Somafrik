import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { canReadView } from "../../lib/permissions";
import { scopedSchools, scopedUsers } from "../../lib/scope";
import { scopedStudents } from "../../lib/establishment";
import { displayRoleName, normalize } from "../../lib/format";

interface SearchHit {
  id: string;
  group: string;
  label: string;
  sub: string;
  to: string;
}

const MAX_PER_GROUP = 5;

/** Recherche globale (FONC-003) : comptes, contacts, utilisateurs, élèves. */
export function GlobalSearch() {
  const { session } = useAuth();
  const { state } = useData();
  const ctx = usePermissionContext();
  const navigate = useNavigate();
  const user = session?.user ?? null;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const canSchools = canReadView(ctx, "schools");
  const canUsers = canReadView(ctx, "users");
  const canStudents = canReadView(ctx, "students");

  const hits = useMemo<SearchHit[]>(() => {
    const q = normalize(query);
    if (q.length < 2) return [];
    const results: SearchHit[] = [];

    if (canSchools) {
      scopedSchools(user, state)
        .filter((s) => [s.name, s.code, s.city, s.email].some((v) => normalize(v).includes(q)))
        .slice(0, MAX_PER_GROUP)
        .forEach((s) =>
          results.push({
            id: `school-${s.code}`,
            group: "Établissements",
            label: String(s.name ?? s.code),
            sub: `${s.code}${s.city ? ` · ${s.city}` : ""}`,
            to: "/etablissements",
          }),
        );
    }

    if (canUsers) {
      (scopedUsers(user, state) as unknown as Record<string, unknown>[])
        .filter((u) =>
          [u.firstName, u.lastName, u.identifier, u.email, u.phone].some((v) =>
            normalize(String(v ?? "")).includes(q),
          ),
        )
        .slice(0, MAX_PER_GROUP)
        .forEach((u) =>
          results.push({
            id: `user-${String(u.id ?? u.identifier)}`,
            group: "Utilisateurs",
            label:
              `${String(u.firstName ?? "")} ${String(u.lastName ?? "")}`.trim() ||
              String(u.identifier ?? ""),
            sub: [String(u.identifier ?? ""), displayRoleName(String(u.role ?? ""))].filter(Boolean).join(" · "),
            to: "/etablissement/comptes-utilisateurs",
          }),
        );
    }

    if (canStudents) {
      (scopedStudents(user, state) as Record<string, unknown>[])
        .filter((s) =>
          [s.name, s.firstName, s.matricule, s.publicId, s.studentCode, s.loginCode, s.identifier].some((v) =>
            normalize(String(v ?? "")).includes(q),
          ),
        )
        .slice(0, MAX_PER_GROUP)
        .forEach((s) =>
          results.push({
            id: `student-${String(s.id)}`,
            group: "Élèves",
            label: `${String(s.name ?? "")} ${String(s.firstName ?? "")}`.trim(),
            sub: [String(s.matricule ?? s.publicId ?? ""), String(s.className ?? "")]
              .filter(Boolean)
              .join(" · "),
            to: "/etablissement/eleves",
          }),
        );
    }

    return results;
  }, [query, state, user, canSchools, canUsers, canStudents]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.group) ?? [];
      list.push(hit);
      map.set(hit.group, list);
    }
    return [...map.entries()];
  }, [hits]);

  if (!canSchools && !canUsers && !canStudents) return null;

  function goTo(to: string) {
    setOpen(false);
    setQuery("");
    navigate(to);
  }

  function openMobileSearch() {
    setOpen(true);
    window.requestAnimationFrame(() => mobileInputRef.current?.focus());
  }

  const searchReady = query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={openMobileSearch}
        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-50 hover:text-ink md:hidden"
        aria-label="Ouvrir la recherche globale"
        aria-expanded={open}
      >
        <Search className="h-5 w-5" strokeWidth={1.8} />
      </button>

      <div className="hidden items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-1.5 md:flex">
        <Search className="h-4 w-4 text-slate-400" strokeWidth={1.8} />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un compte, contact, utilisateur…"
          className="w-56 bg-transparent text-sm outline-none placeholder:text-slate-400"
          aria-label="Recherche globale"
        />
      </div>

      {open ? (
        <div
          className={`fixed inset-x-4 top-16 z-40 max-h-[calc(100vh-5rem)] overflow-auto rounded-xl border border-line bg-white p-2 shadow-lg md:absolute md:inset-x-auto md:right-0 md:top-auto md:mt-2 md:max-h-[420px] md:w-80 ${
            searchReady ? "" : "md:hidden"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-line p-1 pb-2 md:hidden">
            <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.8} />
            <input
              ref={mobileInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              aria-label="Recherche globale mobile"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-ink"
              aria-label="Fermer la recherche"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!searchReady ? (
            <p className="px-3 py-4 text-center text-sm text-muted md:hidden">
              Saisissez au moins 2 caractères.
            </p>
          ) : grouped.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted">Aucun résultat.</p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-1">
                <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  {group}
                </p>
                {items.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => goTo(hit.to)}
                    className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-ink">{hit.label || "—"}</span>
                    {hit.sub ? <span className="text-xs text-muted">{hit.sub}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
