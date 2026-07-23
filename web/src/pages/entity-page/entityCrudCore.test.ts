import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser } from "../../types";
import {
  appendGenericDeleteAudit,
  appendGenericMutationAudit,
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
  it("génère un id préfixé", () => {
    expect(newEntityId("CLASSES")).toMatch(/^CLASSES-/);
  });

  it("prepareEntityRowForSave assigne un id à la création seulement", () => {
    const created = prepareEntityRowForSave({ name: "6ème B" }, "CLASSES", false);
    expect(String(created.id)).toMatch(/^CLASSES-/);
    expect(created.name).toBe("6ème B");

    const updated = prepareEntityRowForSave({ id: "c1", name: "6ème A" }, "CLASSES", true);
    expect(updated).toEqual({ id: "c1", name: "6ème A" });

    const withExistingId = prepareEntityRowForSave(
      { id: "preset", name: "X" },
      "CLASSES",
      false,
    );
    expect(withExistingId.id).toBe("preset");
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

  it("mergeEntityIntoState refuse hors périmètre et remplace dans le périmètre", () => {
    const state = baseState();
    const rejected = mergeEntityIntoState("classes", admin, state, {
      id: "c2",
      name: "Hijack",
      schoolCode: "SCH-999",
    });
    expect(rejected.applied).toBe(false);

    const applied = mergeEntityIntoState("classes", admin, state, {
      id: "c1",
      name: "6ème A bis",
      schoolCode: "SCH-001",
    });
    expect(applied.applied).toBe(true);
    expect(applied.rows.find((r) => r.id === "c1")?.name).toBe("6ème A bis");
  });

  it("deleteEntityFromState marque applied selon le scope", () => {
    const state = baseState();
    const ok = deleteEntityFromState("classes", admin, state, "c1");
    expect(ok.applied).toBe(true);
    expect(ok.rows.some((r) => r.id === "c1")).toBe(false);

    const denied = deleteEntityFromState("classes", admin, state, "c2");
    expect(denied.applied).toBe(false);
  });

  it("n’ajoute l’audit générique que pour les clés communes", () => {
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

    const deleteLog = appendGenericDeleteAudit(
      state.auditLog,
      "teachers",
      admin,
      { id: "t1", name: "Sow", firstName: "Ibra", schoolCode: "SCH-001" },
    );
    expect(deleteLog?.[0]?.action).toBe("teachers.delete");
    expect(deleteLog?.[0]?.entityLabel).toBe("Sow Ibra");
  });

  it("persistEntityPatch gère busy + toasts succès / échec", async () => {
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
