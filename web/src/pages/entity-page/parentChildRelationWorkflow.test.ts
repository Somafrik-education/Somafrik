import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser } from "../../types";
import { RELATION_PARENT_CHILD } from "../../lib/relations";
import {
  addParentChildStudentId,
  applyParentContactChange,
  buildParentChildBundleDeletePlan,
  buildParentChildBundleSubmitPlan,
  buildRelationDeleteAuditEntry,
  buildRelationPostMergePlan,
  buildRelationPreSubmitPlan,
  defaultNewRelationDraft,
  filterAvailableParentStudentOptions,
  removeParentChildStudentId,
  resolveSelectedParentStudentIds,
  resolveSelectedParentStudentLabels,
} from "./parentChildRelationWorkflow";

const admin: SessionUser = {
  id: "u-admin",
  role: "Admin School",
  schoolCode: "SCH-001",
  identifier: "admin",
} as unknown as SessionUser;

function baseState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
  return {
    schools: [{ code: "SCH-001", name: "École" }],
    users: [
      {
        id: "user-parent-1",
        contactId: "parent-1",
        firstName: "Awa",
        lastName: "Diallo",
        role: "Parent",
        schoolCode: "SCH-001",
      },
    ],
    students: [
      { id: "stu-1", name: "Moussa", firstName: "Ba", schoolCode: "SCH-001" },
      { id: "stu-2", name: "Fatou", firstName: "Sow", schoolCode: "SCH-001" },
    ],
    relations: [
      {
        id: "rel-other",
        relationType: "Autre",
        fromContactId: "x",
        schoolCode: "SCH-001",
      },
      {
        id: "rel-pc-foreign",
        relationType: RELATION_PARENT_CHILD,
        fromContactId: "parent-foreign",
        toStudentId: "stu-x",
        schoolCode: "SCH-999",
      },
    ],
    auditLog: [],
    ...overrides,
  } as unknown as BackOfficeState;
}

