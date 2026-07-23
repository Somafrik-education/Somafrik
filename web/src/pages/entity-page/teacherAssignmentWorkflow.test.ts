import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser } from "../../types";
import {
  buildTeacherAssignmentDeleteConfirmCopy,
  buildTeacherAssignmentDeletePlan,
  buildTeacherAssignmentSubmitPlan,
  emptyEditingAssignment,
  reapplyAssignmentPeriodRoom,
  resolveLinkedTeacher,
  type TeacherAssignmentWorkflowDeps,
} from "./teacherAssignmentWorkflow";

const admin: SessionUser = {
  id: "u1",
  role: "Admin School",
  schoolCode: "SCH-001",
  name: "Admin",
} as unknown as SessionUser;

function baseState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
  return {
    schools: [{ code: "SCH-001", name: "École" }],
    classes: [{ id: "c1", name: "6ème A", schoolCode: "SCH-001", status: "Active" }],
    teachers: [
      {
        id: "t1",
        name: "Sow",
        firstName: "Ibra",
        schoolCode: "SCH-001",
        publicId: "PUB-T1",
      },
      {
        id: "t-other",
        name: "Autre",
        firstName: "École",
        schoolCode: "SCH-999",
      },
    ],
    courses: [{ id: "co1", name: "Maths", className: "6ème A", schoolCode: "SCH-001" }],
    assignments: [
      {
        id: "a1",
        teacherId: "t1",
        teacherName: "Sow Ibra",
        className: "6ème A",
        subject: "Maths",
        course: "Maths",
        schoolCode: "SCH-001",
        period: "T1",
        room: "S1",
      },
      {
        id: "a-foreign",
        teacherId: "t-other",
        className: "5ème B",
        subject: "Français",
        schoolCode: "SCH-999",
      },
    ],
    students: [],
    users: [],
    auditLog: [],
    academicConfigs: {
      "SCH-001": {
        classNames: ["6ème A"],
        subjects: ["Maths", "Français"],
        subjectsByClass: { "6ème A": ["Maths", "Français"] },
      },
    },
    ...overrides,
  } as unknown as BackOfficeState;
}

function deps(
  state: BackOfficeState,
  showToast = vi.fn(),
): TeacherAssignmentWorkflowDeps {
  return {
    scopeUser: admin,
    state,
    effectiveSchoolCode: "SCH-001",
    showToast,
    buildPedagogyPatch: (_key, _item, nextRows) => ({
      assignments: nextRows as BackOfficeState["assignments"],
      courses: state.courses,
      teachers: state.teachers,
    }),
  };
}

const fields = [
  { key: "className", label: "Classe", required: true },
  { key: "subject", label: "Matière", required: true },
];

