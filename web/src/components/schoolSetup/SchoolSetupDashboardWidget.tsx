import { Link } from "react-router-dom";
import { buttonVariants, Card } from "@/design-system";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";
import {
  dashboardSetupProgressLabel,
  SCHOOL_SETUP_SETTINGS_PATH,
} from "../../lib/schoolSetupWeb";

export function SchoolSetupDashboardWidget({ payload }: { payload: SchoolSetupPayload }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-ink">Configuration rapide</h2>
          <p className="mt-1 text-sm text-muted">
            Étapes essentielles : {dashboardSetupProgressLabel(payload)}
          </p>
        </div>
        <Link to={SCHOOL_SETUP_SETTINGS_PATH} className={buttonVariants({ variant: "primary" })}>
          Continuer
        </Link>
      </div>
    </Card>
  );
}
