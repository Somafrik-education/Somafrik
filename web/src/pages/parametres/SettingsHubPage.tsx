import { Link } from "react-router-dom";
import {
  BarChart3,
  BellRing,
  Building2,
  CalendarRange,
  CreditCard,
  DatabaseBackup,
  FileText,
  type LucideIcon,
  Lock,
  Network,
  Palette,
  PlugZap,
  UsersRound,
  Wallet,
} from "lucide-react";
import { canReadView } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

type SettingStatus = "available" | "soon";

interface SettingCard {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  status: SettingStatus;
  /** Vue de permission requise pour afficher la carte (défaut : configuration). */
  view: string;
}

const SETTING_CARDS: SettingCard[] = [
  {
    to: "/parametres/abonnements",
    title: "Politique d'abonnement par pays",
    description: "Barème Essentiel, Standard et Premium par pays, devise et tarifs mensuels/annuels.",
    icon: CreditCard,
    status: "available",
    view: "subscriptions",
  },
  {
    to: "/parametres/profil",
    title: "Profil établissement",
    description: "Identité de l'école : logo, adresse, contacts, code et responsable légal.",
    icon: Building2,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/annee-scolaire",
    title: "Année scolaire",
    description: "Périodes (trimestres / semestres), dates, barème et année active.",
    icon: CalendarRange,
    status: "available",
    view: "configuration",
  },
  {
    to: "/parametres/structure",
    title: "Structure pédagogique",
    description: "Niveaux, filières, classes et matières de référence.",
    icon: Network,
    status: "available",
    view: "configuration",
  },
  {
    to: "/parametres/utilisateurs",
    title: "Utilisateurs et accès",
    description: "Rôles de l'établissement, pilotage des droits et comptes.",
    icon: UsersRound,
    status: "available",
    view: "configuration",
  },
  {
    to: "/parametres/finances",
    title: "Finances",
    description: "Types de frais, échéances, moyens de paiement et pénalités.",
    icon: Wallet,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/notifications",
    title: "Notifications",
    description: "Canaux (push, e-mail, SMS, WhatsApp), modèles et rappels automatiques.",
    icon: BellRing,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/documents",
    title: "Documents",
    description: "Modèles de bulletins, reçus, attestations, en-têtes et QR code.",
    icon: FileText,
    status: "available",
    view: "bulletinDesign",
  },
  {
    to: "/parametres/graphiques",
    title: "Graphiques du tableau de bord",
    description: "Indicateurs et visualisations affichés sur les tableaux de bord.",
    icon: BarChart3,
    status: "available",
    view: "chartSettings",
  },
  {
    to: "/parametres/securite",
    title: "Sécurité",
    description: "Politique de mot de passe, PIN, sessions actives et journal d'audit.",
    icon: Lock,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/apparence",
    title: "Apparence",
    description: "Logo, couleur principale et nom affiché de l'établissement.",
    icon: Palette,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/integrations",
    title: "Intégrations",
    description: "Mobile money, SMS, WhatsApp, SMTP, stockage cloud et webhooks.",
    icon: PlugZap,
    status: "soon",
    view: "configuration",
  },
  {
    to: "/parametres/donnees",
    title: "Données et sauvegarde",
    description: "Imports, exports Excel, sauvegarde, restauration et archivage.",
    icon: DatabaseBackup,
    status: "soon",
    view: "configuration",
  },
];

/** Hub Paramètres : grille de cartes par domaine de configuration. */
export function SettingsHubPage() {
  const ctx = usePermissionContext();
  const cards = SETTING_CARDS.filter((card) => canReadView(ctx, card.view));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.to}
            to={card.to}
            className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-brand/40 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              {card.status === "soon" ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  Bientôt
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                  Disponible
                </span>
              )}
            </div>
            <h2 className="mt-4 text-base font-black text-ink">{card.title}</h2>
            <p className="mt-1 flex-1 text-sm text-muted">{card.description}</p>
            <span className="mt-4 text-sm font-semibold text-brand group-hover:underline">
              Configurer →
            </span>
          </Link>
        );
      })}
    </div>
  );
}