describe("teacherAssignmentWorkflow (D2.8d1)", () => {
  it("emptyEditingAssignment et reapplyAssignmentPeriodRoom", () => {
    expect(emptyEditingAssignment("t1")).toEqual({
      teacherId: "t1",
      className: "",
      subject: "",
    });
    const rows = [
      { id: "a1", period: "old", room: "old" },
      { id: "a2", period: "keep", room: "keep" },
    ];
    expect(reapplyAssignmentPeriodRoom(rows, "a1", "T2", "S9")).toEqual([
      { id: "a1", period: "T2", room: "S9" },
      { id: "a2", period: "keep", room: "keep" },
    ]);
    expect(rows[0]).toEqual({ id: "a1", period: "old", room: "old" });
  });

  it("resolveLinkedTeacher trouve par id secondaire", () => {
    const teachers = [
      { id: "t1", publicId: "PUB-T1", name: "Sow" },
      { id: "t2", name: "Autre" },
    ];
    expect(resolveLinkedTeacher(teachers, { id: "PUB-T1" }).id).toBe("t1");
    expect(resolveLinkedTeacher(teachers, { id: "missing", name: "Ctx" })).toEqual({
      id: "missing",
      name: "Ctx",
    });
  });

  it("submit refuse champ obligatoire manquant", () => {
    const state = baseState();
    const showToast = vi.fn();
    const plan = buildTeacherAssignmentSubmitPlan(deps(state, showToast), {
      editingAssignment: { teacherId: "t1", className: "", subject: "" },
      teacherAssignmentContext: { id: "t1", name: "Sow", firstName: "Ibra" },
      assignmentFields: fields,
      scopedAssignments: state.assignments as Record<string, unknown>[],
      permissions: { canCreate: true, canUpdate: true },
    });
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Classe est obligatoire", "error");
  });

  it("submit refuse sans permission create", () => {
    const state = baseState();
    const showToast = vi.fn();
    const plan = buildTeacherAssignmentSubmitPlan(deps(state, showToast), {
      editingAssignment: {
        teacherId: "t1",
        className: "6ème A",
        subject: "Français",
      },
      teacherAssignmentContext: { id: "t1" },
      assignmentFields: fields,
      scopedAssignments: state.assignments as Record<string, unknown>[],
      permissions: { canCreate: false, canUpdate: true },
    });
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Création d'affectation non autorisée pour votre rôle.",
      "error",
    );
  });

  it("création générique : patch + audit + AFF-001 + pas de mutation source", () => {
    const state = baseState();
    const snapshot = structuredClone(state.assignments);
    const showToast = vi.fn();
    const plan = buildTeacherAssignmentSubmitPlan(
      {
        ...deps(state, showToast),
        buildPedagogyPatch: (_key, item, nextRows) => ({
          // Simule une synchro qui efface period/room
          assignments: nextRows.map((row) =>
            String(row.id) === String(item.id)
              ? { ...row, period: "", room: "" }
              : row,
          ) as BackOfficeState["assignments"],
          courses: state.courses,
          teachers: state.teachers,
        }),
      },
      {
        editingAssignment: {
          teacherId: "t1",
          className: "6ème A",
          subject: "Français",
          period: "T2",
          room: "S2",
        },
        teacherAssignmentContext: { id: "t1", name: "Sow", firstName: "Ibra" },
        assignmentFields: fields,
        scopedAssignments: state.assignments as Record<string, unknown>[],
        permissions: { canCreate: true, canUpdate: true },
      },
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe("Affectation créée");
    expect(plan.resetEditingAssignment).toEqual(emptyEditingAssignment("t1"));
    expect(plan.refreshTeacherContext.id).toBe("t1");
    expect((plan.patch.auditLog as Array<{ action: string }> | undefined)?.[0]?.action).toBe(
      "assignments.create",
    );

    const created = (plan.patch.assignments as Record<string, unknown>[]).find(
      (row) => String(row.subject) === "Français",
    );
    expect(created?.period).toBe("T2");
    expect(created?.room).toBe("S2");
    expect(
      (plan.patch.assignments as Record<string, unknown>[]).some(
        (row) => row.id === "a-foreign",
      ),
    ).toBe(true);
    expect(state.assignments).toEqual(snapshot);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("modification générique : audit update", () => {
    const state = baseState();
    const plan = buildTeacherAssignmentSubmitPlan(deps(state), {
      editingAssignment: {
        id: "a1",
        teacherId: "t1",
        className: "6ème A",
        subject: "Maths",
        period: "T3",
        room: "S3",
      },
      teacherAssignmentContext: { id: "t1" },
      assignmentFields: fields,
      scopedAssignments: state.assignments as Record<string, unknown>[],
      permissions: { canCreate: true, canUpdate: true },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe("Affectation modifiée");
    expect((plan.patch.auditLog as Array<{ action: string }> | undefined)?.[0]?.action).toBe(
      "assignments.update",
    );
  });

  it("delete confirm copy inclut classe et matière", () => {
    expect(
      buildTeacherAssignmentDeleteConfirmCopy({
        className: "6ème A",
        subject: "Maths",
      }).description,
    ).toContain("Maths");
    expect(
      buildTeacherAssignmentDeleteConfirmCopy({ id: "x" }).description,
    ).toContain("enseignant ↔ classe ↔ matière");
  });

  it("delete refuse hors périmètre", () => {
    const state = baseState();
    const showToast = vi.fn();
    const plan = buildTeacherAssignmentDeletePlan(deps(state, showToast), {
      assignment: { id: "a-foreign", schoolCode: "SCH-999" },
      teacherAssignmentContext: { id: "t1" },
      permissions: { canUpdate: true, canDelete: true },
    });
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Suppression refusée : affectation hors périmètre ou introuvable.",
      "error",
    );
  });

  it("delete happy path : conserve rows post-delete + embed teacher + audit", () => {
    const state = baseState();
    const snapshot = structuredClone(state.assignments);
    const plan = buildTeacherAssignmentDeletePlan(deps(state), {
      assignment: {
        id: "a1",
        teacherId: "t1",
        teacherName: "Sow Ibra",
        className: "6ème A",
        subject: "Maths",
        schoolCode: "SCH-001",
      },
      teacherAssignmentContext: { id: "t1", name: "Sow", firstName: "Ibra" },
      permissions: { canUpdate: true, canDelete: false },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe("Affectation retirée");
    expect(plan.clearEditingIfId).toBe("a1");
    expect((plan.patch.auditLog as Array<{ action: string }> | undefined)?.[0]?.action).toBe(
      "assignments.delete",
    );
    expect((plan.patch.assignments as unknown[]).map((r) => (r as { id: string }).id)).toEqual([
      "a-foreign",
    ]);
    const teacher = (plan.patch.teachers as Record<string, unknown>[]).find(
      (row) => row.id === "t1",
    );
    expect(teacher?.assignments).toEqual([]);
    expect(state.assignments).toEqual(snapshot);
  });

  it("delete sans contexte enseignant n’écrit pas teachers", () => {
    const state = baseState();
    const plan = buildTeacherAssignmentDeletePlan(deps(state), {
      assignment: {
        id: "a1",
        teacherId: "t1",
        className: "6ème A",
        subject: "Maths",
        schoolCode: "SCH-001",
      },
      teacherAssignmentContext: null,
      permissions: { canUpdate: true, canDelete: true },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.patch.teachers).toBeUndefined();
  });
});
