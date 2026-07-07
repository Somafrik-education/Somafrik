import { BellRing, Palette, PlugZap, Wallet } from "lucide-react";
import { PagePlaceholder } from "../../components/ui/PagePlaceholder";

export { EstablishmentProfilePage as SettingsProfilePage } from "./EstablishmentProfilePage";
export { SettingsSecurityPage } from "./SecuritySettingsPage";
export { SettingsDataPage } from "./DataBackupSettingsPage";

export function SettingsFinancePage() {
  return (
    <PagePlaceholder
      icon={Wallet}
      title="Paramètres Finances"
      description="Configuration des règles financières : types de frais (inscription, mensualités, examen), échéances, moyens de paiement, devises, pénalités et réductions. Les opérations restent dans le module Finances."
    />
  );
}

export function SettingsNotificationsPage() {
  return (
    <PagePlaceholder
      icon={BellRing}
      title="Paramètres Notifications"
      description="Canaux de communication (push, e-mail, SMS, WhatsApp), modèles de messages et déclencheurs automatiques (note publiée, absence, impayé)."
    />
  );
}

export function SettingsAppearancePage() {
  return (
    <PagePlaceholder
      icon={Palette}
      title="Apparence"
      description="Personnalisation visuelle de l'établissement (MVP : logo, couleur principale et nom affiché)."
    />
  );
}

export function SettingsIntegrationsPage() {
  return (
    <PagePlaceholder
      icon={PlugZap}
      title="Intégrations"
      description="Connexions externes : mobile money (Orange, MTN, Airtel), SMS, WhatsApp API, SMTP, stockage cloud, NFC et webhooks."
    />
  );
}
