import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { Modal } from "../ui/Modal";
import { Field, Input } from "../ui/Field";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { appendAuditLog, auditActor, makeAuditEntry } from "../../lib/audit";
import {
  applyFeeGridToStudents,
  classOptionsForSchool,
  refreshStudentFeeStatuses,
} from "../../lib/fees";
import {
  buildQuickFeeGrids,
  countStudentsInClass,
  defaultQuickFeeGridInput,
  QUICK_FEE_AMOUNT_SHORTCUTS,
  validateQuickFeeGridInput,
  type QuickFeeGridInput,
} from "../../lib/quickFeeGrid";
import { formatMetric, normalize } from "../../lib/format";
import type { BackOfficeState } from "../../types";

interface QuickFeeGridModalProps {
  open: boolean;
  onClose: () => void;
  schoolCode: string;
  onSaved?: () => void;
}

export function QuickFeeGridModal({ open, onClose, schoolCode, onSaved }: QuickFeeGridModalProps) {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();

  const [form, setForm] = useState<QuickFeeGridInput>(() =>
    defaultQuickFeeGridInput(state, schoolCode),
  );
  const [busy, setBusy] = useState(false);

  const classOptions = useMemo(
    () => classOptionsForSchool(state, schoolCode),
    [state, schoolCode],
  );

  const classStats = useMemo(
    () =>
      classOptions.map((className) => ({
        className,
        students: countStudentsInClass(state, schoolCode, className),
        selected: form.classNames.some((name) => normalize(name) === normalize(className)),
        hasGrid: (state.feeGrids ?? []).some(
          (grid) =>
            normalize(grid.schoolCode) === normalize(schoolCode) &&
            normalize(grid.className) === normalize(className) &&
            grid.academicYear === form.academicYear,
        ),
      })),
    [classOptions, state, schoolCode, form.classNames, form.academicYear],
  );

  useEffect(() => {
    if (!open) return;
    setForm(defaultQuickFeeGridInput(state, schoolCode));
  }, [open, schoolCode, state]);

  function toggleClass(className: string) {
    setForm((current) => {
      const exists = current.classNames.some((name) => normalize(name) === normalize(className));
      return {
        ...current,
        classNames: exists
          ? current.classNames.filter((name) => normalize(name) !== normalize(className))
          : [...current.classNames, className],
      };
    });
  }

  function selectAllClasses() {
    setForm((current) => ({ ...current, classNames: [...classOptions] }));
  }

  function clearClasses() {
    setForm((current) => ({ ...current, classNames: [] }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateQuickFeeGridInput(form);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const built = buildQuickFeeGrids(form, state, session?.user ?? null);
    if (!built.grids.length) {
      const reason = built.skippedClasses[0]?.reason ?? "Aucune grille créée";
      showToast(reason, "error");
      return;
    }

    let nextStudentFees = state.studentFees ?? [];
    let appliedTotal = 0;

    if (form.applyToStudents && form.activateImmediately) {
      for (const grid of built.grids) {
        if (grid.status !== "Active") continue;
        const result = applyFeeGridToStudents(
          { ...state, studentFees: nextStudentFees, feeGrids: [...(state.feeGrids ?? []), ...built.grids], schoolFeeItems: [...(state.schoolFeeItems ?? []), ...built.items] },
          grid.id,
        );
        nextStudentFees = result.studentFees;
        appliedTotal += result.created;
      }
      nextStudentFees = refreshStudentFeeStatuses(nextStudentFees);
    }

    const patch: Partial<BackOfficeState> = {
      feeGrids: [...(state.feeGrids ?? []), ...built.grids],
      schoolFeeItems: [...(state.schoolFeeItems ?? []), ...built.items],
      auditLog: appendAuditLog(state.auditLog, ...built.auditEntries),
    };

    if (form.applyToStudents && form.activateImmediately) {
      patch.studentFees = nextStudentFees;
      if (appliedTotal > 0) {
        patch.auditLog = appendAuditLog(
          patch.auditLog ?? state.auditLog,
          makeAuditEntry({
            ...auditActor(session?.user ?? null),
            action: "fee.grid.quick_apply",
            entityType: "fee_grid",
            entityId: built.grids.map((grid) => grid.id).join(","),
            schoolCode: form.schoolCode,
            details: `${appliedTotal} dette(s) élève générée(s)`,
          }),
        );
      }
    }

    setBusy(true);
    try {
      await update(patch);
      const skipped = built.skippedClasses.length;
      const message =
        `${built.grids.length} grille(s) créée(s)` +
        (appliedTotal ? ` · ${appliedTotal} dette(s) générée(s)` : "") +
        (skipped ? ` · ${skipped} classe(s) ignorée(s)` : "");
      showToast(message, skipped && !built.grids.length ? "error" : "success");
      onSaved?.();
      onClose();
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Saisie rapide — grilles tarifaires"
      description="Sélectionnez une ou plusieurs classes et définissez les montants communs."
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button disabled={busy || !form.classNames.length} onClick={(event) => void handleSubmit(event)}>
            Créer {form.classNames.length ? `(${form.classNames.length})` : ""}
          </Button>
        </div>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Année scolaire">
            <Input
              value={form.academicYear}
              onChange={(event) => setForm({ ...form, academicYear: event.target.value })}
              required
            />
          </Field>
          <Field label="Devise">
            <Input value={form.currency} readOnly />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Classes</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={selectAllClasses}>
                Tout sélectionner
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={clearClasses}>
                Effacer
              </Button>
            </div>
          </div>
          {!classOptions.length ? (
            <p className="text-sm text-muted">Aucune classe disponible pour cet établissement.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {classStats.map(({ className, students, selected, hasGrid }) => (
                <button
                  key={className}
                  type="button"
                  onClick={() => toggleClass(className)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "border-brand bg-brand-50 text-brand"
                      : "border-line bg-white hover:border-brand/30"
                  }`}
                >
                  <span className="font-semibold">{className}</span>
                  <span className="mt-0.5 block text-xs opacity-80">
                    {students} élève(s)
                    {hasGrid ? " · grille existante" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
          {form.classNames.length ? (
            <p className="mt-2 text-xs text-muted">
              {form.classNames.length} classe(s) sélectionnée(s)
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-700">Sélectionnez au moins une classe</p>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-line bg-slate-50/80 p-4">
          <p className="text-sm font-semibold text-ink">Montants communs</p>

          <AmountField
            label="Inscription"
            value={form.inscriptionAmount ?? ""}
            currency={form.currency}
            onChange={(value) => setForm({ ...form, inscriptionAmount: value })}
          />
          <AmountField
            label="Mensualité (minerval)"
            hint="Génère une ligne par mois scolaire"
            value={form.monthlyAmount ?? ""}
            currency={form.currency}
            onChange={(value) => setForm({ ...form, monthlyAmount: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Frais annexe (libellé)">
              <Input
                value={form.annexLabel ?? ""}
                onChange={(event) => setForm({ ...form, annexLabel: event.target.value })}
                placeholder="Transport, cantine, uniforme…"
              />
            </Field>
            <AmountField
              label="Montant annexe"
              value={form.annexAmount ?? ""}
              currency={form.currency}
              onChange={(value) => setForm({ ...form, annexAmount: value })}
            />
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.activateImmediately}
              onChange={(event) => setForm({ ...form, activateImmediately: event.target.checked })}
            />
            Activer immédiatement les grilles
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.applyToStudents}
              onChange={(event) => setForm({ ...form, applyToStudents: event.target.checked })}
              disabled={!form.activateImmediately}
            />
            Générer les dettes pour les élèves des classes sélectionnées
          </label>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted">
          <Zap className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
          Les classes avec une grille existante pour la même année sont ignorées.
        </p>
      </form>
    </Modal>
  );
}

function AmountField({
  label,
  hint,
  value,
  currency,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | "";
  currency: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={`${label} (${currency})`} hint={hint}>
      <Input
        type="number"
        min={0}
        step={1}
        value={value === "" ? "" : value}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        placeholder="0 = non appliqué"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK_FEE_AMOUNT_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut}
            type="button"
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold hover:border-brand/40 hover:text-brand"
            onClick={() => onChange(shortcut)}
          >
            {formatMetric(shortcut)}
          </button>
        ))}
        <button
          type="button"
          className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-muted hover:border-rose-200 hover:text-rose-600"
          onClick={() => onChange(undefined)}
        >
          Effacer
        </button>
      </div>
    </Field>
  );
}
