/**
 * LOT 8 — affichage snapshot uniquement. Aucun recalcul.
 */

export type SnapshotCell = {
  subject_id?: string;
  period_id?: string;
  score_component_id?: string;
  exposed?: unknown;
  kind?: string;
};

export type SnapshotSlot = {
  slot?: string;
  kind?: string;
  exposed?: unknown;
  passed?: boolean;
  section_id?: string;
};

export type SnapshotPresence = {
  section_id?: string;
  column_id?: string;
  row_id?: string;
  field_kind?: string;
  field_id?: string;
  applicable?: boolean;
};

export type SnapshotStudent = {
  student_id?: string;
  cells?: SnapshotCell[];
  slots?: SnapshotSlot[];
  presence?: SnapshotPresence[];
};

export type SnapshotPayload = {
  report_card_id?: string;
  published_snapshot_version?: number;
  published_at?: string;
  students?: SnapshotStudent[];
};

export type RenderingSection = {
  id: string;
  label?: string;
  source: "cells" | "slots" | "presence";
};

export type RenderingTemplate = {
  paper?: string;
  orientation?: string;
  qr_required?: boolean;
  sections?: RenderingSection[];
};

export const SNAPSHOT_SLOT_TOTAL = "TOTAL";
export const SNAPSHOT_SLOT_PERCENTAGE = "PERCENTAGE";
export const SNAPSHOT_SLOT_RANK = "RANK";
export const SNAPSHOT_SLOT_DECISION = "DECISION";

export function cellLabel(cell: SnapshotCell) {
  if (cell.exposed != null) return String(cell.exposed);
  if (cell.kind === "NOT_APPLICABLE") return "N/A";
  return cell.kind == null ? "" : String(cell.kind);
}

export function slotLabel(slot: SnapshotSlot) {
  if (slot.slot === "DECISION" || slot.kind === "DECISION") {
    const decision = slot.passed === true ? "PASS" : slot.passed === false ? "FAIL" : "";
    const metric = slot.exposed != null ? String(slot.exposed) : "";
    return [metric, decision].filter(Boolean).join(" ");
  }
  return cellLabel(slot);
}

export function presenceLabel(entry: SnapshotPresence) {
  return [entry.section_id, entry.column_id, entry.row_id, entry.field_kind, entry.field_id]
    .filter((part) => part != null && part !== "")
    .join(" ");
}

export function matchingSlots(student: SnapshotStudent, sectionId: string) {
  const slots = student.slots || [];
  const filtered = slots.filter((slot) => slot.section_id === sectionId);
  return filtered.length ? filtered : slots;
}

export function matchingPresence(student: SnapshotStudent, sectionId: string) {
  const presence = student.presence || [];
  const filtered = presence.filter((entry) => entry.section_id === sectionId);
  return filtered.length ? filtered : presence;
}

export function exposedSlot(student: SnapshotStudent, slotName: string) {
  const slot = (student.slots || []).find((item) => item.slot === slotName);
  if (!slot) return "";
  return slotLabel(slot);
}

export function studentDisplayName(student: SnapshotStudent) {
  const identity = (student.cells || []).find((cell) => cell.kind === "identity");
  if (identity?.exposed != null && String(identity.exposed).trim()) return String(identity.exposed);
  return String(student.student_id || "");
}

export function studentPeriodLabel(student: SnapshotStudent) {
  const periods = [...new Set((student.cells || []).map((cell) => cell.period_id).filter(Boolean))];
  return periods.join(" · ");
}

export function formatStudentSnapshot(student: SnapshotStudent, template?: RenderingTemplate | null) {
  const blocks: string[] = [String(student.student_id || "")];
  const sections = template?.sections;
  if (sections && sections.length) {
    for (const section of sections) {
      blocks.push(section.label || section.id);
      if (section.source === "cells") {
        for (const cell of student.cells || []) {
          blocks.push(
            [cell.subject_id, cell.period_id, cell.score_component_id, cellLabel(cell)].filter(Boolean).join(" "),
          );
        }
      } else if (section.source === "slots") {
        for (const slot of matchingSlots(student, section.id)) {
          blocks.push([slot.slot, slotLabel(slot)].filter(Boolean).join(" "));
        }
      } else {
        for (const entry of matchingPresence(student, section.id)) {
          blocks.push(presenceLabel(entry));
        }
      }
    }
    return blocks.join("\n");
  }
  for (const cell of student.cells || []) {
    blocks.push([cell.subject_id, cell.period_id, cell.score_component_id, cellLabel(cell)].filter(Boolean).join(" "));
  }
  for (const slot of student.slots || []) {
    blocks.push([slot.slot, slotLabel(slot)].filter(Boolean).join(" "));
  }
  for (const entry of student.presence || []) {
    blocks.push(presenceLabel(entry));
  }
  return blocks.join("\n");
}
