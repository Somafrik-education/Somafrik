/**
 * P1 parité Web/Mobile — gestion multi-rôles utilisateurs.
 *
 *   npx --yes tsx --test Mobile/src/lib/userRoleAssignment.test.ts
 *
 * Le catalogue n'est pas une enum UI. Les mutations passent par grant/revoke génériques.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { formatAccessRolesDisplay, STUDENT_ROLE_LOCKED_MESSAGE, STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE } from "./businessProfile";
import {
  alignRolesToCatalogue,
  applyUserRoleAssignment,
  createSingleFlight,
  currentAccessRoleLabels,
  diffRoleAssignment,
  saveUserRoleChanges,
  visibleAssignableRoles,
  type EstablishmentRoleCatalogueEntry,
} from "./userRoleAssignment";

const ROOT = path.resolve(__dirname, "../..");

function source(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const catalogue: EstablishmentRoleCatalogueEntry[] = [
  { id: "1", roleCode: "TEACHER", roleName: "Enseignant", permissions: ["Notes:READ"] },
  { id: "2", roleCode: "ACCOUNTANT", roleName: "Comptable", permissions: ["Paiements:READ"] },
  { id: "3", roleCode: "SECRETARY", roleName: "Secrétaire", permissions: [] },
  { id: "4", roleCode: "SUPERVISOR", roleName: "Surveillant", permissions: [] },
  { id: "5", roleCode: "PARENT", roleName: "Parent", permissions: ["Messages:READ"] },
  { id: "6", roleCode: "STUDENT", roleName: "Élève / Étudiant", permissions: [] },
  { id: "7", roleCode: "ELEVE_ETUDIANT", roleName: "Élève / Etudiant", permissions: [] },
];

const staff = {
  id: "user-1",
  accountKind: "staff",
  role: "Secrétaire",
  roles: ["Secrétaire"],
  activeRoles: ["Secrétaire"],
};

function callsOf() {
  const grants: string[] = [];
  const revokes: string[] = [];
  const order: string[] = [];
  return {
    grants,
    revokes,
    order,
    grant: async (_userId: string, role: string) => {
      grants.push(role);
      order.push(`grant:${role}`);
    },
    revoke: async (_userId: string, role: string) => {
      revokes.push(role);
      order.push(`revoke:${role}`);
    },
  };
}

describe("catalogue établissement", () => {
  it("plusieurs rôles du catalogue sont proposés, Parent et Élève exclus", () => {
    const visible = visibleAssignableRoles(catalogue);
    assert.deepEqual(
      visible.map((role) => role.roleName),
      ["Enseignant", "Comptable", "Secrétaire", "Surveillant"],
    );
    assert.equal(visible.length > 1, true);
    assert.equal(visible.some((role) => role.roleName === "Parent"), false);
    assert.equal(visible.some((role) => role.roleName.includes("Élève") || role.roleName.includes("Eleve")), false);
    for (const choice of visible) {
      assert.equal("permissions" in choice, false);
    }
  });
});

describe("pré-sélection et diff", () => {
  const choices = visibleAssignableRoles(catalogue);

  it("les rôles actuels sont pré-cochés, y compris via la clé backend", () => {
    const labels = currentAccessRoleLabels({
      roles: ["Enseignant", "Comptable"],
      activeRoles: ["Enseignant", "Comptable"],
    });
    assert.deepEqual(alignRolesToCatalogue(labels, choices), ["Enseignant", "Comptable"]);
    assert.deepEqual(alignRolesToCatalogue(["TEACHER", "ACCOUNTANT"], choices), ["Enseignant", "Comptable"]);
  });

  it("un utilisateur à plusieurs rôles reste éditable sans appel inutile", () => {
    const current = alignRolesToCatalogue(["Enseignant", "Comptable"], choices);
    const diff = diffRoleAssignment(current, current);
    assert.deepEqual(diff.toGrant, []);
    assert.deepEqual(diff.toRevoke, []);
    assert.deepEqual(diff.unchanged, ["Enseignant", "Comptable"]);
  });

  it("ajout et retrait dans la même validation produisent le diff, sans toucher l'inchangé", () => {
    const diff = diffRoleAssignment(["Enseignant", "Secrétaire"], ["Enseignant", "Comptable"]);
    assert.deepEqual(diff.toGrant, ["Comptable"]);
    assert.deepEqual(diff.toRevoke, ["Secrétaire"]);
    assert.deepEqual(diff.unchanged, ["Enseignant"]);
  });
});

describe("mutations canoniques", () => {
  const choices = visibleAssignableRoles(catalogue);

  it("l'ajout appelle grantClientsUserRole avec le libellé du catalogue", async () => {
    const api = callsOf();
    const current = alignRolesToCatalogue(currentAccessRoleLabels(staff), choices);
    const selected = [...current, "Comptable"];
    const diff = await applyUserRoleAssignment({
      user: staff,
      userId: staff.id,
      currentRoles: current,
      selectedRoles: selected,
      grant: api.grant,
      revoke: api.revoke,
    });
    assert.deepEqual(diff.toGrant, ["Comptable"]);
    assert.deepEqual(api.grants, ["Comptable"]);
    assert.deepEqual(api.revokes, []);
  });

  it("le retrait appelle revokeClientsUserRole", async () => {
    const api = callsOf();
    await applyUserRoleAssignment({
      user: { ...staff, roles: ["Secrétaire", "Surveillant"], activeRoles: ["Secrétaire", "Surveillant"] },
      userId: staff.id,
      currentRoles: ["Secrétaire", "Surveillant"],
      selectedRoles: ["Secrétaire"],
      grant: api.grant,
      revoke: api.revoke,
    });
    assert.deepEqual(api.revokes, ["Surveillant"]);
    assert.deepEqual(api.grants, []);
  });

  it("ajout et retrait appellent les deux mutations dans cet ordre, pas le rôle inchangé", async () => {
    const api = callsOf();
    await applyUserRoleAssignment({
      user: staff,
      userId: staff.id,
      currentRoles: ["Enseignant", "Secrétaire"],
      selectedRoles: ["Enseignant", "Comptable"],
      grant: api.grant,
      revoke: api.revoke,
    });
    assert.deepEqual(api.order, ["grant:Comptable", "revoke:Secrétaire"]);
    assert.equal(api.order.some((entry) => entry.endsWith("Enseignant")), false);
  });

  it("aucun appel pour un rôle inchangé", async () => {
    const api = callsOf();
    const diff = await applyUserRoleAssignment({
      user: { ...staff, roles: ["Enseignant", "Comptable"] },
      userId: staff.id,
      currentRoles: ["Enseignant", "Comptable"],
      selectedRoles: ["Enseignant", "Comptable"],
      grant: api.grant,
      revoke: api.revoke,
    });
    assert.deepEqual(diff.unchanged, ["Enseignant", "Comptable"]);
    assert.deepEqual(api.grants, []);
    assert.deepEqual(api.revokes, []);
  });
});

describe("verrou élève et conflit Enseignant", () => {
  const linked = {
    id: "student-user",
    accountKind: "student_login",
    linkedStudent: { studentId: "stu-1", studentCode: "CD-IN-61-26-00017" },
    roles: [] as string[],
    activeRoles: [] as string[],
  };

  it("un compte lié à un élève ne peut pas modifier ses rôles", async () => {
    const api = callsOf();
    await assert.rejects(
      () =>
        applyUserRoleAssignment({
          user: linked,
          userId: linked.id,
          currentRoles: [],
          selectedRoles: ["Secrétaire"],
          grant: api.grant,
          revoke: api.revoke,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, STUDENT_ROLE_LOCKED_MESSAGE);
        return true;
      },
    );
    assert.deepEqual(api.grants, []);
    assert.deepEqual(api.revokes, []);
  });

  it("le rôle Enseignant reste incompatible avec un compte lié à un élève", async () => {
    const api = callsOf();
    await assert.rejects(
      () =>
        applyUserRoleAssignment({
          user: linked,
          userId: linked.id,
          currentRoles: [],
          selectedRoles: ["Enseignant"],
          grant: api.grant,
          revoke: api.revoke,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE);
        return true;
      },
    );
    assert.deepEqual(api.grants, []);
  });
});

describe("erreurs API et rechargement", () => {
  it("403/409 n'est pas un succès local et n'enchaîne pas le retrait", async () => {
    let localSuccess = false;
    const grants: string[] = [];
    const revokes: string[] = [];
    let reloaded = 0;
    const denied = new Error("Attribution refusée par la politique de l'établissement.");
    (denied as Error & { status: number }).status = 403;
    const result = await saveUserRoleChanges({
      user: staff,
      userId: staff.id,
      currentRoles: ["Secrétaire"],
      selectedRoles: ["Secrétaire", "Comptable"],
      grant: async () => {
        grants.push("Comptable");
        throw denied;
      },
      revoke: async (_id, role) => {
        revokes.push(role);
      },
      reload: async () => {
        localSuccess = true;
      },
      reloadAfterFailure: async () => {
        reloaded += 1;
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "Attribution refusée par la politique de l'établissement.");
      assert.equal(result.status, 403);
    }
    assert.equal(localSuccess, false);
    assert.deepEqual(grants, ["Comptable"]);
    assert.deepEqual(revokes, []);
    assert.equal(reloaded, 1);
  });

  it("une erreur réseau n'est pas un succès local", async () => {
    const result = await saveUserRoleChanges({
      user: staff,
      userId: staff.id,
      currentRoles: ["Secrétaire"],
      selectedRoles: ["Secrétaire", "Comptable"],
      grant: async () => {
        throw new Error("Network request failed");
      },
      revoke: async () => {
        throw new Error("ne doit pas révoquer après un échec réseau");
      },
      reload: async () => {
        throw new Error("ne doit pas recharger comme un succès");
      },
      reloadAfterFailure: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "Network request failed");
  });

  it("un 409 au retrait n'affiche pas de succès", async () => {
    const conflict = new Error("Retrait refusé : affectations actives.");
    (conflict as Error & { status: number }).status = 409;
    const result = await saveUserRoleChanges({
      user: staff,
      userId: staff.id,
      currentRoles: ["Enseignant"],
      selectedRoles: [],
      grant: async () => undefined,
      revoke: async () => {
        throw conflict;
      },
      reload: async () => {
        throw new Error("ne doit pas recharger comme un succès");
      },
      reloadAfterFailure: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
  });

  it("le double tap sur Enregistrer ne lance qu'une mutation", async () => {
    const flight = createSingleFlight();
    let started = 0;
    const run = () =>
      flight.run(async () => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return started;
      });
    const [first, second] = await Promise.all([run(), run()]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, ["done", "skipped"]);
    assert.equal(started, 1);
  });

  it("après réussite, l'affichage suit les rôles rechargés depuis l'API", async () => {
    let displayed = ["Secrétaire"];
    const serverUser = {
      accountKind: "staff",
      roles: ["Enseignant", "Comptable"],
      activeRoles: ["Enseignant", "Comptable"],
    };
    const result = await saveUserRoleChanges({
      user: staff,
      userId: staff.id,
      currentRoles: ["Secrétaire"],
      selectedRoles: ["Enseignant", "Comptable"],
      grant: async () => undefined,
      revoke: async () => undefined,
      reload: async () => {
        displayed = [...serverUser.roles];
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(displayed, ["Enseignant", "Comptable"]);
    assert.equal(formatAccessRolesDisplay(serverUser), "Enseignant · Comptable");
    assert.notEqual(displayed.join(" · "), "Secrétaire");
  });
});

describe("contrat de parité — pas de gestion limitée au rôle Enseignant", () => {
  it("le composant Mobile administre le catalogue, pas seulement Enseignant", () => {
    const controls = source("src/components/UserMutationControls.tsx");
    const screen = source("src/screens/UsersScreen.tsx");
    const forbidden = [
      /function hasTeacherRole/,
      /const grantTeacher/,
      /const revokeTeacher/,
      /users-grant-teacher/,
      /users-revoke-teacher/,
      /Attribuer Enseignant/,
      /Retirer Enseignant/,
      /grantClientsUserRole\([^)]*"Enseignant"/,
      /revokeClientsUserRole\([^)]*"Enseignant"/,
    ];
    for (const pattern of forbidden) {
      assert.doesNotMatch(controls, pattern);
    }
    assert.match(controls, /Gérer les rôles/);
    assert.match(controls, /Sélectionnez les rôles d'accès de cet utilisateur\./);
    assert.match(controls, /listAssignableEstablishmentRoles/);
    assert.match(controls, /visibleAssignableRoles/);
    assert.match(controls, /saveUserRoleChanges/);
    assert.match(controls, /createSingleFlight/);
    assert.match(controls, /grantClientsUserRole/);
    assert.match(controls, /revokeClientsUserRole/);
    assert.match(controls, /isStudentLinkedAccount\(row\)/);
    assert.match(controls, /canAssignRoleToUserAccount/);
    assert.match(controls, /testID="users-manage-roles"/);
    assert.match(controls, /testID=\{`users-role-option-\$\{role\.roleKey\}`\}/);
    assert.doesNotMatch(controls, /role\.permissions/);
    assert.match(
      screen,
      /Les rôles d'accès peuvent être affectés selon le catalogue de l'établissement/,
    );
    assert.doesNotMatch(screen, /L'attribution du rôle Enseignant est refusée/);
  });
});
