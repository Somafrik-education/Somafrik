import { Link } from "react-router-dom";
import { buttonVariants, Card } from "@/design-system";
import type { GuidedSetupPayload } from "../../lib/schoolSetupGuidedApi";
import {
  guidedNextStepLabel,
  guidedProgressLabel,
  SCHOOL_SETUP_WELCOME_PATH,
  shouldShowGuidedSetupDashboardCard,
} from "../../lib/schoolSetupGuidedWeb";
import { SCHOOL_SETUP_SETTINGS_PATH } from "../../lib/schoolSetupWeb";

export function GuidedSchoolSetupDashboardCard({
  payload,
  role,
}: {
  payload: GuidedSetupPayload;
  role?: string;
}) {
  if (!shouldShowGuidedSetupDashboardCard({ payload, role }) || payload.percent === 100) {
    return null;
  }

  const next = guidedNextStepLabel(payload) || payload.nextStepLabel || "la prochaine étape";
  const resumeTo = payload.percent === 0 ? SCHOOL_SETUP_WELCOME_PATH : SCHOOL_SETUP_SETTINGS_PATH;

  return (
    <Card className="p-5" data-testid="guided-setup-dashboard-card">
      <h2 className="text-base font-black text-ink">Terminez la configuration de votre établissement</h2>
      <p className="mt-1 text-sm text-muted">Votre établissement est configuré à {payload.percent} %.</p>
      <p className="mt-1 text-sm font-semibold text-ink">Prochaine étape : {next}</p>
      <p className="sr-only">{guidedProgressLabel(payload)}</p>
      <div className="mt-4">
        <Link to={resumeTo} className={buttonVariants({ variant: "primary" })}>
          Reprendre la configuration
        </Link>
      </div>
    </Card>
  );
}