describe("parentChildRelationWorkflow (D2.8d3)", () => {
  it("helpers formulaire draft / sélection élèves", () => {
    expect(defaultNewRelationDraft(true)).toEqual({
      relationType: RELATION_PARENT_CHILD,
      status: "Actif",
      isPrincipal: "Oui",
      toStudentIds: [],
    });
    expect(defaultNewRelationDraft(false).relationType).toBe("Parent → Élève");

    const editing = { toStudentIds: ["stu-1"] };
    expect(resolveSelectedParentStudentIds(editing)).toEqual(["stu-1"]);
    expect(
      filterAvailableParentStudentOptions(
        [
          { value: "stu-1", label: "A" },
          { value: "stu-2", label: "B" },
        ],
        ["stu-1"],
      ),
    ).toEqual([{ value: "stu-2", label: "B" }]);
    expect(
      resolveSelectedParentStudentLabels(["stu-1", "stu-9"], [
        { value: "stu-1", label: "Moussa" },
      ]),
    ).toEqual([
      { id: "stu-1", label: "Moussa" },
      { id: "stu-9", label: "stu-9" },
    ]);

    const withStudent = addParentChildStudentId({ toStudentIds: [] }, "stu-1");
    expect(withStudent.toStudentIds).toEqual(["stu-1"]);
    expect(removeParentChildStudentId(withStudent, "stu-1").toStudentIds).toEqual([]);
  });

  it("applyParentContactChange préfère les élèves déjà liés", () => {
    const state = baseState({
      relations: [
        {
          id: "r1",
          relationType: RELATION_PARENT_CHILD,
          fromContactId: "parent-1",
          toStudentId: "stu-2",
          schoolCode: "SCH-001",
        },
      ],
    });
    const next = applyParentContactChange(
      { toStudentIds: ["stu-1"] },
      "parent-1",
      state.relations as unknown as Record<string, unknown>[],
    );
    expect(next.fromContactId).toBe("parent-1");
    expect(next.toStudentIds).toEqual(["stu-2"]);
  });

  it("bundle submit refuse sans parent / sans élève", () => {
    const showToast = vi.fn();
    const missingParent = buildParentChildBundleSubmitPlan(
      {
        scopeUser: admin,
        state: baseState(),
        showToast,
        createRelationId: () => "REL-1",
      },
      {
        editing: { fromContactId: "", toStudentIds: ["stu-1"] },
        permissions: { canCreate: true, canUpdate: true },
      },
    );
    expect(missingParent.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Sélectionnez le parent.", "error");

    const missingStudents = buildParentChildBundleSubmitPlan(
      {
        scopeUser: admin,
        state: baseState(),
        showToast: vi.fn(),
        createRelationId: () => "REL-1",
      },
      {
        editing: { fromContactId: "parent-1", toStudentIds: [] },
        permissions: { canCreate: true, canUpdate: true },
      },
    );
    expect(missingStudents.ok).toBe(false);
  });

  it("bundle submit création : patch + audit entityId=fromContactId + pas de mutation source", () => {
    const state = baseState();
    const snapshot = structuredClone(state.relations);
    const plan = buildParentChildBundleSubmitPlan(
      {
        scopeUser: admin,
        state,
        showToast: vi.fn(),
        createRelationId: () => "REL-NEW",
      },
      {
        editing: {
          fromContactId: "parent-1",
          toStudentIds: ["stu-1", "stu-2"],
          isPrincipal: "Oui",
          status: "Actif",
          schoolCode: "SCH-001",
        },
        permissions: { canCreate: true, canUpdate: true },
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe("Parent lié à ses élèves");
    const audit = (plan.patch.auditLog as Array<{ action: string; entityId?: string; details?: string }>)[0];
    expect(audit.action).toBe("relation.create");
    expect(audit.entityId).toBe("parent-1");
    expect(audit.details).toContain("2 élève(s)");
    expect(
      (plan.patch.relations as unknown as Record<string, unknown>[]).some(
        (r) => r.id === "rel-other",
      ),
    ).toBe(true);
    expect(state.relations).toEqual(snapshot);
  });

  it("bundle submit update quand liaisons déjà présentes dans le scope", () => {
    const state = baseState({
      relations: [
        {
          id: "r1",
          relationType: RELATION_PARENT_CHILD,
          fromContactId: "parent-1",
          toStudentId: "stu-1",
          schoolCode: "SCH-001",
          isPrincipal: "Oui",
        },
      ] as unknown as BackOfficeState["relations"],
    });
    const plan = buildParentChildBundleSubmitPlan(
      {
        scopeUser: admin,
        state,
        showToast: vi.fn(),
        createRelationId: () => "REL-X",
      },
      {
        editing: {
          fromContactId: "parent-1",
          toStudentIds: ["stu-1", "stu-2"],
          isPrincipal: "Oui",
          status: "Actif",
        },
        permissions: { canCreate: true, canUpdate: true },
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe("Parent et élèves mis à jour");
    expect((plan.patch.auditLog as Array<{ action: string }>)[0]?.action).toBe("relation.update");
  });

  it("bundle submit refuse sans permission create", () => {
    const showToast = vi.fn();
    const plan = buildParentChildBundleSubmitPlan(
      {
        scopeUser: admin,
        state: baseState(),
        showToast,
        createRelationId: () => "REL-1",
      },
      {
        editing: {
          fromContactId: "parent-1",
          toStudentIds: ["stu-1"],
        },
        permissions: { canCreate: false, canUpdate: true },
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Création non autorisée pour votre rôle.", "error");
  });

  it("bundle delete : entityId=fromContactId, conserve les autres relations", () => {
    const state = baseState({
      relations: [
        {
          id: "r1",
          relationType: RELATION_PARENT_CHILD,
          fromContactId: "parent-1",
          toStudentId: "stu-1",
          schoolCode: "SCH-001",
        },
        {
          id: "r2",
          relationType: "Autre",
          fromContactId: "x",
          schoolCode: "SCH-001",
        },
      ],
    });
    const snapshot = structuredClone(state.relations);
    // Précondition documentée : scope/permissions/confirm restent dans EntityPage.
    // Ce plan ne refuse pas un appel sans gate — il construit uniquement le patch.
    const plan = buildParentChildBundleDeletePlan(
      { scopeUser: admin, state },
      {
        row: {
          fromContactId: "parent-1",
          fromContactName: "Awa Diallo",
          schoolCode: "SCH-001",
        },
      },
    );
    expect(plan.successMessage).toBe("Liaisons parent-enfant supprimées");
    expect((plan.patch.relations as unknown as Record<string, unknown>[]).map((r) => r.id)).toEqual([
      "r2",
    ]);
    const audit = (plan.patch.auditLog as Array<{ action: string; entityId?: string }>)[0];
    expect(audit.action).toBe("relation.delete");
    expect(audit.entityId).toBe("parent-1");
    expect(state.relations).toEqual(snapshot);
  });

  it("bundle delete n’embarque pas de contrôle de permission (gate EntityPage)", () => {
    const showToast = vi.fn();
    // Même sans canDelete, le plan produit un patch — la protection est hors module.
    const plan = buildParentChildBundleDeletePlan(
      {
        scopeUser: admin,
        state: baseState({
          relations: [
            {
              id: "r1",
              relationType: RELATION_PARENT_CHILD,
              fromContactId: "parent-1",
              toStudentId: "stu-1",
              schoolCode: "SCH-001",
            },
          ],
        }),
      },
      { row: { fromContactId: "parent-1", fromContactName: "Awa Diallo" } },
    );
    expect(plan.patch.relations).toBeDefined();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("relation unitaire pré-submit + post-merge + delete audit", () => {
    const showToast = vi.fn();
    const bad = buildRelationPreSubmitPlan(
      { state: baseState(), scopeUser: admin, showToast },
      { workingItem: { relationType: "", fromContactId: "" } },
    );
    expect(bad.ok).toBe(false);

    const ok = buildRelationPreSubmitPlan(
      { state: baseState(), scopeUser: admin, showToast: vi.fn() },
      {
        workingItem: {
          fromContactId: "parent-1",
          toStudentId: "stu-1",
          isPrincipal: "Oui",
        },
        forceParentChildType: true,
      },
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.workingItem.relationType).toBe(RELATION_PARENT_CHILD);

    const post = buildRelationPostMergePlan(
      { scopeUser: admin },
      {
        nextRelation: {
          id: "rel-1",
          relationType: RELATION_PARENT_CHILD,
          fromContactId: "parent-1",
          fromContactName: "Awa Diallo",
          toStudentId: "stu-1",
          isPrincipal: "Oui",
          schoolCode: "SCH-001",
        },
        nextAllRows: [
          {
            id: "rel-1",
            relationType: RELATION_PARENT_CHILD,
            fromContactId: "parent-1",
            toStudentId: "stu-1",
            isPrincipal: "Oui",
          },
          {
            id: "rel-2",
            relationType: RELATION_PARENT_CHILD,
            fromContactId: "parent-2",
            toStudentId: "stu-1",
            isPrincipal: "Oui",
          },
        ],
        baseRelations: [
          {
            id: "rel-1",
            relationType: RELATION_PARENT_CHILD,
            fromContactId: "parent-1",
            toStudentId: "stu-1",
            isPrincipal: "Oui",
          },
          {
            id: "rel-2",
            relationType: RELATION_PARENT_CHILD,
            fromContactId: "parent-2",
            toStudentId: "stu-1",
            isPrincipal: "Oui",
          },
        ],
        exists: false,
      },
    );
    expect(post.auditEntry.action).toBe("relation.create");
    expect(post.auditEntry.entityId).toBe("rel-1");
    expect(post.relations.find((r) => r.id === "rel-2")?.isPrincipal).toBe("Non");

    const del = buildRelationDeleteAuditEntry(admin, {
      id: "rel-1",
      relationType: RELATION_PARENT_CHILD,
      schoolCode: "SCH-001",
    });
    expect(del.action).toBe("relation.delete");
    expect(del.entityId).toBe("rel-1");
    expect(del.entityLabel).toBe(RELATION_PARENT_CHILD);
  });
});
