import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser } from "../../types";
import {
  appendGenericDeleteAudit,
  appendGenericMutationAudit,
  applyEntitySchoolScope,
  auditEntityLabel,
  deleteEntityFromState,
  ENTITY_DELETED_MESSAGE,
  ENTITY_OUT_OF_SCOPE_DELETE_MESSAGE,
  ENTITY_OUT_OF_SCOPE_SAVE_MESSAGE,
  ENTITY_SYNC_FAILURE_MESSAGE,
  entityMutationSuccessMessage,
  isAuditedEntityKey,
  mergeEntityIntoState,
  newEntityId,
  persistEntityPatch,
  prepareEntityRowForSave,
} from "./entityCrudCore";

const admin: SessionUser = {
  id: "u1",
  role: "Admin School",
  schoolCode: "SCH-001",
  name: "Admin",
} as unknown as SessionUser;

function baseState(
  overrides: Partial<BackOfficeState> = {},
): BackOfficeState {
  return {
    courses: [
      { id: "c1", name: "Maths", className: "6ème A", schoolCode: "SCH-001" },
      { id: "c2", name: "Autre", className: "5ème B", schoolCode: "SCH-999" },
    ],
    classes: [{ id: "cls1", name: "6ème A", schoolCode: "SCH-001" }],
    students: [],
    teachers: [],
    assignments: [],
    auditLog: [],
    users: [],
    ...overrides,
  } as unknown as BackOfficeState;
}

