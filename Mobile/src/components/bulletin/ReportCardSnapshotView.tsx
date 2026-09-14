import { StyleSheet, Text, View } from "react-native";
import {
  cellLabel,
  matchingPresence,
  matchingSlots,
  presenceLabel,
  slotLabel,
  type RenderingTemplate,
  type SnapshotPayload,
  type SnapshotPresence,
  type SnapshotSlot,
  type SnapshotStudent,
} from "../../lib/reportCardSnapshotDisplay";

function CellsTable({ student }: { student: SnapshotStudent }) {
  return (
    <View>
      {(student.cells || []).map((cell, index) => (
        <Text key={`${cell.subject_id}-${cell.period_id}-${cell.score_component_id}-${index}`} style={styles.row}>
          {cell.subject_id} · {cell.period_id} · {cell.score_component_id} · {cellLabel(cell)}
        </Text>
      ))}
    </View>
  );
}

function SlotsTable({ slots }: { slots: SnapshotSlot[] }) {
  return (
    <View>
      {slots.map((slot, index) => (
        <Text key={`${slot.slot}-${index}`} style={styles.row}>
          {slot.slot} · {slotLabel(slot)}
        </Text>
      ))}
    </View>
  );
}

function PresenceList({ presence }: { presence: SnapshotPresence[] }) {
  return (
    <View>
      {presence.map((entry, index) => (
        <Text key={`${entry.section_id}-${entry.column_id}-${entry.row_id}-${index}`} style={styles.row}>
          {presenceLabel(entry)}
        </Text>
      ))}
    </View>
  );
}

function StudentView({ student, template }: { student: SnapshotStudent; template?: RenderingTemplate | null }) {
  const sections = template?.sections;
  if (sections && sections.length) {
    return (
      <View>
        <Text style={styles.student}>{student.student_id}</Text>
        {sections.map((section) => {
          if (section.source === "cells") {
            return (
              <View key={section.id}>
                <Text style={styles.section}>{section.label || section.id}</Text>
                <CellsTable student={student} />
              </View>
            );
          }
          if (section.source === "slots") {
            return (
              <View key={section.id}>
                <Text style={styles.section}>{section.label || section.id}</Text>
                <SlotsTable slots={matchingSlots(student, section.id)} />
              </View>
            );
          }
          return (
            <View key={section.id}>
              <Text style={styles.section}>{section.label || section.id}</Text>
              <PresenceList presence={matchingPresence(student, section.id)} />
            </View>
          );
        })}
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.student}>{student.student_id}</Text>
      <CellsTable student={student} />
      <SlotsTable slots={student.slots || []} />
      <PresenceList presence={student.presence || []} />
    </View>
  );
}

export function ReportCardSnapshotView({
  payload,
  template,
  studentId,
}: {
  payload: SnapshotPayload | null | undefined;
  template?: RenderingTemplate | null;
  studentId?: string;
}) {
  if (!payload) return null;
  const students = Array.isArray(payload.students) ? payload.students : [];
  const visible = studentId ? students.filter((student) => student.student_id === studentId) : students;
  return (
    <View testID="report-card-snapshot" style={styles.wrap}>
      <Text style={styles.meta}>
        Bulletin {payload.report_card_id} · v{payload.published_snapshot_version}
      </Text>
      {visible.map((student) => (
        <StudentView key={student.student_id} student={student} template={template} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  meta: { color: "#64748B", fontWeight: "800", marginBottom: 8 },
  student: { color: "#0F172A", fontWeight: "900", fontSize: 16, marginBottom: 6 },
  section: { color: "#334155", fontWeight: "800", marginTop: 8, marginBottom: 4 },
  row: { color: "#0F172A", fontWeight: "700", marginBottom: 4 },
});
