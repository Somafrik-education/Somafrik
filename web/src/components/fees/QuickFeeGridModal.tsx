import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { Modal } from "../ui/Modal";
import { Field, Input } from "../ui/Field";
import { RequiredMark } from "../../design-system/forms/RequiredMark";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import {
  classChoicesForSchool,
  classOptionsForSchool,
} from "../../lib/fees";
import {
  buildQuickFeeGrids,
  countStudentsInClass,
  defaultQuickFeeGridInput,
  QUICK_FEE_AMOUNT_SHORTCUTS,
  validateQuickFeeGridInput,
  type QuickFeeGridInput,
} from "../../lib/quickFeeGrid";
import { financeApi } from "../../lib/financeApi";
import { createFinanceIdempotencyKey } from "../../lib/financeIdempotency";
import { formatMetric, normalize } from "../../lib/format";

interface QuickFeeGridModalProps {
  open: boolean;
  onClose: () => void;
  schoolCode: string;
  onSaved?: () => void;
}

export function QuickFeeGridModal({ open, onClose, schoolCode, onSaved }: QuickFeeGridModalProps) {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();

  const [form, setForm] = useState<QuickFeeGridInput>(() =>
    defaultQuickFeeGridInput(state, schoolCode),
  );
  const [busy, setBusy] = useState(false);

  const classOptions = useMemo(
    () => classOptionsForSchool(state, schoolCode),
    [state, schoolCode],
  );
  const classChoices = useMemo(
    () => classChoicesForSchool(state, schoolCode),
    [state, schoolCode],
  );

  const classStats = useMemo(
    () =>
      (classChoices.length
        ? classChoices
        : classOptions.map((className) => ({ classId: className, classCode: "", className }))
      ).map((choice) => ({
        ...choice,
        students: countStudentsInClass(state, schoolCode, choice.className),
        selected: (form.selectedClasses ?? []).some((row) => row.classId === choice.classId)
          || form.classNames.some((name) => normalize(name) === normalize(choice.className)),
        hasGrid: (state.feeGrids ?? []).some(
          (grid) =>
            normalize(grid.schoolCode) === normalize(schoolCode) &&
            (grid.classId ? grid.classId === choice.classId : normalize(grid.className) === normalize(choice.className)) &&
            grid.academicYear === form.academicYear,
        ),
      })),
    [classChoices, classOptions, state, schoolCode, form.selectedClasses, form.classNames, form.academicYear],
  );

  useEffect(() => {
    if (!open) return;
    setForm(defaultQuickFeeGridInput(state, schoolCode));
  }, [open, schoolCode, state]);

  function toggleClass(choice: { classId: string; classCode: string; className: string }) {
    setForm((current) => {
      const selected = current.selectedClasses ?? [];
      const exists = selected.some((row) => row.classId === choice.classId);
      const nextSelected = exists
        ? selected.filter((row) => row.classId !== choice.classId)
        : [...selected, choice];
      return {
        ...current,
        selectedClasses: nextSelected,
        classNames: nextSelected.map((row) => row.className),
      };
    });
  }

  function selectAllClasses() {
    setForm((current) => ({
      ...current,
      selectedClasses: classStats.map((row) => ({
        classId: row.classId,
        classCode: row.classCode,
        className: row.className,
      })),
      classNames: classStats.map((row) => row.className),
    }));
  }

  function clearClasses() {
    setForm((current) => ({ ...current, classNames: [], selectedClasses: [] }));
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

    setBusy(true);
    try {
      let appliedTotal = 0;
      for (const grid of built.grids) {
        const items = built.items.filter((item) => item.feeGridId === grid.id);
        const created = await financeApi.createFeeGrid({
          classId: grid.classId,
          classCode: grid.classCode,
          className: grid.className,
          academicYear: grid.academicYear,
          periodName: grid.periodName,
          currency: grid.currency,
          status: form.activateImmediately ? "Brouillon" : grid.status,
          items,
        });
        if (form.activateImmediately) {
          await financeApi.activateFeeGrid(created.id);
          if (form.applyToStudents) {
            const applied = await financeApi.applyFeeGrid(created.id, {}, {
              idempotencyKey: createFinanceIdempotencyKey(),
            });
            appliedTotal += applied.created;
          }
        }
      }
      await refresh();
      const skipped = built.skippedClasses.length;
      const message =
        `${built.grids.length} grille(s) créée(s)` +
        (appliedTotal ? ` · ${appliedTotal} dette(s) générée(s)` : "") +
        (skipped ? ` · ${skipped} classe(s) ignorée(s)` : "");
      showToast(message, skipped && !built.grids.length ? "error" : "success");
      onSaved?.();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'enregistrement", "error");
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
          <Field label="Année scolaire" required>
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
            <p className="text-sm font-semibold text-ink">
              Classes
              <RequiredMark />
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={selectAllClasses}>
                Tout sélectionner
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={clearClasses}>
                Effacer
              </Button>
            </div>
          </div>
          {!classStats.length ? (
            <p className="text-sm text-muted">Aucune classe disponible pour cet établissement.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {classStats.map((choice) => (
                <button
                  key={choice.classId}
                  type="button"
                  onClick={() =>
                    toggleClass({
                      classId: choice.classId,
                      classCode: choice.classCode,
                      className: choice.className,
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                    choice.selected
                      ? "border-brand bg-brand-50 text-brand"
                      : "border-line bg-white hover:border-brand/30"
                  }`}
                >
                  <span className="font-semibold">{choice.className}</span>
                  <span className="mt-0.5 block text-xs opacity-80">
                    {choice.students} élève(s){choice.hasGrid ? " · grille existante" : ""}
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
            label="Scolarité (échéancier mensuel)"
            hint="Génère une ligne par mois scolaire"
            value={form.monthlyAmount ?? ""}
            currency={form.currency}
            onChange={(value) => setForm({ ...form, monthlyAmount: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Autre frais (libellé)">
              <Input
                value={form.annexLabel ?? ""}
                onChange={(event) => setForm({ ...form, annexLabel: event.target.value })}
                placeholder="Transport, cantine, uniforme…"
              />
            </Field>
            <AmountField
              label="Montant autre"
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
