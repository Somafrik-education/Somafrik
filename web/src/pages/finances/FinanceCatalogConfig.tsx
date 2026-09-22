import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { SectionHeader } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { InlineAlert } from "../../design-system";
import { financeApi, type FinanceCatalog, type FinancePaymentMethod } from "../../lib/financeApi";

export function FinanceCatalogConfig({
  catalog,
  canWrite,
}: {
  catalog: FinanceCatalog;
  canWrite: boolean;
}) {
  const { showToast } = useToast();
  const [methods, setMethods] = useState<FinancePaymentMethod[]>(catalog.paymentMethods ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMethods(catalog.paymentMethods ?? []);
  }, [catalog]);

  async function persistMethods() {
    if (!canWrite) return;
    setBusy(true);
    try {
      const saved = await financeApi.replacePaymentMethods(methods);
      setMethods(saved);
      showToast("Moyens de paiement enregistrés.", "success");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Échec d'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <div>
        <SectionHeader
          title="Devise"
          description="Devise canonique établissement / pays. Pas de valeur libre côté client."
        />
        <p className="mt-3 text-lg font-semibold text-ink">{catalog.currency || "—"}</p>
        <p className="text-sm text-muted">
          Source : {catalog.currencySource === "school" ? "établissement" : "pays"}.
        </p>
      </div>

      <div className="space-y-3">
        <SectionHeader
          title="Moyens de paiement autorisés"
          description="Catalogue PostgreSQL. Aucune intégration opérateur Mobile Money dans ce lot."
        />
        {methods.length === 0 ? (
          <p className="text-sm text-muted">Aucun moyen configuré.</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink">
            {methods.map((method) => (
              <li key={method.methodCode}>
                {method.label} — {method.active ? "Oui" : "Non"}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {methods.map((method) => (
              <label key={method.methodCode} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={method.active}
                  onChange={(event) => {
                    setMethods((current) =>
                      current.map((row) =>
                        row.methodCode === method.methodCode ? { ...row, active: event.target.checked } : row,
                      ),
                    );
                  }}
                />
                {method.label}
              </label>
            ))}
            <Button disabled={busy} onClick={() => void persistMethods()}>
              Enregistrer les moyens
            </Button>
          </div>
        ) : (
          <InlineAlert tone="info" title="Lecture seule">
            Seule l&apos;administration peut modifier les moyens autorisés.
          </InlineAlert>
        )}
      </div>

      <InlineAlert tone="info" title="Réductions et pénalités — différées V1">
        Les réductions/exonérations restent au niveau de l&apos;obligation élève. Les pénalités de retard ne sont pas un référentiel d&apos;établissement dans ce lot.
      </InlineAlert>
    </div>
  );
}
