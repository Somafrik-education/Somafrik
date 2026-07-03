import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { SOMAFRIK_LOGO_URL } from "../lib/brand";

function formatFrenchList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return `${items[0]}.`;
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}.`;
}

const MODULES = [
  {
    title: "Gestion multi-établissements",
    shortLabel: "Établissements",
    description: "Création, validation, suspension et suivi des écoles ou universités par pays.",
  },
  {
    title: "Utilisateurs et rôles",
    shortLabel: "Utilisateurs et rôles",
    description: "Droits CRUD, suspension, réinitialisation de mot de passe et périmètre par rôle.",
  },
  {
    title: "Scolarité",
    shortLabel: "Scolarité",
    description: "Classes, élèves, enseignants, affectations, présences, notes, examens et bulletins.",
  },
  {
    title: "Finance scolaire",
    shortLabel: "Finance",
    description: "Frais, paiements, reste à payer, impayés et historique détaillé.",
  },
  {
    title: "Communication",
    shortLabel: "Communication",
    description: "Annonces, messages parents, notifications et suivi des statuts lu / non lu.",
  },
  {
    title: "Rapports",
    shortLabel: "Rapports",
    description: "Indicateurs de pilotage par plateforme, pays, établissement et rôle métier.",
  },
] as const;

const MODULE_SUMMARY = formatFrenchList(MODULES.map((module) => module.shortLabel));

const HERO_HIGHLIGHTS = [
  {
    title: "Multi-pays",
    subtitle: "Données séparées par pays",
    detail: "Établissements, utilisateurs et indicateurs isolés par territoire national.",
  },
  {
    title: `${MODULES.length} modules`,
    subtitle: "Socle MVP opérationnel",
    detail: MODULE_SUMMARY,
  },
  {
    title: "Rôles & droits",
    subtitle: "Permissions CRUD ajustables",
    detail: "Matrice configurable par le Superadmin ou par établissement ; chaque profil accède à son périmètre.",
  },
] as const;

const ROLES = [
  {
    index: "01",
    title: "Superadmin",
    description: "Pilote Somafrik : pays, établissements, droits Admin Pays/School, conformité et supervision globale.",
  },
  {
    index: "02",
    title: "Admin pays",
    description: "Gère les établissements, validations et administrateurs scolaires de son pays.",
  },
  {
    index: "03",
    title: "Admin établissement",
    description: "Administre son école : utilisateurs, classes, affectations, communication et rapports.",
  },
  {
    index: "04",
    title: "Rôles configurés",
    description: "Secrétaire, préfet, enseignant, parent et élève accèdent selon les droits accordés.",
  },
];

const SECURITY = [
  "Identification par code établissement et identifiant unique utilisateur.",
  "Données séparées par pays, établissement, rôle et périmètre opérationnel.",
  "Actions synchronisées avec le backend pour éviter les écarts mobile / web.",
  "Matrice de permissions configurable par le Superadmin ou par établissement ; chaque profil accède à son périmètre.",
];

const NAV_LINKS = [
  { href: "#modules", label: "Modules" },
  { href: "#roles", label: "Rôles" },
  { href: "#securite", label: "Sécurité" },
];

function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "article" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      el.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className}`}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-brand-50 text-ink">
      <a
        href="#modules"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:font-bold focus:text-white"
      >
        Aller au contenu
      </a>

      <div className="relative overflow-hidden">
        {/* Décor d'arrière-plan animé */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="animate-blob absolute -right-24 -top-32 h-96 w-96 rounded-full bg-brand/20 blur-3xl" />
          <div className="animate-blob absolute -left-24 top-24 h-80 w-80 rounded-full bg-teal/15 blur-3xl [animation-delay:3s]" />
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="sticky top-3 z-30 mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 shadow-card backdrop-blur-md">
            <BrandLogo size="lg" />

            <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation vitrine">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm font-bold text-muted transition hover:bg-brand-50 hover:text-brand"
                >
                  {link.label}
                </a>
              ))}
              <Link
                to="/connexion"
                className="ml-2 rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-bold text-white shadow-brand transition hover:-translate-y-0.5"
              >
                Connexion
              </Link>
            </nav>

            <Link
              to="/connexion"
              className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-bold text-white shadow-brand md:hidden"
            >
              Connexion
            </Link>
          </header>

          <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[minmax(0,1fr)_420px]">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/70 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-brand">
                <span className="h-2 w-2 rounded-full bg-teal shadow-[0_0_0_3px_rgba(15,118,110,0.18)]" />
                Solution SaaS multi-pays et multi-établissements
              </span>
              <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                La plateforme qui simplifie la gestion de votre établissement scolaire
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
                Une application ERP interne pour piloter les établissements scolaires et universitaires :
                utilisateurs, droits, élèves, enseignants, présences, notes, paiements, communications et rapports.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/connexion"
                  className="rounded-xl bg-brand-gradient px-6 py-3 font-bold text-white shadow-brand transition hover:-translate-y-0.5"
                >
                  Connexion
                </Link>
                <a
                  href="#modules"
                  className="rounded-xl border border-brand-100 bg-white px-6 py-3 font-bold text-brand shadow-card transition hover:-translate-y-0.5 hover:bg-brand-50"
                >
                  Voir les modules
                </a>
              </div>
              <ul
                className="mt-10 grid gap-4 border-t border-dashed border-slate-200 pt-7 sm:grid-cols-3"
                aria-label="Points forts de la plateforme"
              >
                {HERO_HIGHLIGHTS.map((item) => (
                  <li
                    key={item.title}
                    className="rounded-2xl border border-line bg-white/80 p-4 shadow-card backdrop-blur"
                    aria-label={`${item.title} : ${item.subtitle}. ${item.detail}`}
                  >
                    <p className="text-2xl font-black text-ink">{item.title}</p>
                    <p className="mt-1 text-sm font-bold text-brand">{item.subtitle}</p>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-muted">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={120} className="lg:justify-self-end">
              <div className="animate-float w-full rounded-3xl border border-brand-100 bg-white/90 p-6 shadow-lift backdrop-blur">
                <div className="flex items-center gap-3">
                <img
                  src={SOMAFRIK_LOGO_URL}
                  alt="Logo Somafrik"
                  className="h-24 w-24 shrink-0 rounded-2xl bg-white object-contain p-1 shadow-sm ring-1 ring-black/5 sm:h-28 sm:w-28"
                />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-brand">Accès sécurisé</p>
                    <h2 className="text-xl font-black">Connexion Somafrik</h2>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {["Superadmin", "Admin pays", "Admin établissement"].map((profile) => (
                    <div
                      key={profile}
                      className="rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600"
                    >
                      {profile}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs font-semibold leading-relaxed text-muted">
                  Les autres rôles entrent selon les accès configurés par le Superadmin : secrétaire, préfet,
                  enseignants, parents et élèves.
                </p>
                <Link
                  to="/connexion"
                  className="mt-5 block rounded-xl bg-brand-gradient px-4 py-3 text-center font-bold text-white shadow-brand transition hover:-translate-y-0.5"
                >
                  Se connecter
                </Link>
              </div>
            </Reveal>
          </section>
        </div>
      </div>

      <section id="modules" className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="modules-title">
        <Reveal className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-brand">Modules essentiels</p>
          <h2 id="modules-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Un socle MVP prêt pour l’exploitation scolaire
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module, i) => (
            <Reveal
              as="article"
              key={module.title}
              delay={i * 60}
              className="group relative overflow-hidden rounded-2xl border border-line bg-white p-6 shadow-card transition hover:-translate-y-1 hover:border-brand-100 hover:shadow-lift"
            >
              <span className="absolute left-6 top-0 h-1 w-10 rounded-b bg-brand-gradient opacity-0 transition group-hover:opacity-100" />
              <h3 className="text-base font-black text-ink">{module.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-muted">{module.description}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="roles" className="border-y border-line bg-slate-50/80" aria-labelledby="roles-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-wide text-brand">Accès par responsabilité</p>
            <h2 id="roles-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Chaque acteur voit son tableau de bord métier
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((role, i) => (
              <Reveal
                as="article"
                key={role.index}
                delay={i * 80}
                className="rounded-2xl border border-line bg-white p-6 shadow-card transition hover:-translate-y-1 hover:shadow-lift"
              >
                <span
                  aria-hidden
                  className="inline-grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal to-teal/80 text-sm font-black text-white shadow-[0_10px_20px_-10px_rgba(15,118,110,0.7)]"
                >
                  {role.index}
                </span>
                <h3 className="mt-4 text-base font-black text-ink">{role.title}</h3>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-muted">{role.description}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="securite" className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="securite-title">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <p className="text-xs font-black uppercase tracking-wide text-brand">
              Sécurité et séparation des données
            </p>
            <h2 id="securite-title" className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Conçu pour plusieurs pays, plusieurs établissements et plusieurs rôles.
            </h2>
          </Reveal>
          <ul className="grid gap-3">
            {SECURITY.map((item, i) => (
              <Reveal
                as="li"
                key={item}
                delay={i * 70}
                className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 font-semibold text-slate-700 shadow-card transition hover:translate-x-1 hover:shadow-lift"
              >
                <span
                  aria-hidden
                  className="mt-0.5 inline-grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-gradient text-xs text-white"
                >
                  ✓
                </span>
                {item}
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <footer className="bg-[#0b1220] text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <img
              src={SOMAFRIK_LOGO_URL}
              alt="Logo Somafrik"
              className="mb-3 h-20 w-20 rounded-2xl bg-white/95 object-contain p-1 sm:h-24 sm:w-24"
            />
            <p className="text-sm font-semibold text-slate-400">ERP scolaire et universitaire édité par Somafrik.</p>
            <small className="mt-3 block text-slate-500">
              © {new Date().getFullYear()} Somafrik. Tous droits réservés.
            </small>
          </div>
          <div>
            <strong className="mb-3 block text-white">Mentions légales</strong>
            <a href="#securite" className="mb-2 block text-sm transition hover:text-white">Confidentialité</a>
            <a href="#securite" className="mb-2 block text-sm transition hover:text-white">Protection des données</a>
            <a href="#securite" className="mb-2 block text-sm transition hover:text-white">Conditions d’utilisation</a>
          </div>
          <div>
            <strong className="mb-3 block text-white">Liens utiles</strong>
            <a href="#modules" className="mb-2 block text-sm transition hover:text-white">Modules</a>
            <a href="#roles" className="mb-2 block text-sm transition hover:text-white">Accès par rôle</a>
            <a href="#securite" className="mb-2 block text-sm transition hover:text-white">Sécurité</a>
          </div>
          <div>
            <strong className="mb-3 block text-white">Support</strong>
            <span className="mb-2 block text-sm">support@somafrik.app</span>
            <span className="mb-2 block text-sm">Plateforme Somafrik</span>
            <span className="mb-2 block text-sm">Plateforme interne sécurisée</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
