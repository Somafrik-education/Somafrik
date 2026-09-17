import { Link } from "react-router-dom";
import { Button, Card, SectionHeader } from "@/design-system";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";
import {
  dismissSchoolSetupWizardForSession,
  schoolSetupWizardSteps,
} from "../../lib/schoolSetupWeb";

/** Deep links canoniques : /parametres/annee-scolaire et /etablissement/comptes-utilisateurs. */
export function SchoolSetupWizard({
  payload,
  onLater,
}: {
  payload: SchoolSetupPayload;
  onLater?: () => void;
}) {
  const steps = schoolSetupWizardSteps(payload);

  function handleLater() {
    dismissSchoolSetupWizardForSession();
    onLater?.();
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="Assistant de configuration"
        description="Ces actions ouvrent les écrans existants. Aucun formulaire n'est dupliqué ici."
      />
      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li key={step.id}>
            {step.disabled ? (
              <span className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-muted">
                <span className="font-semibold">{step.label}</span>
                <span>Étape précédente requise</span>
              </span>
            ) : (
              <Link
                to={step.to}
                className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
              >
                <span>{step.label}</span>
                <span>{step.done ? "Revoir →" : "Ouvrir →"}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="secondary" onClick={handleLater}>
          Plus tard
        </Button>
      </div>
    </Card>
  );
}
