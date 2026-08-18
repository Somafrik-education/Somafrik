import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Field, Select } from "../../components/ui/Field";
import { PrintButton } from "../../components/ui/PrintButton";
import { DataTable } from "../../components/ui/DataTable";
import { scopedClasses } from "../../lib/establishment";
import {
  filterSlotsByClass,
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
  { accessorKey: "subject", header: "Cours" },
  { id: "teacher", header: "Enseignant", accessorFn: (row) => row.teacherName || "—" },
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

export function TimetableByClassPage() {
  const { session } = useAuth();
  const { state } = useData();
  const { scopedUser } = useActiveSchool();
  const scopeUser = scopedUser ?? session?.user ?? null;

  const classes = useMemo(() => {
    const names = scopedClasses(scopeUser, state)
      .map((row) => String(row.name ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "fr"));
  }, [scopeUser, state]);

  const [selectedClass, setSelectedClass] = useState("");
  const effectiveClass = selectedClass || classes[0] || "";

  const slots = useMemo(() => scopedCourseSchedules(scopeUser, state), [scopeUser, state]);
  const rows = useMemo(() => filterSlotsByClass(slots, effectiveClass), [slots, effectiveClass]);

  return (
    <Card className="p-6">
      <SectionHeader
        title={effectiveClass ? `Emploi du temps — ${effectiveClass}` : "Emploi du temps par classe"}
        description={`${rows.length} créneau(x)`}
        actions={
          effectiveClass ? (
            <PrintButton documentTitle={`Emploi du temps — ${effectiveClass}`} />
          ) : undefined
        }
      />
      <div className="no-print mt-4 max-w-xs">
        <Field label="Classe">
          <Select
            value={effectiveClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            options={classes.map((name) => ({ value: name, label: name }))}
          />
        </Field>
      </div>
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: "day", desc: false }]}
          emptyLabel="Aucun cours planifié pour cette classe."
        />
      </div>
    </Card>
  );
}
