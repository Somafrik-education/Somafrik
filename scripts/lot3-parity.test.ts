/**
 * Contrats LOT 3 — PARITY-028 Enseignants.
 *
 *   npx --yes tsx --test scripts/lot3-parity.test.ts
 *
 * Décision canonique : POST /backoffice/users/create-teacher
 * (createTeacherIdentityFromUsers, une transaction). POST /teachers reste
 * tombstone 403. Pas d'alias teachersApi → Users.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("PARITY-028 — teachersApi n'expose plus create / POST /teachers", () => {
  const api = read("web/src/lib/teachersApi.ts");
  assert.doesNotMatch(api, /export interface CreateTeacherPayload/);
  assert.doesNotMatch(api, /\bcreate\s*:/);
  assert.doesNotMatch(api, /api\.post<SchoolTeacher>\(\s*["'`]\/teachers["']/);
  assert.doesNotMatch(api, /createTeacherIdentity/);
  assert.match(api, /list:\s*\(\)\s*=>\s*api\.get<SchoolTeacher\[\]>\(\s*["'`]\/teachers["']/);
  assert.match(api, /update:\s*\(/);
  assert.match(api, /remove:\s*\(/);
});

test("PARITY-028 — aucun client Web/Mobile n'écrit POST /teachers pour créer", () => {
  const webTeachers = read("web/src/lib/teachersApi.ts");
  const webUsers = read("web/src/pages/UsersPage.tsx");
  const webClients = read("web/src/lib/clientsApi.ts");
  const mobileApi = read("Mobile/src/services/api.ts");
  const mobileControls = read("Mobile/src/components/TeacherMutationControls.tsx");
  assert.doesNotMatch(webTeachers, /api\.post\([^)]*\/teachers/);
  assert.doesNotMatch(webUsers, /["'`]\/teachers["'`]/);
  assert.doesNotMatch(webClients, /["'`]\/teachers["'`]/);
  assert.doesNotMatch(mobileControls, /["'`]\/teachers["'`]/);
  assert.doesNotMatch(mobileApi, /request<[^>]*>\(\s*["'`]\/teachers["'`]/);
  assert.match(
    mobileApi,
    /POST \/teachers est 403|TEACHER_IDENTITY_MUST_COME_FROM_USERS/,
  );
});

test("PARITY-028 — POST /api/teachers reste tombstone 403, jamais une route de création", () => {
  const server = read("backend/server.js");
  const tombstone = server.match(
    /app\.post\(\s*["'`]\/api\/teachers["'`][\s\S]{0,400}?res\.status\((\d+)\)/,
  );
  assert.ok(tombstone, "POST /api/teachers doit rester déclaré");
  assert.equal(tombstone[1], "403");
  assert.match(server, /TEACHER_IDENTITY_MUST_COME_FROM_USERS/);
  assert.doesNotMatch(
    server,
    /app\.post\(\s*["'`]\/api\/teachers["'`][\s\S]{0,800}?(createSchoolTeacher|repository\.createSchoolTeacher)/,
  );
});

test("PARITY-028 — Mobile crée via Users /create-teacher, domaine users, pas d'outbox", () => {
  const api = read("Mobile/src/services/api.ts");
  const controls = read("Mobile/src/components/TeacherMutationControls.tsx");
  const inventory = read("Mobile/src/lib/mobileMutationInventory.ts");
  assert.match(api, /export function createTeacherIdentityFromUsers/);
  assert.match(api, /["'`]\/backoffice\/users\/create-teacher["'`]/);
  assert.match(controls, /createTeacherIdentityFromUsers\(/);
  assert.match(
    inventory,
    /createTeacherIdentityFromUsers[\s\S]*?path:\s*["'`]\/backoffice\/users\/create-teacher["'`][\s\S]*?outbox:\s*false[\s\S]*?domain:\s*["'`]users["'`]/,
  );
});

test("PARITY-028 — Web Users : création Enseignant = create-teacher, pas createUser+grant", () => {
  const usersPage = read("web/src/pages/UsersPage.tsx");
  const clients = read("web/src/lib/clientsApi.ts");
  const accounts = read("web/src/lib/userAccounts.ts");
  assert.match(clients, /createTeacherIdentity\s*:/);
  assert.match(clients, /["'`]\/backoffice\/users\/create-teacher["'`]/);
  assert.match(accounts, /export function toCreateTeacherIdentityPayload/);
  assert.match(usersPage, /createTeacherIdentity\(/);
  assert.match(usersPage, /isTeacherRoleLabel\(syncedUser\.role\)/);
  assert.match(usersPage, /toCreateTeacherIdentityPayload/);
  assert.match(usersPage, /credentials/);
  assert.doesNotMatch(
    usersPage,
    /createUser\(toCreateUserApiPayload\(syncedUser\)\)[\s\S]{0,220}grantUserRole\(String\(created\.id\), syncedUser\.role\)/,
  );
});

test("PARITY-028 — backend canonique atomique + RBAC create-teacher", () => {
  const orchestrator = read("backend/lib/createTeacherIdentityFromUsers.js");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const unit = read("backend/lib/createTeacherIdentityFromUsers.test.js");
  const pg = read("backend/lib/createTeacherIdentityFromUsers.pg.test.js");
  const verify = read("backend/scripts/verify-teacher-account-creation.js");
  assert.match(orchestrator, /withTransaction/);
  assert.match(orchestrator, /createTransactionalClientsStore/);
  assert.match(orchestrator, /grantUserRole/);
  assert.match(orchestrator, /temporarySecret/);
  assert.match(
    server,
    /app\.post\(\s*["'`]\/api\/backoffice\/users\/create-teacher["'`]/,
  );
  assert.match(server, /createTeacherIdentityFromUsers/);
  assert.match(server, /roles\/grant/);
  assert.match(rbac, /POST \/api\/backoffice\/users\/create-teacher/);
  assert.match(unit, /GRANT échoué rollback/);
  assert.match(unit, /secret remis/);
  assert.match(pg, /un seul COMMIT/);
  assert.match(pg, /ROLLBACK/);
  assert.match(pg, /audit_logs/);
  assert.match(verify, /TEACHER_IDENTITY_MUST_COME_FROM_USERS/);
  assert.match(verify, /\/backoffice\/users\/create-teacher/);
  assert.match(verify, /mustChangePassword/);
  assert.match(verify, /create-teacher/);
  assert.doesNotMatch(
    verify,
    /async function createTeacherViaUsers[\s\S]{0,500}?\/backoffice\/users["'`],\s*\{[\s\S]{0,200}?method:\s*["'`]POST["'`]/,
  );
});

test("PARITY-028 — gate CI lot3 composable avec LOT 0/1/2", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  assert.match(pkg, /"test:lot3-parity"/);
  assert.match(pkg, /"test:lot0-parity"/);
  assert.match(pkg, /"test:lot1-parity"/);
  assert.match(pkg, /"test:lot2-parity"/);
  assert.match(gates, /lot3:/);
  assert.match(gates, /npm run test:lot3-parity/);
  assert.match(gates, /needs: \[scope, quality, secrets, core, targeted, lot0, lot1, lot2, lot3\]/);
  assert.match(gates, /needs\.lot3\.result/);
  assert.match(gates, /"\$LOT0" "\$LOT1" "\$LOT2" "\$LOT3"/);
});
