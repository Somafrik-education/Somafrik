import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { PrintButton } from "../../components/ui/PrintButton";
import { StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import type { FeeGrid, SchoolFeeItem, SchoolFeeType, StudentFee } from "../../types";
import {
  applyFeeGridToStudents,
  canViewFeeGrids,
  classOptionsForSchool,
  DEFAULT_MONTHLY_MONTHS,
  isGridEditable,
  itemsForGrid,
  newFeeId,
  recordTariffHistory,
  refreshStudentFeeStatuses,
  resolveAcademicYear,
  resolveSchoolCurrency,
  scopedFeeGrids,
  scopedSchoolFeeItems,
  scopedStudentFees,
  SCHOOL_FEE_TYPES,
  studentFeeSummary,
  validateFeeGridInput,
} from "../../lib/fees";
import {
  canApplyFees,
  canCreateFees,
  canReadFees,
  canUpdateFees,
} from "../../lib/feePermissions";
import { inputToPeriodDate, normalizePeriodDate, periodDateToInput } from "../../lib/dates";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { appendAuditLog, auditActor, makeAuditEntry } from "../../lib/audit";
import { normalize } from "../../lib/format";
import { QuickFeeGridModal } from "../../components/fees/QuickFeeGridModal";

interface DraftItem {
  id?: string;
  feeType: SchoolFeeType;
  label: string;
  amount: string;
  mandatory: boolean;
  dueDate: string;
  monthlyMonths: string[];
  status: "Actif" | "Désactivé";
}

const EMPTY_ITEM: DraftItem = {
  feeType: "Inscription",
  label: "",
  amount: "",
  mandatory: true,
  dueDate: "",
  monthlyMonths: [],
  status: "Actif",
};

export function FinanceFeesPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { activeSchoolCode, activeSchool } = useActiveSchool();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const schoolCode = useMemo(() => {
    const raw =
      activeSchoolCode && activeSchoolCode !== "*"
        ? activeSchoolCode
        : session?.user?.schoolCode && session.user.schoolCode !== "*"
          ? session.user.schoolCode
          : state.schools[0]?.code ?? "";
    return String(raw).trim().toUpperCase();
  }, [activeSchoolCode, session?.user?.schoolCode, state.schools]);

  const canRead = canReadFees(ctx) || canViewFeeGrids(session?.user ?? null);
  const canCreate = canCreateFees(ctx);
  const canUpdate = canUpdateFees(ctx);
  const canApply = canApplyFees(ctx);

  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<FeeGrid | null>(null);
  const [editing, setEditing] = useState<FeeGrid | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [filterClass, setFilterClass] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);

  const grids = useMemo(() => {
    let rows = scopedFeeGrids(session?.user ?? null, state);
    if (filterClass) rows = rows.filter((g) => normalize(g.className) === normalize(filterClass));
    if (filterYear) rows = rows.filter((g) => g.academicYear === filterYear);
    return rows.sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? "") ?? 0);
  }, [session?.user, state, filterClass, filterYear]);

  const allItems = scopedSchoolFeeItems(session?.user ?? null, state);
  const studentFees = refreshStudentFeeStatuses(scopedStudentFees(session?.user ?? null, state));
  const classOptions = useMemo(() => classOptionsForSchool(state, schoolCode), [state, schoolCode]);
  const years = useMemo(
    () => [...new Set(grids.map((g) => g.academicYear))].sort().reverse(),
    [grids],
  );

  if (!canRead) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-muted">
          Vous n&apos;avez pas l&apos;autorisation de consulter les frais &amp; tarifs.
        </p>
      </Card>
    );
  }

  async function persist(patch: Parameters<typeof update>[0], message: string) {
    setBusy(true);
    try {
      await update(patch);
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
      throw new Error("sync failed");
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditing({
      id: newFeeId("FEEGRID"),
      schoolCode,
      academicYear: resolveAcademicYear(state, schoolCode),
      className: classOptions[0] ?? "",
      currency: resolveSchoolCurrency(state, schoolCode),
      status: "Brouillon",
      periodName: "",
      periodStart: "",
      periodEnd: "",
      createdBy: session?.user?.identifier ?? session?.user?.firstName,
      createdAt: new Date().toISOString(),
    });
    setDraftItems([{ ...EMPTY_ITEM, label: "Frais d'inscription" }]);
    setDetail(null);
  }

  function openEdit(grid: FeeGrid) {
    const items = itemsForGrid(allItems, grid.id);
    setEditing({ ...grid });
    setDraftItems(
      items.length
        ? items.map((item) => ({
            id: item.id,
            feeType: item.feeType,
            label: item.label,
            amount: String(item.amount),
            mandatory: item.mandatory,
            dueDate: item.dueDate ?? "",
            monthlyMonths: item.monthlyMonths ?? [],
            status: item.status,
          }))
        : [{ ...EMPTY_ITEM }],
    );
    setDetail(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    const exists = (state.feeGrids ?? []).some((g) => g.id === editing.id);
    if (!exists && !canCreate) {
      showToast("Création non autorisée.", "error");
      return;
    }
    if (exists && !canUpdate) {
      showToast("Modification non autorisée.", "error");
      return;
    }

    const parsedItems: Partial<SchoolFeeItem>[] = draftItems
      .filter((item) => item.status === "Actif" || item.amount)
      .map((item) => ({
        id: item.id ?? newFeeId("FEEITEM"),
        feeGridId: editing.id,
        schoolCode: editing.schoolCode,
        className: editing.className,
        feeType: item.feeType,
        label: item.label.trim(),
        amount: Number(item.amount),
        mandatory: item.mandatory,
        dueDate: item.dueDate ? normalizePeriodDate(item.dueDate) : undefined,
        monthlyMonths: item.feeType === "Mensualité" ? item.monthlyMonths : undefined,
        status: item.status,
      }));

    const validation = validateFeeGridInput(editing, parsedItems, state);
    if (!validation.ok) {
      showToast(validation.error ?? "Grille invalide", "error");
      return;
    }

    const nextGrids = exists
      ? (state.feeGrids ?? []).map((g) =>
          g.id === editing.id ? { ...editing, updatedAt: new Date().toISOString() } : g,
        )
      : [...(state.feeGrids ?? []), editing];

    const otherItems = (state.schoolFeeItems ?? []).filter((item) => item.feeGridId !== editing.id);
    const nextItems = [
      ...otherItems,
      ...(parsedItems as SchoolFeeItem[]),
    ];

    let history = state.feeTariffHistory ?? [];
    if (exists) {
      for (const item of parsedItems as SchoolFeeItem[]) {
        const prior = (state.schoolFeeItems ?? []).find((row) => row.id === item.id);
        if (prior && prior.amount !== item.amount) {
          history = recordTariffHistory(history, {
            schoolFeeItemId: item.id,
            schoolCode: editing.schoolCode,
            previousAmount: prior.amount,
            newAmount: item.amount,
            changedBy: session?.user?.identifier ?? session?.user?.firstName,
            reason: "Modification tarif",
          });
        }
      }
    }

    const auditEntries = [
      makeAuditEntry({
        ...auditActor(session?.user ?? null),
        action: exists ? "fee.grid.update" : "fee.grid.create",
        entityType: "fee_grid",
        entityId: editing.id,
        entityLabel: `${editing.className} · ${editing.academicYear}`,
        schoolCode: editing.schoolCode,
      }),
    ];

    try {
      await persist(
        {
          feeGrids: nextGrids,
          schoolFeeItems: nextItems,
          feeTariffHistory: history,
          auditLog: appendAuditLog(state.auditLog, ...auditEntries),
        },
        exists ? "Grille tarifaire enregistrée" : "Grille tarifaire créée",
      );
      setEditing(null);
    } catch {
      /* toast */
    }
  }

  async function activateGrid(grid: FeeGrid) {
    if (!canUpdate) return;
    const next = (state.feeGrids ?? []).map((g) =>
      g.id === grid.id ? { ...g, status: "Active" as const, updatedAt: new Date().toISOString() } : g,
    );
    await persist({ feeGrids: next }, `Grille activée pour ${grid.className}`);
    setDetail(null);
  }

  async function deactivateGrid(grid: FeeGrid) {
    if (!canUpdate) return;
    const confirmed = await confirm({
      title: "Désactiver cette grille ?",
      description: "Elle ne pourra plus être appliquée aux nouveaux élèves. Les dettes déjà générées sont conservées.",
      confirmLabel: "Désactiver",
      tone: "danger",
    });
    if (!confirmed) return;
    const next = (state.feeGrids ?? []).map((g) =>
      g.id === grid.id ? { ...g, status: "Désactivée" as const } : g,
    );
    await persist({ feeGrids: next }, "Grille désactivée");
    setDetail(null);
  }

  async function applyGrid(grid: FeeGrid) {
    if (!canApply) return;
    const result = applyFeeGridToStudents(state, grid.id);
    const refreshed = refreshStudentFeeStatuses(result.studentFees);
    if (!result.created) {
      showToast(result.message ?? "Aucun frais généré", "error");
      return;
    }
    await persist(
      {
        studentFees: refreshed,
        auditLog: appendAuditLog(
          state.auditLog,
          makeAuditEntry({
            ...auditActor(session?.user ?? null),
            action: "fee.grid.apply",
            entityType: "fee_grid",
            entityId: grid.id,
            entityLabel: `${grid.className} · ${grid.academicYear}`,
            schoolCode: grid.schoolCode,
            details: `${result.created} frais généré(s), ${result.skipped} ignoré(s)`,
          }),
        ),
      },
      `${result.created} frais généré(s) pour la classe ${grid.className}`,
    );
  }

  const columns: Column<FeeGrid>[] = [
    { key: "className", header: "Classe", render: (g) => <span className="font-semibold">{g.className}</span> },
    { key: "academicYear", header: "Année" },
    { key: "periodName", header: "Période", render: (g) => g.periodName || "—" },
    { key: "currency", header: "Devise" },
    {
      key: "items",
      header: "Frais",
      render: (g) => String(itemsForGrid(allItems, g.id).length),
    },
    { key: "status", header: "Statut", render: (g) => <StatusBadge status={g.status} /> },
  ];

  const summary = studentFeeSummary(studentFees);

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title="Grilles tarifaires"
          description={
            activeSchool?.name
              ? `${activeSchool.name} (${schoolCode}) — règles par classe et période, distinctes des dettes élève.`
              : "Définissez inscription, mensualités et frais annexes par classe."
          }
          actions={
            <>
              <PrintButton documentTitle="Frais & tarifs — Somafrik" />
              {canCreate ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setQuickOpen(true)} disabled={!schoolCode}>
                    Saisie rapide
                  </Button>
                  <Button size="sm" onClick={openCreate} disabled={!schoolCode}>
                    Nouvelle grille
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Kpi label="Grilles" value={grids.length} />
          <Kpi label="Reste à payer" value={summary.totalBalance.toLocaleString("fr-FR")} />
          <Kpi label="En retard" value={summary.overdue} />
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="min-w-[10rem]">
            <Field label="Filtrer par classe">
            <Select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              options={[
                { value: "", label: "Toutes" },
                ...classOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
          </div>
          <div className="min-w-[10rem]">
            <Field label="Année scolaire">
            <Select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              options={[
                { value: "", label: "Toutes" },
                ...years.map((year) => ({ value: year, label: year })),
              ]}
            />
          </Field>
          </div>
        </div>

        <div className="mt-4">
          <Table columns={columns} rows={grids} rowKey={(g) => g.id} onRowClick={setDetail} />
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.className} — ${detail.academicYear}` : ""}
        description={detail ? `Devise : ${detail.currency} · Statut : ${detail.status}` : ""}
        footer={
          detail ? (
            <>
              {canUpdate && isGridEditable(detail) ? (
                <Button variant="secondary" onClick={() => openEdit(detail)}>
                  Modifier
                </Button>
              ) : null}
              {canUpdate && detail.status === "Brouillon" ? (
                <Button disabled={busy} onClick={() => void activateGrid(detail)}>
                  Activer
                </Button>
              ) : null}
              {canApply && detail.status === "Active" ? (
                <Button disabled={busy} onClick={() => void applyGrid(detail)}>
                  Appliquer aux élèves
                </Button>
              ) : null}
              {canUpdate && detail.status === "Active" ? (
                <Button variant="danger" disabled={busy} onClick={() => void deactivateGrid(detail)}>
                  Désactiver
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail ? (
          <FeeGridDetail grid={detail} items={itemsForGrid(allItems, detail.id)} fees={studentFees} />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && (state.feeGrids ?? []).some((g) => g.id === editing.id) ? "Modifier la grille" : "Nouvelle grille tarifaire"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button form="fee-grid-form" type="submit" disabled={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="fee-grid-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Classe" hint="Obligatoire">
                <Select
                  value={editing.className}
                  onChange={(e) => setEditing({ ...editing, className: e.target.value })}
                  options={classOptions.map((name) => ({ value: name, label: name }))}
                  required
                />
              </Field>
              <Field label="Année scolaire">
                <Input
                  value={editing.academicYear}
                  onChange={(e) => setEditing({ ...editing, academicYear: e.target.value })}
                  required
                />
              </Field>
              <Field label="Période (optionnel)">
                <Input
                  value={editing.periodName ?? ""}
                  onChange={(e) => setEditing({ ...editing, periodName: e.target.value })}
                  placeholder="Trimestre 1, Semestre 2…"
                />
              </Field>
              <Field label="Devise" hint="Obligatoire">
                <Input
                  value={editing.currency}
                  onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
                  required
                />
              </Field>
              <Field label="Début période">
                <Input
                  value={editing.periodStart ?? ""}
                  onChange={(e) => setEditing({ ...editing, periodStart: e.target.value })}
                  placeholder="JJ-MM-AAAA"
                />
              </Field>
              <Field label="Fin période">
                <Input
                  value={editing.periodEnd ?? ""}
                  onChange={(e) => setEditing({ ...editing, periodEnd: e.target.value })}
                  placeholder="JJ-MM-AAAA"
                />
              </Field>
            </div>

            <div className="border-t border-line pt-4">
              <p className="text-sm font-semibold text-ink">Lignes de frais</p>
              <p className="mt-1 text-xs text-muted">
                Inscription, mensualités (avec mois) et frais annexes. Montants strictement positifs.
              </p>
              <div className="mt-3 space-y-3">
                {draftItems.map((item, index) => (
                  <div key={index} className="rounded-lg border border-line/80 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Type">
                        <Select
                          value={item.feeType}
                          onChange={(e) => {
                            const feeType = e.target.value as SchoolFeeType;
                            const next = [...draftItems];
                            next[index] = {
                              ...item,
                              feeType,
                              monthlyMonths: feeType === "Mensualité" ? DEFAULT_MONTHLY_MONTHS : [],
                            };
                            setDraftItems(next);
                          }}
                          options={SCHOOL_FEE_TYPES.map((t) => ({ value: t, label: t }))}
                        />
                      </Field>
                      <Field label="Libellé">
                        <Input
                          value={item.label}
                          onChange={(e) => {
                            const next = [...draftItems];
                            next[index] = { ...item, label: e.target.value };
                            setDraftItems(next);
                          }}
                          placeholder="Frais d'inscription, Uniforme…"
                        />
                      </Field>
                      <Field label="Montant">
                        <Input
                          type="number"
                          min={1}
                          value={item.amount}
                          onChange={(e) => {
                            const next = [...draftItems];
                            next[index] = { ...item, amount: e.target.value };
                            setDraftItems(next);
                          }}
                        />
                      </Field>
                      <Field label="Date limite">
                        <Input
                          type="date"
                          value={periodDateToInput(item.dueDate)}
                          onChange={(e) => {
                            const next = [...draftItems];
                            next[index] = { ...item, dueDate: inputToPeriodDate(e.target.value) };
                            setDraftItems(next);
                          }}
                        />
                      </Field>
                    </div>
                    {item.feeType === "Mensualité" ? (
                      <div className="mt-3">
                        <Field label="Mois concernés">
                        <Input
                          value={item.monthlyMonths.join(", ")}
                          onChange={(e) => {
                            const next = [...draftItems];
                            next[index] = {
                              ...item,
                              monthlyMonths: e.target.value.split(",").map((m) => m.trim()).filter(Boolean),
                            };
                            setDraftItems(next);
                          }}
                          placeholder={DEFAULT_MONTHLY_MONTHS.join(", ")}
                        />
                      </Field>
                      </div>
                    ) : null}
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.mandatory}
                        onChange={(e) => {
                          const next = [...draftItems];
                          next[index] = { ...item, mandatory: e.target.checked };
                          setDraftItems(next);
                        }}
                      />
                      Frais obligatoire
                    </label>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setDraftItems([...draftItems, { ...EMPTY_ITEM, label: "Frais annexe" }])}
              >
                Ajouter une ligne
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <QuickFeeGridModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        schoolCode={schoolCode}
      />
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface/50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-ink">{value}</p>
    </div>
  );
}

function FeeGridDetail({
  grid,
  items,
  fees,
}: {
  grid: FeeGrid;
  items: SchoolFeeItem[];
  fees: StudentFee[];
}) {
  const linked = fees.filter((fee) => fee.feeGridId === grid.id);
  const paid = linked.filter((f) => f.status === "Payé").length;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs font-semibold uppercase text-muted">Période</dt>
          <dd>{grid.periodName || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted">Dettes générées</dt>
          <dd>{linked.length}</dd>
        </div>
      </dl>
      <div>
        <p className="text-xs font-semibold uppercase text-muted">Frais définis</p>
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span>
                {item.feeType} — {item.label}
                {!item.mandatory ? " (optionnel)" : ""}
              </span>
              <span className="font-semibold">
                {item.amount.toLocaleString("fr-FR")} {grid.currency}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {paid} frais soldés sur {linked.length} dettes générées à partir de cette grille.
      </p>
    </div>
  );
}
