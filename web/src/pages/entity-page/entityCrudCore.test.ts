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
    classes: [
      { id: "c1", name: "6ème A", schoolCode: "SCH-001" },
      { id: "c2", name: "Autre", schoolCode: "SCH-999" },
    ],
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
    const snapshot = structuredClone(state.classes);
    const prepared = prepareEntityRowForSave(
      { name: "5ème B", schoolCode: "SCH-001" },
      "CLASSES",
      false,
    );
    expect(String(prepared.id)).toMatch(/^CLASSES-/);

    const result = mergeEntityIntoState("classes", admin, state, prepared);
    expect(result.applied).toBe(true);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.id === "c2")).toEqual({
      id: "c2",
      name: "Autre",
      schoolCode: "SCH-999",
    });
    expect(result.rows.some((r) => r.id === prepared.id)).toBe(true);
    // Pas de mutation de l’état source
    expect(state.classes).toEqual(snapshot);
  });

  it("modification générique : remplace la ligne du périmètre seulement", () => {
    const state = baseState();
    const snapshot = structuredClone(state.classes);
    const prepared = prepareEntityRowForSave(
      { id: "c1", name: "6ème A bis", schoolCode: "SCH-001" },
      "CLASSES",
      true,
    );
    expect(prepared.id).toBe("c1");

    const result = mergeEntityIntoState("classes", admin, state, prepared);
    expect(result.applied).toBe(true);
    expect(result.rows.find((r) => r.id === "c1")?.name).toBe("6ème A bis");
    expect(result.rows.find((r) => r.id === "c2")).toEqual(snapshot[1]);
    expect(state.classes).toEqual(snapshot);
  });

  it("suppression générique : retire la ligne scopée sans toucher les autres établissements", () => {
    const state = baseState();
    const snapshot = structuredClone(state.classes);
    const ok = deleteEntityFromState("classes", admin, state, "c1");
    expect(ok.applied).toBe(true);
    expect(ok.rows.map((r) => r.id)).toEqual(["c2"]);
    expect(state.classes).toEqual(snapshot);

    const denied = deleteEntityFromState("classes", admin, state, "c2");
    expect(denied.applied).toBe(false);
    expect(denied.rows).toHaveLength(2);
  });

  it("scope établissement : refuse la modification hors périmètre", () => {
    const state = baseState();
    const rejected = mergeEntityIntoState("classes", admin, state, {
      id: "c2",
      name: "Hijack",
      schoolCode: "SCH-999",
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.rows).toEqual(state.classes);
  });

  it("applique le schoolCode via applyEntitySchoolScope", () => {
    const state = baseState();
    const scoped = applyEntitySchoolScope(
      "classes",
      { name: "Nouvelle" },
      "SCH-001",
      state,
    );
    expect(scoped).toEqual({ name: "Nouvelle", schoolCode: "SCH-001" });
    expect(scoped).not.toBe(
      applyEntitySchoolScope("classes", { name: "Nouvelle" }, "SCH-001", state),
    );
  });

  it("génère un id préfixé", () => {
    expect(newEntityId("CLASSES")).toMatch(/^CLASSES-/);
  });

  it("prepareEntityRowForSave ne mute pas l’objet source", () => {
    const source = { name: "6ème B" };
    const created = prepareEntityRowForSave(source, "CLASSES", false);
    expect(source).toEqual({ name: "6ème B" });
    expect(created).not.toBe(source);
    expect(String(created.id)).toMatch(/^CLASSES-/);

    const existing = { id: "preset", name: "X" };
    const withExistingId = prepareEntityRowForSave(existing, "CLASSES", false);
    expect(withExistingId.id).toBe("preset");
    expect(withExistingId).not.toBe(existing);
  });

  it("expose les libellés d’audit et les clés auditées", () => {
    expect(isAuditedEntityKey("classes")).toBe(true);
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

  it("audit générique create / update / delete + ignore hors clés communes", () => {
    const state = baseState();
    expect(
      appendGenericMutationAudit(state.auditLog, "contacts", admin, { id: "x" }, false),
    ).toBeUndefined();

    const createLog = appendGenericMutationAudit(
      state.auditLog,
      "classes",
      admin,
      { id: "c9", name: "5ème B", schoolCode: "SCH-001" },
      false,
    );
    expect(createLog?.[0]?.action).toBe("classes.create");
    expect(createLog?.[0]?.entityLabel).toBe("5ème B");

    const updateLog = appendGenericMutationAudit(
      state.auditLog,
      "classes",
      admin,
      { id: "c1", name: "6ème A", schoolCode: "SCH-001" },
      true,
    );
    expect(updateLog?.[0]?.action).toBe("classes.update");

    const deleteLog = appendGenericDeleteAudit(
      state.auditLog,
      "teachers",
      admin,
      { id: "t1", name: "Sow", firstName: "Ibra", schoolCode: "SCH-001" },
    );
    expect(deleteLog?.[0]?.action).toBe("teachers.delete");
    expect(deleteLog?.[0]?.entityLabel).toBe("Sow Ibra");
    expect(state.auditLog).toEqual([]);
  });

  it("erreur de persistance : toast d’échec + busy remis à false", async () => {
    const setBusy = vi.fn();
    const showToast = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);

    await persistEntityPatch(
      { update, showToast, setBusy },
      { classes: [] },
      entityMutationSuccessMessage("Classes", false),
    );
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(update).toHaveBeenCalledWith({ classes: [] }, { partial: true });
    expect(showToast).toHaveBeenCalledWith("Classes créé", "success");

    const failingUpdate = vi.fn().mockRejectedValue(new Error("network"));
    const setBusy2 = vi.fn();
    const showToast2 = vi.fn();
    await expect(
      persistEntityPatch(
        { update: failingUpdate, showToast: showToast2, setBusy: setBusy2 },
        { classes: [] },
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