describe("entityCrudCore (D2.8c)", () => {
  it("création générique : id + merge sans écraser les autres établissements", () => {
    const state = baseState();
    const snapshot = structuredClone(state.courses);
    const prepared = prepareEntityRowForSave(
      { name: "Physique", className: "6ème A", schoolCode: "SCH-001" },
      "COURSES",
      false,
    );
    expect(String(prepared.id)).toMatch(/^COURSES-/);

    const result = mergeEntityIntoState("courses", admin, state, prepared);
    expect(result.applied).toBe(true);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.id === "c2")).toEqual({
      id: "c2",
      name: "Autre",
      className: "5ème B",
      schoolCode: "SCH-999",
    });
    expect(result.rows.some((r) => r.id === prepared.id)).toBe(true);
    expect(state.courses).toEqual(snapshot);
  });

  it("modification générique : remplace la ligne du périmètre seulement", () => {
    const state = baseState();
    const snapshot = structuredClone(state.courses);
    const prepared = prepareEntityRowForSave(
      { id: "c1", name: "Maths bis", className: "6ème A", schoolCode: "SCH-001" },
      "COURSES",
      true,
    );
    expect(prepared.id).toBe("c1");

    const result = mergeEntityIntoState("courses", admin, state, prepared);
    expect(result.applied).toBe(true);
    expect(result.rows.find((r) => r.id === "c1")?.name).toBe("Maths bis");
    expect(result.rows.find((r) => r.id === "c2")).toEqual(snapshot[1]);
    expect(state.courses).toEqual(snapshot);
  });

  it("suppression générique : retire la ligne scopée sans toucher les autres établissements", () => {
    const state = baseState();
    const snapshot = structuredClone(state.courses);
    const ok = deleteEntityFromState("courses", admin, state, "c1");
    expect(ok.applied).toBe(true);
    expect(ok.rows.map((r) => r.id)).toEqual(["c2"]);
    expect(state.courses).toEqual(snapshot);

    const denied = deleteEntityFromState("courses", admin, state, "c2");
    expect(denied.applied).toBe(false);
    expect(denied.rows).toHaveLength(2);
  });

  it("scope établissement : refuse la modification hors périmètre", () => {
    const state = baseState();
    const rejected = mergeEntityIntoState("courses", admin, state, {
      id: "c2",
      name: "Hijack",
      schoolCode: "SCH-999",
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.rows).toEqual(state.courses);
  });

  it("applique le schoolCode via applyEntitySchoolScope", () => {
    const state = baseState();
    const scoped = applyEntitySchoolScope(
      "courses",
      { name: "Nouvelle" },
      "SCH-001",
      state,
    );
    expect(scoped).toEqual({ name: "Nouvelle", schoolCode: "SCH-001" });
    expect(scoped).not.toBe(
      applyEntitySchoolScope("courses", { name: "Nouvelle" }, "SCH-001", state),
    );
  });

  it("génère un id préfixé", () => {
    expect(newEntityId("COURSES")).toMatch(/^COURSES-/);
  });

  it("prepareEntityRowForSave ne mute pas l’objet source", () => {
    const source = { name: "Histoire" };
    const created = prepareEntityRowForSave(source, "COURSES", false);
    expect(source).toEqual({ name: "Histoire" });
    expect(created).not.toBe(source);
    expect(String(created.id)).toMatch(/^COURSES-/);

    const existing = { id: "preset", name: "X" };
    const withExistingId = prepareEntityRowForSave(existing, "COURSES", false);
    expect(withExistingId.id).toBe("preset");
    expect(withExistingId).not.toBe(existing);
  });

  it("expose les libellés d’audit et les clés auditées", () => {
    // HOTFIX-RBAC-ADMIN-01 : classes/teachers/assignments hors audit client.
    expect(isAuditedEntityKey("students")).toBe(true);
    expect(isAuditedEntityKey("classes")).toBe(false);
    expect(isAuditedEntityKey("teachers")).toBe(false);
    expect(isAuditedEntityKey("contacts")).toBe(false);
    expect(auditEntityLabel("classes", { name: "6ème A" })).toBe("6ème A");
    expect(auditEntityLabel("students", { name: "Diallo", firstName: "Awa" })).toBe(
      "Diallo Awa",
    );
    expect(
      auditEntityLabel("assignments", {
        teacherName: "K.",
        subject: "Maths",
        className: "6ème A",
      }),
    ).toBe("K. · Maths · 6ème A");
  });

  it("audit générique : students uniquement · classes/teachers hors client (RBAC-ADMIN-01)", () => {
    const state = baseState();
    expect(
      appendGenericMutationAudit(state.auditLog, "contacts", admin, { id: "x" }, false),
    ).toBeUndefined();
    expect(
      appendGenericMutationAudit(
        state.auditLog,
        "classes",
        admin,
        { id: "c9", name: "5ème B", schoolCode: "SCH-001" },
        false,
      ),
    ).toBeUndefined();
    expect(
      appendGenericDeleteAudit(
        state.auditLog,
        "teachers",
        admin,
        { id: "t1", name: "Sow", firstName: "Ibra", schoolCode: "SCH-001" },
      ),
    ).toBeUndefined();

    const createLog = appendGenericMutationAudit(
      state.auditLog,
      "students",
      admin,
      { id: "s9", name: "Ada", schoolCode: "SCH-001" },
      false,
    );
    expect(createLog?.[0]?.action).toBe("students.create");
    expect(state.auditLog).toEqual([]);
  });

  it("erreur de persistance : toast d’échec + busy remis à false", async () => {
    const setBusy = vi.fn();
    const showToast = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);

    await persistEntityPatch(
      { update, showToast, setBusy },
      { courses: [] },
      entityMutationSuccessMessage("Matières", false),
    );
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(update).toHaveBeenCalledWith({ courses: [] }, { partial: true });
    expect(showToast).toHaveBeenCalledWith("Matières créé", "success");

    const failingUpdate = vi.fn().mockRejectedValue(new Error("network"));
    const setBusy2 = vi.fn();
    const showToast2 = vi.fn();
    await expect(
      persistEntityPatch(
        { update: failingUpdate, showToast: showToast2, setBusy: setBusy2 },
        { courses: [] },
        "ignored",
      ),
    ).rejects.toThrow("sync failed");
    expect(showToast2).toHaveBeenCalledWith(ENTITY_SYNC_FAILURE_MESSAGE, "error");
    expect(setBusy2).toHaveBeenLastCalledWith(false);
  });

  it("expose les messages transversaux stables", () => {
    expect(entityMutationSuccessMessage("Élèves", true)).toBe("Élèves modifié");
    expect(ENTITY_OUT_OF_SCOPE_SAVE_MESSAGE).toContain("hors périmètre");
    expect(ENTITY_OUT_OF_SCOPE_DELETE_MESSAGE).toContain("introuvable");
    expect(ENTITY_DELETED_MESSAGE).toBe("Élément supprimé");
  });
});
