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
  KeyRound,
  Lock,
  Network,
  Palette,
  PlugZap,
  Wallet,
} from "lucide-react";
import { Badge, DashboardLayout } from "../../design-system";
import { canReadView } from "../../lib/permissions";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "../../lib/orgHierarchy";
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
    to: "/parametres/mon-abonnement",
    title: "Mon abonnement",
    description: "Offre SaaS Somafrik, factures, paiements, changement d'offre et résiliation.",
    icon: CreditCard,
    status: "available",
    view: "mySubscription",
  },
  {
    to: "/parametres/profil",
    title: "Profil établissement",
    description: "Identité de l'école : logo, adresse, contacts, code et responsable légal.",
    icon: Building2,
    status: "available",
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
    to: "/parametres/roles-droits",
    title: "Rôles et droits",
    description: "Rôles internes de l'établissement et pilotage des habilitations par fonction.",
    icon: KeyRound,
    status: "available",
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
    to: "/parametres/securite",
    title: "Sécurité",
    description: "Politique de mot de passe, PIN, session active et journal d'audit.",
    icon: Lock,
    status: "available",
    view: "configuration",
  },
  {
    to: "/parametres/donnees",
    title: "Données et sauvegarde",
    description: "Export CSV d'extrait affiché et export JSON versionné. La restauration complète n'est pas disponible.",
    icon: DatabaseBackup,
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
    to: "/parametres/abonnements",
    title: "Politique d'abonnement par pays",
    description: "Barème Essentiel, Standard et Premium par pays, devise et tarifs mensuels/annuels.",
    icon: CreditCard,
    status: "available",
    view: "subscriptions",
  },
  {
    to: "/parametres/graphiques",
    title: "Graphiques du tableau de bord",
    description: "Indicateurs et visualisations affichés sur les tableaux de bord.",
    icon: BarChart3,
    status: "available",
    view: "chartSettings",
  },
];

/**
 * Cartes réservées aux rôles plateforme (Superadmin / Admin Pays).
 * Les rôles établissement conservent le filtrage par permission classique.
 */
const SUPERADMIN_SETTING_PATHS = new Set<string>([
  "/parametres/abonnements",
  "/parametres/graphiques",
  "/parametres/securite",
  "/parametres/donnees",
]);
const COUNTRY_ADMIN_SETTING_PATHS = new Set<string>([
  "/parametres/abonnements",
  "/parametres/donnees",
]);

/** Hub Paramètres : grille de cartes par domaine de configuration (P-006). */
export function SettingsHubPage() {
  const ctx = usePermissionContext();
  const role = ctx.user?.role;
  const platformPaths = isSuperAdminRole(role)
    ? SUPERADMIN_SETTING_PATHS
    : role === COUNTRY_ADMIN_ROLE
      ? COUNTRY_ADMIN_SETTING_PATHS
      : null;
  const cards = platformPaths
    ? SETTING_CARDS.filter((card) => platformPaths.has(card.to))
    : SETTING_CARDS.filter((card) => canReadView(ctx, card.view));

  return (
    <DashboardLayout>
      <DashboardLayout.Content>
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
                    <Badge tone="neutral">Bientôt</Badge>
                  ) : (
                    <Badge tone="success">Disponible</Badge>
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
      </DashboardLayout.Content>
    </DashboardLayout>
  );
}
