import { AlertTriangle, Receipt } from "lucide-react";
import { PagePlaceholder } from "../../components/ui/PagePlaceholder";

export function FinanceFeesPage() {
  return (
    <PagePlaceholder
      icon={Receipt}
      title="Frais & tarifs"
      description="Grille des frais de scolarité par classe et par période : inscription, mensualités, frais annexes et échéanciers."
    />
  );
}

export function FinanceUnpaidPage() {
  return (
    <PagePlaceholder
      icon={AlertTriangle}
      title="Impayés"
      description="Suivi des restes à payer et relances : liste des élèves en retard de paiement, montants dus et historique des relances."
    />
  );
}
