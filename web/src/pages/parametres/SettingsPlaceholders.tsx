import { Palette, PlugZap } from "lucide-react";
import { ComingSoonState } from "../../design-system";

export { EstablishmentProfilePage as SettingsProfilePage } from "./EstablishmentProfilePage";
export { SettingsSecurityPage } from "./SecuritySettingsPage";
export { SettingsDataPage } from "./DataBackupSettingsPage";
export { SettingsNotificationsPage } from "./SettingsNotificationsPage";

export function SettingsAppearancePage() {
  return (
    <ComingSoonState
      icon={<Palette className="h-7 w-7" />}
      title="Apparence"
      description="Personnalisation visuelle de l'établissement (MVP : logo, couleur principale et nom affiché)."
    />
  );
}

export function SettingsIntegrationsPage() {
  return (
    <ComingSoonState
      icon={<PlugZap className="h-7 w-7" />}
      title="Intégrations"
      description="Connexions externes : mobile money (Orange, MTN, Airtel), SMS, WhatsApp API, SMTP, stockage cloud, NFC et webhooks."
    />
  );
}
