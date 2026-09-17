import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FormLayout, InlineAlert, LoadingState, SectionHeader } from "@/design-system";
import { SchoolSetupWizard } from "../../components/schoolSetup/SchoolSetupWizard";
import { ApiError } from "../../api/client";
import { schoolSetupStatusApi, type SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";
import { dashboardSetupProgressLabel } from "../../lib/schoolSetupWeb";

function schoolSetupStatusLabel(status: SchoolSetupPayload["status"]) {
  if (status === "READY") return "configuration essentielle terminée";
  if (status === "IN_PROGRESS") return "configuration en cours";
  return "configuration à démarrer";
}

export function SchoolSetupSettingsPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<SchoolSetupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void schoolSetupStatusApi
      .get()
      .then((row) => {
        if (cancelled) return;
        setPayload(row);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPayload(null);
        setError(err instanceof ApiError ? err.message : "Impossible de charger le statut de configuration.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FormLayout>
      <FormLayout.Header>
        <SectionHeader
          title="Configuration de l'établissement"
          description="Suivez les étapes essentielles pour préparer votre établissement."
        />
      </FormLayout.Header>
      <FormLayout.Content>
        {error ? (
          <InlineAlert tone="danger" title="Statut indisponible">
            {error}
          </InlineAlert>
        ) : null}
        {!payload && !error ? <LoadingState message="Chargement de la configuration…" /> : null}
        {payload ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Progression : {dashboardSetupProgressLabel(payload)} · {schoolSetupStatusLabel(payload.status)}
            </p>
            <SchoolSetupWizard payload={payload} onLater={() => navigate("/etablissement", { replace: true })} />
          </div>
        ) : null}
      </FormLayout.Content>
    </FormLayout>
  );
}
