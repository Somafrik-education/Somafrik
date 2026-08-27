import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ForbiddenState,
  FormField,
  FormLayout,
  InlineAlert,
  Input,
  LoadingState,
  SectionHeader,
  Select,
  Table,
  type Column,
} from "../../design-system";
import { useToast } from "../../components/ui/Toast";
import { canManageFeeGrids, canViewFeeGrids } from "../../lib/fees";
import {
  financeApi,
  type FinanceCatalog,
  type FinanceFeeGrid,
  type FinancePaymentMethod,
} from "../../lib/financeApi";

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: T[] }).items;
  }
  return [];
}

export function SettingsFinancePage() {
  const { session } = useAuth();
  const { activeSchool } = useActiveSchool();
  const { showToast } = useToast();
  const user = session?.user ?? null;
  const canRead = canViewFeeGrids(user) || canManageFeeGrids(user);
  const canWrite = canManageFeeGrids(user);

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<FinanceCatalog | null>(null);
  const [grids, setGrids] = useState<FinanceFeeGrid[]>([]);
  const [methods, setMethods] = useState<FinancePaymentMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [gridClassName, setGridClassName] = useState("");
  const [gridYear, setGridYear] = useState("");
  const [gridFeeType, setGridFeeType] = useState("Inscription");
  const [gridLabel, setGridLabel] = useState("Inscription");
  const [gridAmount, setGridAmount] = useState("");
  const [gridDueDate, setGridDueDate] = useState("");

  const schoolLabel = activeSchool?.name || user?.schoolCode || "établissement";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setDenied(false);
    try {
      const [nextCatalog, nextGrids] = await Promise.all([
        financeApi.getFinanceCatalog(),
        financeApi.listFeeGrids().catch((cause) => {
          if (cause instanceof ApiError && cause.status === 403) return [];
          throw cause;
        }),
      ]);
      setCatalog(nextCatalog);
      setMethods(nextCatalog.paymentMethods);
      setGrids(unwrapList<FinanceFeeGrid>(nextGrids));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setDenied(true);
        return;
      }
      setError(cause instanceof Error ? cause.message : "Impossible de charger les paramètres finances.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const feeTypeChoices = useMemo(
    () => catalog?.canonicalFeeTypes ?? [{ feeType: "Inscription", label: "Inscription" }],
    [catalog],
  );

  const methodColumns: Column<FinancePaymentMethod>[] = [
    { key: "label", header: "Moyen" },
    {
      key: "active",
      header: "Autorisé",
      render: (row) => (row.active ? "Oui" : "Non"),
    },
  ];

  const gridColumns: Column<FinanceFeeGrid>[] = [
    { key: "className", header: "Classe" },
    { key: "academicYear", header: "Année" },
    { key: "currency", header: "Devise" },
    { key: "status", header: "Statut" },
  ];

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

  async function persistGrid(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    const amount = Number(String(gridAmount).replace(/\s/g, "").replace(",", "."));
    if (!gridClassName.trim() || !gridYear.trim() || !Number.isFinite(amount) || amount <= 0) {
      showToast("Classe, année et montant positif sont requis.", "error");
      return;
    }
    setBusy(true);
    try {
      const created = await financeApi.createFeeGrid({
        className: gridClassName.trim(),
        academicYear: gridYear.trim(),
        currency: catalog?.currency || "CDF",
        items: [
          {
            feeType: gridFeeType,
            label: gridLabel.trim() || gridFeeType,
            amount,
            dueDate: gridDueDate || undefined,
            mandatory: true,
            status: "Actif",
          },
        ],
      });
      await financeApi.activateFeeGrid(created.id);
      showToast("Type de frais enregistré.", "success");
      setGridAmount("");
      await load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Échec d'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateGrid(grid: FinanceFeeGrid) {
    if (!canWrite) return;
    setBusy(true);
    try {
      await financeApi.deactivateFeeGrid(grid.id);
      showToast("Grille désactivée.", "success");
      await load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Échec de désactivation", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader title="Paramètres Finances" description="Règles financières de l'établissement." />
        </FormLayout.Header>
        <FormLayout.Content>
          <ForbiddenState message="L'administration configure les règles financières. Le Comptable gère les opérations dans Finances." />
        </FormLayout.Content>
      </FormLayout>
    );
  }

  if (loading) {
    return (
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader title="Paramètres Finances" description={`Configuration financière — ${schoolLabel}`} />
        </FormLayout.Header>
        <FormLayout.Content>
          <LoadingState message="Chargement du catalogue financier…" />
        </FormLayout.Content>
      </FormLayout>
    );
  }

  if (denied) {
    return (
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader title="Paramètres Finances" />
        </FormLayout.Header>
        <FormLayout.Content>
          <ForbiddenState />
        </FormLayout.Content>
      </FormLayout>
    );
  }

  if (error) {
    return (
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader title="Paramètres Finances" />
        </FormLayout.Header>
        <FormLayout.Content>
          <ErrorState message={error} action={<Button onClick={() => void load()}>Réessayer</Button>} />
        </FormLayout.Content>
      </FormLayout>
    );
  }

  return (
    <FormLayout>
      <FormLayout.Header>
        <SectionHeader
          title="Paramètres Finances"
          description="Référentiel de configuration (types de frais, échéances, moyens de paiement, devise). Les encaissements restent dans Finances."
        />
      </FormLayout.Header>
      <FormLayout.Content>
        <div className="space-y-6">
        <Card className="p-5">
          <SectionHeader title="Devise" description="Devise canonique établissement / pays. Pas de valeur libre côté client." />
          <p className="mt-3 text-lg font-semibold text-ink">{catalog?.currency || "—"}</p>
          <p className="text-sm text-muted">Source : {catalog?.currencySource === "school" ? "établissement" : "pays"}.</p>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionHeader title="Moyens de paiement autorisés" description="Catalogue PostgreSQL. Aucune intégration opérateur Mobile Money dans ce lot." />
          <Table columns={methodColumns} rows={methods} rowKey={(row) => row.methodCode} emptyLabel="Aucun moyen configuré." />
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
              Seule l'administration peut modifier les moyens autorisés.
            </InlineAlert>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <SectionHeader
            title="Types de frais et échéances"
            description="Grilles tarifaires PostgreSQL (inscription, scolarité, examen, uniforme, transport, cantine, autres)."
          />
          {grids.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-7 w-7" />}
              title="Aucune grille tarifaire"
              description="Ajoutez un type de frais pour cet établissement. Les montants ne sont pas reconstruits depuis l'historique des paiements."
            />
          ) : (
            <Table
              columns={[
                ...gridColumns,
                {
                  key: "actions",
                  header: "",
                  render: (row) =>
                    canWrite && row.status !== "Désactivée" ? (
                      <Button variant="ghost" disabled={busy} onClick={() => void deactivateGrid(row)}>
                        Désactiver
                      </Button>
                    ) : null,
                },
              ]}
              rows={grids}
              rowKey={(row) => row.id}
              emptyLabel="Aucune grille."
            />
          )}
          {catalog?.feeTypes?.length ? (
            <ul className="space-y-1 text-sm text-ink">
              {catalog.feeTypes.map((item) => (
                <li key={`${item.itemId}-${item.feeType}`}>
                  {item.label} — {item.amount.toLocaleString("fr-FR")} {item.currency || catalog.currency}
                  {item.className ? ` · ${item.className}` : ""}
                  {item.academicYear ? ` · ${item.academicYear}` : ""}
                  {item.dueDate ? ` · échéance ${String(item.dueDate).slice(0, 10)}` : ""}
                  {item.mandatory ? " · obligatoire" : " · facultatif"}
                </li>
              ))}
            </ul>
          ) : null}

          {canWrite ? (
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void persistGrid(event)}>
              <FormField label="Classe">
                <Input value={gridClassName} onChange={(event) => setGridClassName(event.target.value)} required />
              </FormField>
              <FormField label="Année académique">
                <Input value={gridYear} onChange={(event) => setGridYear(event.target.value)} placeholder="2025-2026" required />
              </FormField>
              <FormField label="Type de frais">
                <Select value={gridFeeType} onChange={(event) => setGridFeeType(event.target.value)}>
                  {feeTypeChoices.map((item) => (
                    <option key={item.feeType} value={item.feeType}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Libellé">
                <Input value={gridLabel} onChange={(event) => setGridLabel(event.target.value)} />
              </FormField>
              <FormField label={`Montant (${catalog?.currency || "CDF"})`}>
                <Input value={gridAmount} onChange={(event) => setGridAmount(event.target.value)} inputMode="decimal" required />
              </FormField>
              <FormField label="Échéance">
                <Input type="date" value={gridDueDate} onChange={(event) => setGridDueDate(event.target.value)} />
              </FormField>
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy}>
                  Enregistrer le type de frais
                </Button>
              </div>
            </form>
          ) : null}
        </Card>

        <InlineAlert tone="info" title="Réductions et pénalités — différées V1">
          Les réductions/exonérations restent au niveau de l'obligation élève. Les pénalités de retard ne sont pas un référentiel d'établissement dans ce lot.
        </InlineAlert>
        </div>
      </FormLayout.Content>
    </FormLayout>
  );
}
