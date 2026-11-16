import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, InlineAlert, WizardLayout } from "@/design-system";
import { ApiError } from "../../api/client";
import { schoolSetupGuidedApi, type GuidedSetupPayload } from "../../lib/schoolSetupGuidedApi";
import {
  GUIDED_STEP_COPY,
  GUIDED_STEP_KEYS,
  GUIDED_WEB_LINKS,
  guidedProgressLabel,
  guidedStepHeading,
} from "../../lib/schoolSetupGuidedWeb";

function progressBar(percent: number) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

export function GuidedSchoolSetupWizard({
  payload,
  onLeave,
  onCompleted,
  onFinish,
}: {
  payload: GuidedSetupPayload;
  onLeave?: () => void;
  onCompleted?: (next: GuidedSetupPayload) => void;
  onFinish?: () => void;
}) {
  const [current, setCurrent] = useState(payload);
  const [viewingStep, setViewingStep] = useState(payload.currentStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Sauvegarde impossible");
  const [saved, setSaved] = useState(false);
  const finishLock = useRef(false);

  useEffect(() => {
    setCurrent(payload);
    setViewingStep(payload.currentStep);
  }, [payload]);

  const stepMeta = current.steps.find((step) => step.index === viewingStep) ?? current.steps[0];
  const stepKey = (stepMeta?.key ?? GUIDED_STEP_KEYS[0]) as (typeof GUIDED_STEP_KEYS)[number];
  const copy = GUIDED_STEP_COPY[stepKey];
  const href = GUIDED_WEB_LINKS[stepKey];
  const isLast = viewingStep === 10;
  const canFinish =
    !current.finalized && (current.percent >= 100 || isLast || current.status === "operational");
  const canContinue = !current.finalized && !isLast && current.percent < 100;
  const heading = guidedStepHeading(viewingStep);

  const bar = useMemo(() => progressBar(current.percent), [current.percent]);

  async function saveAndContinue() {
    setSaving(true);
    setError(null);
    setErrorTitle("Sauvegarde impossible");
    setSaved(false);
    try {
      const next = await schoolSetupGuidedApi.completeStep(stepKey);
      const nextPercent = Number(next?.percent ?? 0);
      setCurrent(next);
      setViewingStep(nextPercent >= 100 ? 10 : Number(next?.currentStep ?? viewingStep));
      setSaved(true);
      onCompleted?.(next);
      return next;
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Enregistrement impossible. Vérifiez les données requises puis réessayez.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  function failureMessage(err: unknown) {
    if (err instanceof ApiError) {
      const details = err.details as { missingSteps?: Array<{ label?: string }> } | undefined;
      const labels = Array.isArray(details?.missingSteps)
        ? details.missingSteps.map((step) => String(step?.label ?? "").trim()).filter(Boolean)
        : [];
      if (labels.length) {
        return `Étapes obligatoires à corriger : ${labels.join(", ")}.`;
      }
      return err.message || "Finalisation impossible. Vérifiez votre connexion puis réessayez.";
    }
    return "Finalisation impossible. Vérifiez votre connexion puis réessayez.";
  }

  async function finishSetup() {
    if (finishLock.current || current.finalized) return;
    finishLock.current = true;
    setSaving(true);
    setError(null);
    setErrorTitle("Finalisation impossible");
    setSaved(false);
    try {
      const next = await schoolSetupGuidedApi.finalize();
      if (!next?.finalized) {
        setError("La finalisation n'a pas été confirmée par le serveur.");
        return;
      }
      setCurrent(next);
      onCompleted?.(next);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      finishLock.current = false;
      setSaving(false);
    }
  }

  return (
    <WizardLayout>
      <WizardLayout.Header>
        <div className="space-y-1">
          <h2 className="text-xl font-black text-ink">Configuration de votre établissement</h2>
          <p className="text-sm font-semibold text-ink">{heading || `Étape ${viewingStep} sur 10`}</p>
          {current.finalized ? (
            <InlineAlert tone="success" title="Configuration de votre établissement terminée">
              Vous pouvez consulter ou modifier les paramètres autorisés. Le statut terminé est conservé.
            </InlineAlert>
          ) : (
            <p className="text-sm text-muted" aria-live="polite">
              {guidedProgressLabel(current)}
            </p>
          )}
          <p className="font-mono text-xs tracking-wide text-brand" aria-hidden="true">
            {bar} {current.percent} %
          </p>
        </div>
      </WizardLayout.Header>
      <WizardLayout.Stepper>
        <ol className="flex flex-wrap gap-1" aria-label="Étapes du parcours">
          {current.steps.map((step) => (
            <li key={step.key}>
              <button
                type="button"
                disabled={!step.unlocked && step.index !== viewingStep}
                onClick={() => {
                  if (step.unlocked || step.index <= current.lastValidStep + 1) setViewingStep(step.index);
                }}
                className={`min-h-9 rounded-lg px-2 text-xs font-semibold ${
                  step.index === viewingStep
                    ? "bg-brand text-white"
                    : step.done
                      ? "bg-brand/10 text-brand"
                      : "bg-slate-100 text-muted"
                }`}
              >
                {step.index}
                <span className="sr-only">{step.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </WizardLayout.Stepper>
      <WizardLayout.Content>
        <Card className="space-y-3 p-5">
          <h3 className="text-lg font-black text-ink">{copy.title}</h3>
          <p className="text-sm text-muted">{copy.description}</p>
          {stepKey === "students" ? (
            <p className="text-sm font-semibold text-ink">
              Pour inscrire un élève, ouvrez une classe puis « Inscrire un élève ». Aucune création
              d'élève indépendante d'une classe.
            </p>
          ) : null}
          <Link
            to={href}
            className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-2 hover:underline"
          >
            {copy.cta} →
          </Link>
          {saved ? (
            <InlineAlert tone="success" title="Enregistré">
              L'étape a été sauvegardée. Vous pouvez continuer ou quitter.
            </InlineAlert>
          ) : null}
          {error ? (
            <InlineAlert tone="danger" title={errorTitle}>
              {error}
            </InlineAlert>
          ) : null}
        </Card>
      </WizardLayout.Content>
      <WizardLayout.StickyActions>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={viewingStep <= 1 || saving}
            onClick={() => {
              setViewingStep((step) => Math.max(1, step - 1));
              setError(null);
            }}
          >
            Précédent
          </Button>
          <div className="flex flex-wrap gap-2">
            {current.finalized ? null : (
              <Button type="button" variant="tertiary" onClick={() => onLeave?.()}>
                Quitter et reprendre plus tard
              </Button>
            )}
            {canContinue ? (
              <Button type="button" onClick={() => void saveAndContinue()} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer et continuer"}
              </Button>
            ) : null}
            {canFinish ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setViewingStep(1)}>
                  Vérifier la configuration
                </Button>
                <Button
                  type="button"
                  onClick={() => void finishSetup()}
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? "Enregistrement…" : "Terminer la configuration"}
                </Button>
              </>
            ) : null}
            {current.finalized ? (
              <Button type="button" onClick={() => onFinish?.()}>
                Accéder au tableau de bord
              </Button>
            ) : null}
          </div>
        </div>
      </WizardLayout.StickyActions>
    </WizardLayout>
  );
}
