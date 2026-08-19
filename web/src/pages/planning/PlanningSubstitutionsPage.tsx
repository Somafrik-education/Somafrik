import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Repeat } from "lucide-react";
import { ApiError } from "../../api/client";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { DataTable } from "../../components/ui/DataTable";
import { useToast } from "../../components/ui/Toast";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { pedagogyApi } from "../../lib/pedagogyApi";
import {
  replacementsApi,
  type CourseScheduleReplacement,
  type SubstituteOption,
} from "../../lib/planningRoomsReplacementsApi";

type OccurrenceOption = {
  scheduleId: string;
  occurrenceDate: string;
  className: string;
  courseName: string;
  teacherName: string;
  startTime: string;
  endTime: string;
  label: string;
};

function statusLabel(status: string): string {
  if (status === "cancelled") return "Annulé";
  if (status === "completed") return "Effectué";
  return "Planifié";
}

export function PlanningSubstitutionsPage() {
  const { canRead, canCreate, canDelete } = useFeaturePermissions("Remplacements");
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "forbidden">("loading");
  const [items, setItems] = useState<CourseScheduleReplacement[]>([]);
  const [filterDate, setFilterDate] = useState(params.get("occurrenceDate") || "");
  const [filterStatus, setFilterStatus] = useState("planned");
  const [wizardOpen, setWizardOpen] = useState(Boolean(params.get("weeklySlotId")));
  const [wizardDate, setWizardDate] = useState(params.get("occurrenceDate") || "");
  const [occurrences, setOccurrences] = useState<OccurrenceOption[]>([]);
  const [weeklySlotId, setWeeklySlotId] = useState(params.get("weeklySlotId") || "");
  const [originalName, setOriginalName] = useState("");
  const [substitutes, setSubstitutes] = useState<SubstituteOption[]>([]);
  const [substituteTeacherId, setSubstituteTeacherId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadList() {
    if (!canRead) {
      setStatus("forbidden");
      return;
    }
    setStatus("loading");
    try {
      const result = await replacementsApi.list({
        from: filterDate || undefined,
        to: filterDate || undefined,
        status: filterStatus || undefined,
      });
      setItems(result.items ?? []);
      setStatus("ok");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setStatus("forbidden");
        return;
      }
      setStatus("error");
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, filterDate, filterStatus]);

  async function loadOccurrences(date: string) {
    if (!date) {
      setOccurrences([]);
      return;
    }
    const projection = await pedagogyApi.listCourseScheduleOccurrences({ from: date, to: date });
    const next = (projection.items ?? []).map((raw) => {
      const row = raw as Record<string, unknown>;
      const scheduleId = String(row.scheduleId ?? row.id ?? "");
      const className = String(row.className ?? "");
      const courseName = String(row.courseName ?? row.subject ?? "");
      const teacherName = String(row.originalTeacher ?? row.teacherName ?? row.teacher ?? "");
      const startTime = String(row.startTime ?? "").slice(0, 5);
      const endTime = String(row.endTime ?? "").slice(0, 5);
      return {
        scheduleId,
        occurrenceDate: String(row.occurrenceDate ?? date),
        className,
        courseName,
        teacherName,
        startTime,
        endTime,
        label: `${className} · ${courseName} · ${startTime}–${endTime} · ${teacherName}`,
      };
    });
    setOccurrences(next);
  }

  useEffect(() => {
    if (wizardOpen && wizardDate) void loadOccurrences(wizardDate);
  }, [wizardOpen, wizardDate]);

  async function loadOptions(slotId: string, date: string) {
    if (!slotId || !date) return;
    const result = await replacementsApi.options({ weeklySlotId: slotId, occurrenceDate: date });
    setOriginalName(result.originalTeacherName);
    setSubstitutes(result.items ?? []);
  }

  useEffect(() => {
    if (weeklySlotId && wizardDate) void loadOptions(weeklySlotId, wizardDate);
  }, [weeklySlotId, wizardDate]);

  const columns = useMemo<ColumnDef<CourseScheduleReplacement>[]>(
    () => [
      { accessorKey: "occurrenceDate", header: "Date" },
      { accessorKey: "originalTeacherName", header: "Enseignant absent" },
      { accessorKey: "className", header: "Classe" },
      { accessorKey: "courseName", header: "Cours" },
      {
        id: "time",
        header: "Horaire",
        cell: ({ row }) => `${row.original.startTime}–${row.original.endTime}`,
      },
      { accessorKey: "substituteTeacherName", header: "Remplaçant" },
      { accessorKey: "reason", header: "Motif" },
      {
        accessorKey: "status",
        header: "Statut",
        cell: ({ getValue }) => statusLabel(String(getValue() ?? "")),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) =>
          canDelete && row.original.status !== "cancelled" ? (
            <Button variant="secondary" onClick={() => void cancelRow(row.original)}>
              Annuler
            </Button>
          ) : null,
      },
    ],
    [canDelete],
  );

  async function cancelRow(row: CourseScheduleReplacement) {
    try {
      await replacementsApi.cancel(row.id);
      showToast("Remplacement annulé", "success");
      await loadList();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'annulation.", "error");
    }
  }

  async function saveWizard() {
    if (!weeklySlotId || !wizardDate || !substituteTeacherId) {
      showToast("Date, cours et remplaçant sont obligatoires.", "error");
      return;
    }
    setSaving(true);
    try {
      await replacementsApi.create({
        weeklySlotId,
        occurrenceDate: wizardDate,
        substituteTeacherId,
        reason,
      });
      showToast("Remplacement programmé", "success");
      setWizardOpen(false);
      setParams({});
      setSubstituteTeacherId("");
      setReason("");
      await loadList();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec du remplacement.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (status === "forbidden" || !canRead) {
    return (
      <Card className="p-6" data-testid="planning-replacements-forbidden">
        <p className="text-sm font-semibold text-muted">Accès refusé au module Remplacements.</p>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="p-6" data-testid="planning-replacements-error">
        <p className="text-sm font-semibold text-danger">Impossible de charger les remplacements.</p>
        <Button className="mt-3" onClick={() => void loadList()}>
          Réessayer
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5" data-testid="planning-replacements-page">
      <Card className="p-6">
        <SectionHeader
          title="Remplacements"
          description="Exception datée sur une occurrence du planning hebdomadaire. Le titulaire du cours et du créneau restent inchangés."
          actions={
            canCreate ? (
              <Button
                data-testid="planning-replacement-create"
                onClick={() => {
                  setWizardOpen(true);
                }}
              >
                + Programmer un remplacement
              </Button>
            ) : null
          }
        />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
          </Field>
          <Field label="Statut">
            <Select
              options={[
                { value: "", label: "Tous" },
                { value: "planned", label: "Planifié" },
                { value: "completed", label: "Effectué" },
                { value: "cancelled", label: "Annulé" },
              ]}
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-sm text-muted">Chargement des remplacements…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <Repeat className="mb-3 h-10 w-10 text-muted" />
              <h3 className="text-lg font-black text-ink">Aucun remplacement</h3>
              <p className="mt-1 max-w-md text-sm text-muted">
                Programmez un remplaçant pour une date précise, sans modifier l'emploi du temps type.
              </p>
            </div>
          ) : (
            <DataTable columns={columns} data={items} emptyLabel="Aucun remplacement." />
          )}
        </div>
      </Card>

      {wizardOpen && canCreate ? (
        <Card className="p-6" data-testid="planning-replacement-form">
          <SectionHeader title="Programmer un remplacement" />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="1. Date" required>
              <Input
                type="date"
                data-testid="planning-replacement-date"
                value={wizardDate}
                onChange={(event) => {
                  setWizardDate(event.target.value);
                  setWeeklySlotId("");
                  setSubstituteTeacherId("");
                }}
              />
            </Field>
            <Field label="2. Cours / occurrence" required>
              <Select
                data-testid="planning-replacement-slot"
                value={weeklySlotId}
                onChange={(event) => setWeeklySlotId(event.target.value)}
                options={[
                  { value: "", label: "Sélectionner un cours" },
                  ...occurrences.map((row) => ({ value: row.scheduleId, label: row.label })),
                ]}
              />
            </Field>
            <Field label="3. Titulaire">
              <Input readOnly value={originalName || "—"} />
            </Field>
            <Field label="4. Remplaçant disponible" required>
              <Select
                data-testid="planning-replacement-substitute"
                value={substituteTeacherId}
                onChange={(event) => setSubstituteTeacherId(event.target.value)}
                options={[
                  { value: "", label: "Sélectionner un enseignant" },
                  ...substitutes.map((row) => ({
                    value: row.teacherId,
                    label: `${row.name} · ${row.teacherCode}${row.speciality ? ` · ${row.speciality}` : ""} · ${
                      row.availability === "available"
                        ? "Disponible"
                        : row.availability === "schedule_conflict"
                          ? "Conflit horaire"
                          : "Non affecté à cette discipline"
                    }`,
                  })),
                ]}
              />
            </Field>
            <Field label="5. Motif">
              <Input
                data-testid="planning-replacement-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-3">
            <Button data-testid="planning-replacement-save" disabled={saving} onClick={() => void saveWizard()}>
              {saving ? "Enregistrement…" : "6. Confirmer"}
            </Button>
            <Button variant="secondary" onClick={() => setWizardOpen(false)}>
              Fermer
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
