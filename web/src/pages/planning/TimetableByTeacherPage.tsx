import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Field, Select } from "../../components/ui/Field";
import { PrintButton } from "../../components/ui/PrintButton";
import { DataTable } from "../../components/ui/DataTable";
import { scopedTeachers } from "../../lib/establishment";
import {
  isExamSchedule,
  PLANNING_WEEKDAYS,
  scopedCourseSchedules,
  slotEndHm,
  slotIsoWeekday,
  slotStartHm,
  type CourseScheduleSlot,
} from "../../lib/coursePlanning";

function weekdayLabel(value: number): string {
  return PLANNING_WEEKDAYS.find((row) => row.value === value)?.label ?? "—";
}

const columns: ColumnDef<CourseScheduleSlot>[] = [
  {
    id: "day",
    header: "Jour",
    accessorFn: (row) => slotIsoWeekday(row),
    cell: ({ getValue }) => weekdayLabel(getValue<number>()),
  },
  {
    id: "time",
    header: "Horaire",
    accessorFn: (row) => slotStartHm(row),
    cell: ({ row }) =>
      `${slotStartHm(row.original)} – ${slotEndHm(row.original)}`,
  },
  { accessorKey: "className", header: "Classe" },
  { accessorKey: "subject", header: "Cours" },
  { id: "room", header: "Salle", accessorFn: (row) => row.room || "—" },
  {
    id: "kind",
    header: "Type",
    accessorFn: (row) => (isExamSchedule(row) ? "Examen" : "Cours"),
    cell: ({ getValue }) => {
      const value = getValue<string>();
      return (
        <span className={value === "Examen" ? "font-semibold text-amber-700" : undefined}>
          {value}
        </span>
      );
    },
  },
];

export function TimetableByTeacherPage() {
  const { session } = useAuth();
  const { state } = useData();
  const { scopedUser } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;

  const teacherOptions = useMemo(
    () =>
      scopedTeachers(scopeUser, state)
        .map((row) => ({
          id: String(row.id ?? ""),
          name:
            String(row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()) ||
            String(row.id ?? ""),
        }))
        .filter((teacher) => teacher.id)
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [scopeUser, state],
  );

  const [selectedTeacher, setSelectedTeacher] = useState("");
  const effectiveTeacher = selectedTeacher || teacherOptions[0]?.id || "";
  const teacherName = teacherOptions.find((teacher) => teacher.id === effectiveTeacher)?.name ?? "";

  const slots = useMemo(() => scopedCourseSchedules(scopeUser, state), [scopeUser, state]);
  const rows = useMemo(
    () => slots.filter((slot) => String(slot.teacherId ?? "") === effectiveTeacher),
    [slots, effectiveTeacher],
  );

  return (
    <Card className="p-6">
      <SectionHeader
        title={teacherName ? `Emploi du temps — ${teacherName}` : "Emploi du temps par enseignant"}
        description={`${rows.length} créneau(x)`}
        actions={
          teacherName ? (
            <PrintButton documentTitle={`Emploi du temps — ${teacherName}`} />
          ) : undefined
        }
      />
      <div className="no-print mt-4 max-w-xs">
        <Field label="Enseignant">
          <Select
            value={effectiveTeacher}
            onChange={(event) => setSelectedTeacher(event.target.value)}
            options={teacherOptions.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
          />
        </Field>
      </div>
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: "day", desc: false }]}
          emptyLabel="Aucun cours assigné à cet enseignant."
        />
      </div>
    </Card>
  );
}
