import type { ReactNode } from "react";

type SnapshotCell = {
  subject_id?: string;
  period_id?: string;
  score_component_id?: string;
  exposed?: unknown;
  kind?: string;
};

type SnapshotSlot = {
  slot?: string;
  kind?: string;
  exposed?: unknown;
  passed?: boolean;
  section_id?: string;
};

type SnapshotPresence = {
  section_id?: string;
  column_id?: string;
  row_id?: string;
  field_kind?: string;
  field_id?: string;
  applicable?: boolean;
};

type SnapshotStudent = {
  student_id?: string;
  cells?: SnapshotCell[];
  slots?: SnapshotSlot[];
  presence?: SnapshotPresence[];
};

type RenderingSection = {
  id: string;
  label?: string;
  source: "cells" | "slots" | "presence";
};

type RenderingTemplate = {
  paper?: string;
  orientation?: string;
  qr_required?: boolean;
  sections?: RenderingSection[];
};

export function ReportCardTemplatePreview({
  template,
}: {
  template: RenderingTemplate | null | undefined;
}) {
  if (!template) return null;
  return (
    <article data-template-preview>
      <p>
        {template.paper || "A4"} {template.orientation || "portrait"}{" "}
        {template.qr_required ? "QR requis" : ""}
      </p>
      <ol>
        {(template.sections || []).map((section) => (
          <li key={section.id} data-template-section={section.id} data-source={section.source}>
            {section.label || section.id} ({section.source})
          </li>
        ))}
      </ol>
    </article>
  );
}

type SnapshotPayload = {
  report_card_id?: string;
  published_snapshot_version?: number;
  published_at?: string;
  students?: SnapshotStudent[];
};

function cellLabel(cell: SnapshotCell) {
  if (cell.exposed != null) return String(cell.exposed);
  if (cell.kind === "NOT_APPLICABLE") return "N/A";
  return cell.kind == null ? "" : String(cell.kind);
}

function slotLabel(slot: SnapshotSlot) {
  if (slot.slot === "DECISION" || slot.kind === "DECISION") {
    const decision = slot.passed === true ? "PASS" : slot.passed === false ? "FAIL" : "";
    const metric = slot.exposed != null ? String(slot.exposed) : "";
    return [metric, decision].filter(Boolean).join(" ");
  }
  return cellLabel(slot);
}

function presenceLabel(entry: SnapshotPresence) {
  return [entry.section_id, entry.column_id, entry.row_id, entry.field_kind, entry.field_id]
    .filter((part) => part != null && part !== "")
    .join(" ");
}

function matchingSlots(student: SnapshotStudent, sectionId: string) {
  const slots = student.slots || [];
  const filtered = slots.filter((slot) => slot.section_id === sectionId);
  return filtered.length ? filtered : slots;
}

function matchingPresence(student: SnapshotStudent, sectionId: string) {
  const presence = student.presence || [];
  const filtered = presence.filter((entry) => entry.section_id === sectionId);
  return filtered.length ? filtered : presence;
}

function CellsTable({ student }: { student: SnapshotStudent }) {
  return (
    <table className="cells" data-cells>
      <thead>
        <tr>
          <th>subject</th>
          <th>period</th>
          <th>component</th>
          <th>value</th>
        </tr>
      </thead>
      <tbody>
        {(student.cells || []).map((cell, index) => (
          <tr key={`${cell.subject_id}-${cell.period_id}-${cell.score_component_id}-${index}`}>
            <td>{cell.subject_id}</td>
            <td>{cell.period_id}</td>
            <td>{cell.score_component_id}</td>
            <td>{cellLabel(cell)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SlotsTable({ slots }: { slots: SnapshotSlot[] }) {
  return (
    <table className="slots" data-slots>
      <thead>
        <tr>
          <th>slot</th>
          <th>value</th>
        </tr>
      </thead>
      <tbody>
        {slots.map((slot, index) => (
          <tr key={`${slot.slot}-${index}`} data-slot={slot.slot} data-section={slot.section_id}>
            <td>{slot.slot}</td>
            <td>{slotLabel(slot)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PresenceList({ presence }: { presence: SnapshotPresence[] }) {
  return (
    <ul className="presence">
      {presence.map((entry, index) => (
        <li
          key={`${entry.section_id}-${entry.column_id}-${entry.row_id}-${index}`}
          data-presence
          data-section={entry.section_id}
          data-column={entry.column_id}
          data-row={entry.row_id}
          data-applicable={entry.applicable === true ? "true" : "false"}
        >
          {presenceLabel(entry)}
        </li>
      ))}
    </ul>
  );
}

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function StudentView({ student, template }: { student: SnapshotStudent; template?: RenderingTemplate | null }) {
  const sections = template?.sections;
  if (sections && sections.length) {
    return (
      <section>
        <h2>{student.student_id}</h2>
        {sections.map((section) => {
          if (section.source === "cells") {
            return (
              <SectionBlock key={section.id} title={section.label || section.id}>
                <CellsTable student={student} />
              </SectionBlock>
            );
          }
          if (section.source === "slots") {
            return (
              <SectionBlock key={section.id} title={section.label || section.id}>
                <SlotsTable slots={matchingSlots(student, section.id)} />
              </SectionBlock>
            );
          }
          return (
            <SectionBlock key={section.id} title={section.label || section.id}>
              <PresenceList presence={matchingPresence(student, section.id)} />
            </SectionBlock>
          );
        })}
      </section>
    );
  }
  return (
    <section>
      <h2>{student.student_id}</h2>
      <CellsTable student={student} />
      <SlotsTable slots={student.slots || []} />
      <PresenceList presence={student.presence || []} />
    </section>
  );
}

export function ReportCardSnapshotView({
  payload,
  template,
}: {
  payload: SnapshotPayload | null | undefined;
  template?: RenderingTemplate | null;
}) {
  if (!payload) return null;
  const students = Array.isArray(payload.students) ? payload.students : [];
  return (
    <article data-report-card-snapshot>
      <p>
        Bulletin {payload.report_card_id} · v{payload.published_snapshot_version}
      </p>
      {students.map((student) => (
        <StudentView key={student.student_id} student={student} template={template} />
      ))}
    </article>
  );
}
