import { FormEvent, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MarketingFooter } from "../components/marketing/MarketingFooter";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import { demoDiscoveryRoles, demoPageCopy, demoProfiles } from "../data/demoMarketing";
import { FRANCOPHONE_AFRICA_COUNTRIES } from "../data/francophoneAfricaCountries";
import { marketingSkipLink } from "../data/marketingContent";
import { publicDemoEnabled } from "../lib/featureFlags";
import { navigateToDemo } from "../lib/demoNavigation";

type FormStatus = "idle" | "sending" | "error";

function demoWebOrigin(): string {
  return String(import.meta.env.VITE_DEMO_WEB_ORIGIN || "https://demo.somafrik.app").replace(/\/$/, "");
}

function demoEntryApiUrl(): string {
  const value = String(import.meta.env.VITE_DEMO_ENTRY_API_URL || "").trim().replace(/\/$/, "");
  if (!value) {
    throw new Error("La démonstration n’est pas encore disponible.");
  }
  return value;
}

export function isAllowedDemoRedirect(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const target = new URL(value);
    const expected = new URL(demoWebOrigin());
    if (target.origin !== expected.origin) return false;
    if (target.protocol === "https:") return true;
    return (
      target.protocol === "http:" &&
      (target.hostname === "localhost" || target.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function DemoEntryPage() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicDemoEnabled || status === "sending") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch(`${demoEntryApiUrl()}/api/public/demo-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: String(data.get("profile") ?? "").trim(),
          discoveryRole: String(data.get("discoveryRole") ?? "").trim(),
          countryIso: String(data.get("countryIso") ?? "").trim(),
          organizationName: String(data.get("organizationName") ?? "").trim(),
          website: String(data.get("website") ?? "").trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : "Impossible de créer la session de démonstration.",
        );
      }

      if (!isAllowedDemoRedirect(payload.redirectUrl)) {
        throw new Error("Redirection de démo invalide.");
      }

      navigateToDemo(payload.redirectUrl);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Impossible de créer la session de démonstration.",
      );
    }
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-white text-ink">
      <a
        href={marketingSkipLink.href}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:font-bold focus:text-white"
      >
        {marketingSkipLink.label}
      </a>
      <MarketingHeader />
      <main id="contenu" className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{demoPageCopy.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">{demoPageCopy.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">{demoPageCopy.intro}</p>
        <p className="mt-2 text-sm font-medium text-slate-500">{demoPageCopy.privacy}</p>

        {!publicDemoEnabled ? (
          <div className="mt-8 rounded-2xl border border-brand-100 bg-brand-50 p-5">
            <p className="text-sm leading-relaxed text-slate-700">{demoPageCopy.disabled}</p>
            <Link
              to="/demande-essai"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-gradient px-5 py-3 text-sm font-bold text-white shadow-brand"
            >
              Demander 1 mois d&apos;essai gratuit
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="website">
              Site web
            </label>
            <input
              id="website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              className="hidden"
              aria-hidden="true"
            />

            <Field label="Votre profil" htmlFor="profile">
              <select id="profile" name="profile" required className={inputClass} defaultValue="">
                <option value="" disabled>
                  Choisir un profil
                </option>
                {demoProfiles.map((profile) => (
                  <option key={profile.value} value={profile.value}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Votre rôle dans la découverte de Somafrik" htmlFor="discoveryRole">
              <select
                id="discoveryRole"
                name="discoveryRole"
                required
                className={inputClass}
                defaultValue=""
              >
                <option value="" disabled>
                  Choisir votre rôle
                </option>
                {demoDiscoveryRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Pays" htmlFor="countryIso">
              <select id="countryIso" name="countryIso" required className={inputClass} defaultValue="CD">
                {FRANCOPHONE_AFRICA_COUNTRIES.map((country) => (
                  <option key={country.iso} value={country.iso}>
                    {country.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Établissement ou organisation (facultatif)" htmlFor="organizationName">
              <input
                id="organizationName"
                name="organizationName"
                className={inputClass}
                autoComplete="organization"
                placeholder="Nom de votre établissement ou organisation"
              />
            </Field>

            <button
              type="submit"
              disabled={status === "sending"}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-gradient px-6 py-3 text-base font-bold text-white shadow-brand disabled:opacity-70"
            >
              {status === "sending" ? "Préparation de la démo…" : "Entrer dans la démo"}
            </button>
          </form>
        )}

        {message ? (
          <p role="status" className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {message}
          </p>
        ) : null}

        <p className="mt-8 text-center text-sm text-slate-500">
          Votre établissement veut tester Somafrik avec son propre périmètre ?{" "}
          <Link to="/demande-essai" className="font-bold text-brand underline">
            Demandez un mois d&apos;essai gratuit
          </Link>
          .
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-bold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}
