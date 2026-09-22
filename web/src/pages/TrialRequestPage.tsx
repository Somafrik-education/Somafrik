import { FormEvent, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { API_URL } from "../lib/apiUrl";
import { marketingSkipLink } from "../data/marketingContent";
import { FRANCOPHONE_AFRICA_COUNTRIES } from "../data/francophoneAfricaCountries";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import { MarketingFooter } from "../components/marketing/MarketingFooter";

const SUCCESS_COPY = "Un responsable Somafrik vous contactera pour activer votre essai.";

const ROLES = [
  { value: "chef_etablissement", label: "Chef d'établissement" },
  { value: "promoteur", label: "Promoteur" },
  { value: "directeur", label: "Directeur" },
  { value: "administrateur", label: "Administrateur" },
] as const;

const STUDENT_BANDS = ["1-50", "50-100", "100-300", "300-800", "800+"] as const;

type FormStatus = "idle" | "sending" | "ok" | "error";

export function TrialRequestPage() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(`${API_URL.replace(/\/$/, "")}/api/public/trial-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterName: String(data.get("requesterName") ?? "").trim(),
          role: String(data.get("role") ?? "").trim(),
          schoolName: String(data.get("schoolName") ?? "").trim(),
          countryIso: String(data.get("countryIso") ?? "").trim(),
          city: String(data.get("city") ?? "").trim(),
          phone: String(data.get("phone") ?? "").trim(),
          email: String(data.get("email") ?? "").trim(),
          studentBand: String(data.get("studentBand") ?? "").trim(),
          website: String(data.get("website") ?? "").trim(),
          consent: data.get("consent") === "on",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : "Demande refusée",
        );
      }
      setStatus("ok");
      setMessage(SUCCESS_COPY);
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Impossible d’enregistrer la demande.");
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
        <p className="text-xs font-bold uppercase tracking-wide text-brand">Essai 30 jours</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">
          Demander 1 mois d'essai gratuit
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Décrivez votre établissement. Aucun compte, aucun tenant et aucun abonnement ne sont créés
          automatiquement. {SUCCESS_COPY}
        </p>

        <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate={false}>
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

          <Field label="Nom du demandeur" htmlFor="requesterName">
            <input
              id="requesterName"
              name="requesterName"
              required
              className={inputClass}
              placeholder="Nom du demandeur"
            />
          </Field>

          <Field label="Rôle" htmlFor="role">
            <select id="role" name="role" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Choisir un rôle
              </option>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nom de l'établissement" htmlFor="schoolName">
            <input
              id="schoolName"
              name="schoolName"
              required
              className={inputClass}
              placeholder="Nom de l'établissement"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pays" htmlFor="countryIso">
              <select id="countryIso" name="countryIso" required className={inputClass} defaultValue="CD">
                {FRANCOPHONE_AFRICA_COUNTRIES.map((country) => (
                  <option key={country.iso} value={country.iso}>
                    {country.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ville" htmlFor="city">
              <input id="city" name="city" required className={inputClass} placeholder="Ville" />
            </Field>
          </div>

          <Field label="WhatsApp / téléphone" htmlFor="phone">
            <input
              id="phone"
              name="phone"
              required
              className={inputClass}
              placeholder="+243…"
              inputMode="tel"
            />
          </Field>

          <Field label="E-mail" htmlFor="email">
            <input
              id="email"
              name="email"
              type="email"
              required
              className={inputClass}
              placeholder="contact@ecole.cd"
            />
          </Field>

          <Field label="Nombre d'élèves" htmlFor="studentBand">
            <select id="studentBand" name="studentBand" required className={inputClass} defaultValue="100-300">
              {STUDENT_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band} élèves
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-start gap-3 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input id="consent" name="consent" type="checkbox" required className="mt-1 h-4 w-4" />
            <span>
              J’accepte le traitement de cette demande d’essai, conformément à la{" "}
              <Link to="/confidentialite" className="font-bold text-brand underline">
                politique de confidentialité
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={status === "sending"}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-gradient px-6 py-3 text-base font-bold text-white shadow-brand disabled:opacity-70"
          >
            {status === "sending" ? "Envoi…" : "Demander 1 mois d'essai gratuit"}
          </button>
        </form>

        {message ? (
          <p
            role="status"
            className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${
              status === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-danger/10 text-danger"
            }`}
          >
            {message}
          </p>
        ) : null}
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
