import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { PrintButton } from "../../components/ui/PrintButton";
import { DataTable } from "../../components/ui/DataTable";
import { useToast } from "../../components/ui/Toast";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { normalize } from "../../lib/format";
import {
  auditSchoolPlanningConsistency,
  canRepairSchoolPlanning,
  clearSchoolAssignments,
  extractTimeFromIso,
  mergeCourseSchedules,
  mergePlanningLinkedCourses,
  mergePlanningLinkedExams,
  PLANNING_WEEKDAYS,
  repairSchoolCourseSchedules,
  scopedCourseSchedules,
  weekdayFromIso,
} from "../../lib/coursePlanning";

function weekdayLabel(value: number): string {
  return PLANNING_WEEKDAYS.find((row) => row.value === value)?.label ?? "—";
}

interface ConflictRow {
  slotId: string;
  className: string;
  subject: string;
  when: string;
  message: string;
}

const columns: ColumnDef<ConflictRow>[] = [
  { accessorKey: "className", header: "Classe" },
  { accessorKey: "subject", header: "Matière" },
  { accessorKey: "when", header: "Créneau" },
  {
    accessorKey: "message",
    header: "Anomalie",
    enableSorting: false,
    cell: ({ getValue }) => (
      <span className="inline-flex items-start gap-2 text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        {getValue<string>()}
      </span>
    ),
  },
];

export function PlanningConflictsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const { showToast } = useToast();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const schoolCode = activeSchoolCode || scopeUser?.schoolCode || "";
  const { canUpdate } = useFeaturePermissions("Planning de cours");
  const [saving, setSaving] = useState(false);

  const slots = useMemo(() => scopedCourseSchedules(scopeUser, state), [scopeUser, state]);

  const issues = useMemo(
    () => auditSchoolPlanningConsistency(slots, state, scopeUser, schoolCode),
    [slots, state, scopeUser, schoolCode],
  );

  const rows = useMemo<ConflictRow[]>(() => {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    return issues.map((issue) => {
      const slot = byId.get(issue.slotId);
      return {
        slotId: issue.slotId,
        className: slot?.className || "—",
        subject: slot?.subject || "—",
        when: slot
          ? `${weekdayLabel(weekdayFromIso(slot.start))} ${extractTimeFromIso(slot.start)}–${extractTimeFromIso(slot.end)}`
          : "—",
        message: issue.message,
      };
    });
  }, [issues, slots]);

  const repairAvailable = useMemo(
    () => Boolean(schoolCode && canRepairSchoolPlanning(state, scopeUser, schoolCode)),
    [state, scopeUser, schoolCode],
  );

  async function handleRepair() {
    if (!schoolCode || !canUpdate) return;
    const previousSchoolSlots = scopedCourseSchedules(scopeUser, state).filter(
      (row) => normalize(row.schoolCode) === normalize(schoolCode),
    );
    const report = repairSchoolCourseSchedules(state, scopeUser, schoolCode);
    setSaving(true);
    try {
      await update(
        {
          courseSchedules: mergeCourseSchedules(state, schoolCode, report.slots),
          exams: mergePlanningLinkedExams(state, report.slots, previousSchoolSlots),
          courses: mergePlanningLinkedCourses(state, report.slots, previousSchoolSlots, schoolCode),
          assignments: clearSchoolAssignments(state, schoolCode),
        },
        { partial: true },
      );
      showToast("Données du planning corrigées.", "success");
    } catch {
      showToast("Échec de la correction du planning.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <SectionHeader
        title="Conflits & cohérence du planning"
        description={
          issues.length
            ? `${issues.length} anomalie(s) détectée(s) sur les créneaux de l'établissement`
            : "Aucune anomalie détectée"
        }
        actions={
          <>
            {issues.length ? <PrintButton documentTitle="Conflits du planning — Somafrik" /> : null}
            {repairAvailable && canUpdate ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => void handleRepair()}
              >
                {saving ? "Correction…" : "Corriger automatiquement"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mt-4">
        {issues.length ? (
          <DataTable
            columns={columns}
            data={rows}
            emptyLabel="Aucune anomalie."
            initialSorting={[{ id: "className", desc: false }]}
          />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-16 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-600" />
            <h3 className="text-lg font-black text-ink">Planning cohérent</h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              Aucun conflit d'horaire ni incohérence détecté sur les créneaux de cet établissement.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
