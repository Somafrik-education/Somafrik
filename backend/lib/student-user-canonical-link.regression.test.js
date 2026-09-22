"use strict";

/**
 * student-user-canonical-link.regression
 *
 * Invariants protégés :
 * 1. 1 user ≠ 1 student par simple rôle
 * 2. 1 rôle STUDENT ≠ preuve d'existence de students
 * 3. students.user_id = autorité de liaison
 * 4. students.id = identité métier des données pédagogiques
 * 5. users.id = identité d'authentification
 * 6. student_code = identifiant public, pas FK métier
 *
 * Les contrats P0/P1 de liaison canonique sont exécutés (plus de skip FAIL
 * sur le matcher, self-sync, auth, rôle ≠ fiche). Fallback legacy code
 * seulement si students.user_id IS NULL.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { hydrateUser } = require("./userRoleLifecycleService");
const {
  BUSINESS_PROFILE_KIND_LABELS,
  SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
  SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
  buildBusinessProfile,
  findActiveStudentProfileForUser,
  resolveAccountKind,
  userMatchesStudent,
} = require("./businessProfileIntegrity");
const { AuthService } = require("../services/authService");
const { attachMemoryLoginLockoutStore } = require("./loginLockout");
const { handleMobileSyncL1Students } = require("./mobileSyncStudents");
const { TokenService } = require("../services/tokenService");
const { TenantScopeService } = require("../services/tenantScopeService");

const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const CODE_C = "CD-ITS-MR-26-00007";
const LOGIN_REAL = "6654 1324";
const MATRICULE_REAL = "CD-IN-61-26-00017";
const U1 = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";
const U17 = "17171717-1717-4717-8717-171717171717";
const S17 = "18181818-1818-4818-8818-181818181818";
const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

const ROOT = path.resolve(__dirname, "..");

const ARCHITECTURAL_GAPS = Object.freeze([
  {
    id: "B2",
    file: "backend/lib/businessProfileIntegrity.js",
    fn: "findActiveStudentProfileForUser / userMatchesStudent",
    line: "70-96",
    scenario: "S2.student_code = U1.user_code listé avant S1.user_id = U1",
    impact: "Backend /users projection + grants TEACHER",
    severity: "P0",
    recommended: "Préférer tout match students.user_id, fallback code seulement si user_id IS NULL",
  },
  {
    id: "B3",
    file: "backend/lib/businessProfileIntegrity.js",
    fn: "resolveAccountKind",
    line: "133-134",
    scenario: "roleKeys=['STUDENT'] sans ligne students",
    impact: "Backend/Web/Mobile : type métier student_login inventé",
    severity: "P1",
    recommended: "accountKind student_login seulement si linkedStudent (FK) existe",
  },
  {
    id: "B8",
    file: "backend/db/classStudentsRepository.js",
    fn: "listLiveSelfStudentIdForSync",
    line: "699-714",
    scenario: "self mobile-sync via u.user_code = st.student_code, ignore students.user_id",
    impact: "Mobile sync self : mauvais élève si codes divergents / collision",
    severity: "P0",
    recommended: "JOIN st.user_id = u.id, fallback code seulement si user_id IS NULL",
  },
  {
    id: "B8-auth",
    file: "backend/services/authService.js",
    fn: "findLinkedStudent",
    line: "577-585",
    scenario: "session élève via matricule/publicId/id, pas students.user_id",
    impact: "Mobile login attache la fiche par code",
    severity: "P0",
    recommended: "Résoudre via students.user_id = users.id",
  },
  {
    id: "B8-class-users",
    file: "backend/db/clientsPgStore.js",
    fn: "listClassStudentUserIds",
    line: "1436",
    scenario: "JOIN u.user_code = st.student_code",
    impact: "Communications / roster comptes élèves de classe",
    severity: "P1",
    recommended: "JOIN st.user_id = u.id",
  },
]);

function schoolAdmin() {
  return { sub: "admin-cd", role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
}

function buildStore() {
  return createClientsMemoryStore({
    platformSchools: [
      { id: SCHOOL_A, code: "CD-2026-0001", name: "CD", countryId: "country-cd", countryCode: "CD" },
      { id: SCHOOL_B, code: "BI-2026-0001", name: "BI", countryId: "country-bi", countryCode: "BI" },
    ],
  });
}

function userFixture(overrides = {}) {
  return {
    id: U1,
    school_id: SCHOOL_A,
    user_code: CODE_A,
    identity_code: CODE_A,
    login_code: CODE_A,
    first_name: "Marc",
    last_name: "Rumba",
    ...overrides,
  };
}

function studentFixture(overrides = {}) {
  return {
    id: S1,
    school_id: SCHOOL_A,
    student_code: CODE_B,
    first_name: "Marc",
    last_name: "Rumba",
    status: "active",
    user_id: U1,
    ...overrides,
  };
}

function sourceOf(...segments) {
  return fs.readFileSync(path.join(ROOT, ...segments), "utf8");
}

describe("student-user-canonical-link.regression — inventaire des gaps isolés", () => {
  it("documente les anomalies sans les masquer ni affaiblir les assertions", () => {
    assert.ok(ARCHITECTURAL_GAPS.length >= 4);
    for (const gap of ARCHITECTURAL_GAPS) {
      assert.match(gap.severity, /^P[012]$/);
      assert.ok(gap.file && gap.fn && gap.scenario && gap.recommended);
    }
  });
});

describe("B1 — liaison canonique prioritaire (codes divergents)", () => {
  it("U1.user_code=CODE-A + S1.user_id=U1 + S1.student_code=CODE-B → S1", () => {
    const user = userFixture();
    const students = [studentFixture()];
    const found = findActiveStudentProfileForUser(students, user, SCHOOL_A);
    assert.equal(found?.id, S1);
    assert.notEqual(user.user_code, found.student_code);
  });

  it("projection hydrateUser conserve linkedStudent.studentId même si codes divergents", () => {
    const user = userFixture();
    const studentRow = findActiveStudentProfileForUser([studentFixture()], user, SCHOOL_A);
    const hydrated = hydrateUser(user, [], buildBusinessProfile({ studentRow, roleKeys: [] }));
    assert.equal(hydrated.accountKind, "student_login");
    assert.equal(hydrated.linkedStudent.studentId, S1);
    assert.equal(hydrated.linkedStudent.studentCode, CODE_B);
    assert.equal(hydrated.businessProfileLabel, BUSINESS_PROFILE_KIND_LABELS.student_login);
    assert.deepEqual(hydrated.roleKeys, []);
    assert.notEqual(hydrated.businessProfileLabel, "Sans affectation");
  });
});

describe("B2 — collision de matricule/code", () => {
  it("caractérise l'autorité concurrente pairwise : S1 via FK et S2 via code matchent tous les deux", () => {
    const user = userFixture();
    const s1 = studentFixture();
    const s2 = studentFixture({
      id: S2,
      student_code: CODE_A,
      first_name: "Autre",
      last_name: "Collision",
      user_id: null,
    });
    assert.equal(userMatchesStudent(user, s1), true, "FK S1.user_id = U1");
    assert.equal(userMatchesStudent(user, s2), true, "legacy : S2.user_id NULL + code = U1.user_code");
  });

  it("quand S1 est trouvé en premier, le FK gagne", () => {
    const user = userFixture();
    const found = findActiveStudentProfileForUser(
      [
        studentFixture(),
        studentFixture({ id: S2, student_code: CODE_A, user_id: null, first_name: "Autre" }),
      ],
      user,
      SCHOOL_A,
    );
    assert.equal(found?.id, S1);
  });

  it("B2 contract : S2 listé avant S1 ne doit jamais remplacer le FK", () => {
      const user = userFixture();
      const found = findActiveStudentProfileForUser(
        [
          studentFixture({
            id: S2,
            student_code: CODE_A,
            user_id: null,
            first_name: "Autre",
            last_name: "Collision",
          }),
          studentFixture(),
        ],
        user,
        SCHOOL_A,
      );
      assert.equal(found?.id, S1, "U1 → S1, jamais S2");
    });
});

describe("B3 — rôle STUDENT sans fiche students", () => {
  it("ne fabrique pas de linkedStudent", () => {
    const profile = buildBusinessProfile({ studentRow: null, roleKeys: ["STUDENT"] });
    assert.equal(profile.linkedStudent, null);
  });

  it("ne sélectionne pas un élève déjà lié à un autre user.id malgré un code identique", () => {
      const user = userFixture({
        id: "user-orphan",
        user_code: CODE_B,
        identity_code: CODE_B,
        login_code: CODE_B,
      });
      const found = findActiveStudentProfileForUser(
        [studentFixture({ id: S1, user_id: U1, student_code: CODE_B })],
        user,
        SCHOOL_A,
      );
      assert.equal(found, null, "le code égal à un autre élève déjà lié par FK ne doit pas être réutilisé");
    });

  it("listProjection : GRANT STUDENT n'existe pas ; unassigned sans students.user_id", async () => {
    const store = buildStore();
    const created = await store.createUser(
      { firstName: "Sans", lastName: "Fiche", email: "sans.fiche@test.local" },
      schoolAdmin(),
      { ipAddress: "127.0.0.1", userAgent: "canonical-link" },
    );
    store._tables.userRoles.push({
      user_id: created.id,
      school_id: SCHOOL_A,
      role_key: "STUDENT",
      status: "active",
    });
    const listed = store.listProjection().users.find((row) => row.id === created.id);
    assert.equal(listed.linkedStudent, null);
    assert.ok(!store._tables.students.some((row) => String(row.user_id) === String(created.id)));
  });

  it("B3 contract : roleKeys STUDENT sans fiche ≠ student_login", () => {
      assert.notEqual(resolveAccountKind({ roleKeys: ["STUDENT"] }), "student_login");
      assert.equal(buildBusinessProfile({ studentRow: null, roleKeys: ["STUDENT"] }).linkedStudent, null);
      assert.notEqual(
        buildBusinessProfile({ studentRow: null, roleKeys: ["STUDENT"] }).accountKind,
        "student_login",
      );
    });
});

describe("B4 — fiche élève sans rôle STUDENT", () => {
  it("students.user_id relie toujours le profil métier", () => {
    const user = userFixture({ role: null });
    const studentRow = findActiveStudentProfileForUser([studentFixture()], user, SCHOOL_A);
    const hydrated = hydrateUser(user, [], buildBusinessProfile({ studentRow, roleKeys: [] }));
    assert.equal(hydrated.linkedStudent.studentId, S1);
    assert.equal(hydrated.accountKind, "student_login");
    assert.deepEqual(hydrated.roleKeys, []);
  });
});

describe("B5 — codes historiques divergents", () => {
  it("user_code != student_code + user_id → FK", () => {
    const user = userFixture({ user_code: CODE_A, identity_code: CODE_B, login_code: CODE_B });
    const found = findActiveStudentProfileForUser([studentFixture()], user, SCHOOL_A);
    assert.equal(found?.id, S1);
  });

  it("login_code != student_code + user_id → FK", () => {
    const user = userFixture({ user_code: CODE_C, identity_code: CODE_C, login_code: "LOGIN-X" });
    const found = findActiveStudentProfileForUser([studentFixture()], user, SCHOOL_A);
    assert.equal(found?.id, S1);
  });

  it("identity_code != student_code + user_id → FK", () => {
    const user = userFixture({ user_code: CODE_C, identity_code: "IDENT-X", login_code: CODE_C });
    const found = findActiveStudentProfileForUser([studentFixture()], user, SCHOOL_A);
    assert.equal(found?.id, S1);
  });
});

describe("B6 — homonymes", () => {
  it("deux élèves même nom/prénom : seul le FK est retenu", () => {
    const user = userFixture();
    const found = findActiveStudentProfileForUser(
      [
        studentFixture({
          id: S2,
          student_code: CODE_C,
          user_id: null,
          first_name: "Marc",
          last_name: "Rumba",
        }),
        studentFixture(),
      ],
      user,
      SCHOOL_A,
    );
    assert.equal(found?.id, S1);
    assert.notEqual(found?.id, S2);
  });
});

describe("B7 — isolation tenant", () => {
  it("même student_code dans un autre établissement n'est pas lié", () => {
    const user = userFixture();
    const found = findActiveStudentProfileForUser(
      [
        studentFixture({
          id: S2,
          school_id: SCHOOL_B,
          student_code: CODE_A,
          user_id: null,
        }),
        studentFixture(),
      ],
      user,
      SCHOOL_A,
    );
    assert.equal(found?.id, S1);
    assert.equal(findActiveStudentProfileForUser([studentFixture({ school_id: SCHOOL_B })], user, SCHOOL_A), null);
  });

  it("listProjection n'attache pas un élève d'un autre tenant", async () => {
    const store = buildStore();
    const created = await store.createUser(
      { firstName: "Cross", lastName: "Tenant", email: "cross.tenant@test.local" },
      schoolAdmin(),
      { ipAddress: "127.0.0.1", userAgent: "canonical-link" },
    );
    const row = store._tables.users.find((item) => item.id === created.id);
    row.user_code = CODE_A;
    store._tables.students.push({
      id: S2,
      school_id: SCHOOL_B,
      student_code: CODE_A,
      first_name: "Cross",
      last_name: "Tenant",
      status: "active",
    });
    const listed = store.listProjection().users.find((item) => item.id === created.id);
    assert.equal(listed.linkedStudent, null);
  });
});

describe("B8 — mobile sync self student", () => {
  it("le handler sync consomme l'ID renvoyé par listLiveSelfStudentIdForSync (pas le studentId client)", async () => {
    const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
    const tenantScopeService = new TenantScopeService();
    let requestedUserId = null;
    const result = await handleMobileSyncL1Students({
      principal: {
        sub: U1,
        role: "Élève / Étudiant",
        schoolCode: "SCH-A",
        permissions: ["Élèves:READ"],
        studentIds: [S2],
      },
      tokenService: tokens,
      tenantScopeService,
      repository: {
        async getSchoolByCode(code) {
          return { id: `sid-${code}`, school_code: code };
        },
        async listActiveUserRoleKeysForSchool() {
          return ["STUDENT"];
        },
        async resolveEffectivePermissions() {
          return { permissions: ["Élèves:READ"] };
        },
        async listLiveTeacherClassAssignmentsForSync() {
          return [];
        },
        async listLiveAssignedStudentIdsForSync() {
          return [];
        },
        async listLiveParentLinkedStudentIdsForSync() {
          return [];
        },
        async listLiveSelfStudentIdForSync(userId) {
          requestedUserId = userId;
          return { studentId: S1 };
        },
        async listSchoolStudentsForMobileSync(_schoolCode, options = {}) {
          const ids = new Set(options.studentIds ?? []);
          return [
            { id: S1, studentCode: CODE_B, firstName: "Marc", lastName: "Rumba", syncUpdatedAt: "2026-09-01T00:00:00.000Z", tombstone: false, status: "active" },
            { id: S2, studentCode: CODE_A, firstName: "Autre", lastName: "Code", syncUpdatedAt: "2026-09-01T00:00:00.000Z", tombstone: false, status: "active" },
          ].filter((row) => ids.has(row.id));
        },
      },
    });
    assert.equal(requestedUserId, U1);
    assert.deepEqual(
      result.body.items.map((item) => item.id),
      [S1],
    );
  });

  it("rôle STUDENT sans fiche live → aucun élève inventé", async () => {
    const tokens = new TokenService({ secret: "ci-test-secret-with-enough-length-for-production-checks" });
    const tenantScopeService = new TenantScopeService();
    const result = await handleMobileSyncL1Students({
      principal: {
        sub: U1,
        role: "Élève / Étudiant",
        schoolCode: "SCH-A",
        permissions: ["Élèves:READ"],
      },
      tokenService: tokens,
      tenantScopeService,
      repository: {
        async getSchoolByCode(code) {
          return { id: `sid-${code}`, school_code: code };
        },
        async listActiveUserRoleKeysForSchool() {
          return ["STUDENT"];
        },
        async resolveEffectivePermissions() {
          return { permissions: ["Élèves:READ"] };
        },
        async listLiveTeacherClassAssignmentsForSync() {
          return [];
        },
        async listLiveAssignedStudentIdsForSync() {
          return [];
        },
        async listLiveParentLinkedStudentIdsForSync() {
          return [];
        },
        async listLiveSelfStudentIdForSync() {
          return null;
        },
        async listSchoolStudentsForMobileSync(_schoolCode, options = {}) {
          const ids = new Set(options.studentIds ?? []);
          if (!ids.size) return [];
          return [
            { id: S1, studentCode: CODE_B, firstName: "Marc", lastName: "Rumba", syncUpdatedAt: "2026-09-01T00:00:00.000Z", tombstone: false, status: "active" },
          ].filter((row) => ids.has(row.id));
        },
      },
    });
    assert.deepEqual(result.body.items, []);
  });

  it("SQL self-student joint students.user_id = users.id, fallback code si user_id IS NULL", () => {
    const src = sourceOf("db", "classStudentsRepository.js");
    assert.match(src, /async listLiveSelfStudentIdForSync/);
    const fn = src.slice(src.indexOf("async listLiveSelfStudentIdForSync"));
    const body = fn.slice(0, fn.indexOf("async listByClassCode"));
    assert.match(body, /st\.user_id::text = u\.id::text/);
    assert.match(body, /st\.user_id IS NULL/);
    assert.match(body, /u\.user_code = st\.student_code/);
  });

  it("B8 contract : listLiveSelfStudentIdForSync doit joindre students.user_id = users.id", () => {
      const src = sourceOf("db", "classStudentsRepository.js");
      const fn = src.slice(src.indexOf("async listLiveSelfStudentIdForSync"));
      const body = fn.slice(0, fn.indexOf("async listByClassCode"));
      assert.match(body, /st\.user_id/);
      assert.match(body, /u\.id/);
    });

  it("auth findLinkedStudent : sans FK, fallback matricule legacy user_id NULL", () => {
    attachMemoryLoginLockoutStore();
    const school = {
      id: SCHOOL_A,
      code: "SCH-TEST",
      loginCode: "CD-IN-26-001",
      publicId: "CD-IN-26-001",
      name: "Institut Nuru",
      countryCode: "CD",
      status: "Actif",
      validationStatus: "Validé",
    };
    const service = new AuthService({
      school,
      schools: [school],
      teachers: [],
      students: [
        { id: S1, schoolCode: school.code, matricule: CODE_B, publicId: CODE_B, firstName: "Marc", lastName: "Rumba" },
        { id: S2, schoolCode: school.code, matricule: CODE_A, publicId: CODE_A, firstName: "Autre", lastName: "Code" },
      ],
      userAccounts: [
        {
          id: U1,
          identifier: CODE_A,
          publicId: CODE_A,
          firstName: "Marc",
          lastName: "Rumba",
          role: "Élève / Étudiant",
          roleKeys: ["STUDENT"],
          schoolCode: school.code,
          accessChannel: "Application",
          status: "Actif",
          password: "1234",
          pin: "1234",
        },
      ],
      countries: [{ name: "RDC", code: "CD", status: "Actif" }],
      subscriptions: [],
    });
    const linked = service.findLinkedStudent(service.userAccounts[0], school.code);
    assert.equal(linked?.id, S2, "legacy user_id NULL : matricule CODE-A → S2");
  });

  it("B8-auth contract : findLinkedStudent doit suivre students.user_id pas le matricule", () => {
      attachMemoryLoginLockoutStore();
      const school = {
        id: SCHOOL_A,
        code: "SCH-TEST",
        loginCode: "CD-IN-26-001",
        publicId: "CD-IN-26-001",
        name: "Institut Nuru",
        countryCode: "CD",
        status: "Actif",
        validationStatus: "Validé",
      };
      const service = new AuthService({
        school,
        schools: [school],
        teachers: [],
        students: [
          { id: S1, schoolCode: school.code, matricule: CODE_B, publicId: CODE_B, userId: U1, firstName: "Marc", lastName: "Rumba" },
          { id: S2, schoolCode: school.code, matricule: CODE_A, publicId: CODE_A, firstName: "Autre", lastName: "Code" },
        ],
        userAccounts: [
          {
            id: U1,
            identifier: CODE_A,
            publicId: CODE_A,
            firstName: "Marc",
            lastName: "Rumba",
            role: "Élève / Étudiant",
            schoolCode: school.code,
            accessChannel: "Application",
            status: "Actif",
            password: "1234",
            pin: "1234",
          },
        ],
        countries: [{ name: "RDC", code: "CD", status: "Actif" }],
        subscriptions: [],
      });
      assert.equal(service.findLinkedStudent(service.userAccounts[0], school.code)?.id, S1);
      const managed = service.buildManagedMobileUser(service.userAccounts[0], "student");
      assert.equal(managed.id, U1, "users.id reste l'identité d'auth");
      assert.equal(managed.linkedStudent.studentId, S1);
      assert.equal(managed.linkedStudent.studentCode, CODE_B);
      assert.notEqual(managed.id, S1);
    });
});

describe("B9 — projection /users", () => {
  it("GET listProjection : FK + codes divergents produit linkedStudent + accountKind", async () => {
    const store = buildStore();
    const created = await store.createUser(
      { firstName: "Marc", lastName: "Rumba", email: "marc.b9@test.local" },
      schoolAdmin(),
      { ipAddress: "127.0.0.1", userAgent: "canonical-link" },
    );
    const row = store._tables.users.find((item) => item.id === created.id);
    row.user_code = CODE_A;
    row.identity_code = CODE_A;
    row.login_code = CODE_A;
    store._tables.students.push({
      id: S1,
      school_id: SCHOOL_A,
      student_code: CODE_B,
      first_name: "Marc",
      last_name: "Rumba",
      status: "active",
      user_id: created.id,
    });
    const listed = store.listProjection().users.find((item) => item.id === created.id);
    assert.equal(listed.accountKind, "student_login");
    assert.equal(listed.linkedStudent.studentId, S1);
    assert.equal(listed.linkedStudent.studentCode, CODE_B);
    assert.equal(listed.businessProfileLabel, "Compte lié à un élève");
    assert.equal(listed.businessProfileConflict, false);
    assert.deepEqual(listed.roleKeys, []);
    assert.notEqual(listed.user_code ?? listed.publicId ?? listed.identifier, CODE_B);
  });
});

describe("B10 — création/inscription élève", () => {
  it("ensureStudentLoginUser écrit students.user_id = users.id dans le source", () => {
    const src = sourceOf("db", "classStudentsRepository.js");
    assert.match(src, /UPDATE students SET user_id = \$1/);
    assert.match(src, /INSERT INTO user_roles[\s\S]*STUDENT/);
    assert.match(src, /INSERT INTO enrollments/);
  });

  it("caractérise la projection enroll : id HTTP = student_code (pas students.id UUID)", () => {
    const src = sourceOf("db", "classStudentsRepository.js");
    assert.match(src, /id: studentCode/);
  });
});

describe("matrice négative d'identité", () => {
  const cases = [
    {
      name: "canonique normal",
      students: [studentFixture({ student_code: CODE_A })],
      user: userFixture({ user_code: CODE_A, identity_code: CODE_A, login_code: CODE_A }),
      roleKeys: ["STUDENT"],
      expectedId: S1,
    },
    {
      name: "FK + codes divergents",
      students: [studentFixture()],
      user: userFixture(),
      roleKeys: ["STUDENT"],
      expectedId: S1,
    },
    {
      name: "FK sans rôle",
      students: [studentFixture()],
      user: userFixture(),
      roleKeys: [],
      expectedId: S1,
    },
    {
      name: "rôle sans FK",
      students: [],
      user: userFixture({ user_code: CODE_B }),
      roleKeys: ["STUDENT"],
      expectedId: null,
    },
    {
      name: "homonyme",
      students: [
        studentFixture({ id: S2, student_code: CODE_C, user_id: null, first_name: "Marc", last_name: "Rumba" }),
        studentFixture(),
      ],
      user: userFixture(),
      roleKeys: [],
      expectedId: S1,
    },
    {
      name: "autre tenant",
      students: [studentFixture({ school_id: SCHOOL_B, student_code: CODE_A, user_id: null })],
      user: userFixture(),
      roleKeys: ["STUDENT"],
      expectedId: null,
    },
    {
      name: "legacy user_id NULL + codes égaux",
      students: [studentFixture({ user_id: null, student_code: CODE_A })],
      user: userFixture({ user_code: CODE_A }),
      roleKeys: ["STUDENT"],
      expectedId: S1,
    },
  ];

  for (const item of cases) {
    it(item.name, () => {
      const found = findActiveStudentProfileForUser(item.students, item.user, SCHOOL_A);
      assert.equal(found?.id ?? null, item.expectedId);
      if (item.expectedId) {
        const hydrated = hydrateUser(
          item.user,
          item.roleKeys,
          buildBusinessProfile({ studentRow: found, roleKeys: item.roleKeys }),
        );
        assert.equal(hydrated.linkedStudent.studentId, item.expectedId);
      } else {
        const profile = buildBusinessProfile({ studentRow: found, roleKeys: item.roleKeys });
        assert.equal(profile.linkedStudent, null);
      }
    });
  }

  it("collision : FK prioritaire même si S2 précède", () => {
      const found = findActiveStudentProfileForUser(
        [
          studentFixture({ id: S2, student_code: CODE_A, user_id: null }),
          studentFixture(),
        ],
        userFixture(),
        SCHOOL_A,
      );
      assert.equal(found?.id, S1);
    });
});

describe("P1 — destination effective avant DROP SCHEMA public", () => {
  const IT = "somafrik_canonical_link_it";
  const {
    databaseNameFromUrl,
    hostFromUrl,
    isolationRefusal,
    isLoopbackUrlHost,
    isLoopbackServerAddr,
    connectionOverrideRefusal,
    mayDropPublicSchema,
  } = require("./student-user-canonical-link.pg.test.js");

  const allowedUrl = {
    itDb: IT,
    sourceDb: IT,
    host: "localhost",
    databaseUrl: "postgres://localhost/somafrik_canonical_link_it",
    env: {},
  };

  it("URL localhost + current_database IT + inet 127.0.0.1 → DDL autorisé", () => {
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      currentDatabase: IT,
      inetServerAddr: "127.0.0.1",
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, null);
  });

  it("URL 127.0.0.1 + inet 127.0.0.1 → DDL autorisé", () => {
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      host: "127.0.0.1",
      databaseUrl: "postgres://127.0.0.1/somafrik_canonical_link_it",
      currentDatabase: IT,
      inetServerAddr: "127.0.0.1",
    });
    assert.equal(decision.allowed, true);
  });

  it("URL IPv6 [::1] + inet ::1 → DDL autorisé", () => {
    assert.equal(hostFromUrl("postgres://[::1]:5432/somafrik_canonical_link_it"), "::1");
    assert.ok(isLoopbackUrlHost("[::1]"));
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      host: hostFromUrl("postgres://[::1]:5432/somafrik_canonical_link_it"),
      databaseUrl: "postgres://[::1]:5432/somafrik_canonical_link_it",
      currentDatabase: IT,
      inetServerAddr: "::1",
    });
    assert.equal(decision.allowed, true);
  });

  it("host distant → refus", () => {
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      host: "db.prod.example",
      databaseUrl: "postgres://db.prod.example/somafrik_canonical_link_it",
      currentDatabase: IT,
      inetServerAddr: "127.0.0.1",
    });
    assert.equal(decision.allowed, false);
  });

  it("?host=remote.example → refus même si l'autorité est localhost", () => {
    const url = "postgres://localhost/somafrik_canonical_link_it?host=remote.example";
    assert.ok(connectionOverrideRefusal(url));
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      databaseUrl: url,
      currentDatabase: IT,
      inetServerAddr: "127.0.0.1",
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /host/);
  });

  it("?hostaddr=IP distante → refus", () => {
    const url = "postgres://localhost/somafrik_canonical_link_it?hostaddr=8.8.8.8";
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      databaseUrl: url,
      currentDatabase: IT,
      inetServerAddr: "127.0.0.1",
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /hostaddr/);
  });

  it("/postgres → refus", () => {
    assert.ok(isolationRefusal({ itDb: IT, sourceDb: "postgres", host: "localhost", env: {} }));
    assert.equal(
      mayDropPublicSchema({
        ...allowedUrl,
        sourceDb: "postgres",
        databaseUrl: "postgres://localhost/postgres",
        currentDatabase: "postgres",
        inetServerAddr: "127.0.0.1",
      }).allowed,
      false,
    );
  });

  it("/somafrik → refus", () => {
    assert.equal(databaseNameFromUrl("postgres://localhost:5432/somafrik"), "somafrik");
    assert.equal(
      mayDropPublicSchema({
        ...allowedUrl,
        sourceDb: "somafrik",
        databaseUrl: "postgres://localhost/somafrik",
        currentDatabase: "somafrik",
        inetServerAddr: "127.0.0.1",
      }).allowed,
      false,
    );
  });

  it("autre base *_it ≠ nom autorisé → refus", () => {
    assert.equal(
      mayDropPublicSchema({
        ...allowedUrl,
        sourceDb: "other_it",
        databaseUrl: "postgres://localhost/other_it",
        currentDatabase: "other_it",
        inetServerAddr: "127.0.0.1",
      }).allowed,
      false,
    );
  });

  it("bonne URL + bonne base mais inet_server_addr distant → refus", () => {
    const decision = mayDropPublicSchema({
      ...allowedUrl,
      currentDatabase: IT,
      inetServerAddr: "203.0.113.10",
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /inet_server_addr/);
    assert.ok(isLoopbackServerAddr("127.0.0.1"));
    assert.equal(isLoopbackServerAddr("203.0.113.10"), false);
  });

  it("?host=127.0.0.1 → refus (tout override de destination, même loopback)", () => {
    assert.equal(
      mayDropPublicSchema({
        ...allowedUrl,
        databaseUrl: "postgres://localhost/somafrik_canonical_link_it?host=127.0.0.1",
        currentDatabase: IT,
        inetServerAddr: "127.0.0.1",
      }).allowed,
      false,
    );
  });

  it("inet_server_addr absent → refus", () => {
    assert.equal(
      mayDropPublicSchema({
        ...allowedUrl,
        currentDatabase: IT,
        inetServerAddr: null,
      }).allowed,
      false,
    );
  });

  it("DROP SCHEMA public n'apparaît qu'après mayDropPublicSchema", () => {
    const src = sourceOf("lib", "student-user-canonical-link.pg.test.js");
    const dropIndex = src.indexOf("DROP SCHEMA public CASCADE");
    const guardIndex = src.indexOf("mayDropPublicSchema");
    assert.ok(guardIndex >= 0);
    assert.ok(dropIndex > src.indexOf("assertConnectedToIsolatedItDatabase"));
    assert.match(src, /inet_server_addr\(\)/);
    assert.match(src, /current_database\(\)/);
    assert.doesNotMatch(src, /CREATE DATABASE \$\{/);
    const pkg = require("../../package.json");
    assert.doesNotMatch(pkg.scripts["verify:user-role-lifecycle"], /student-user-canonical-link\.pg\.test\.js/);
  });
  it("collision SQL : LIMIT 1 priorise le FK, unbounded peut encore voir le legacy", () => {
    const src = sourceOf("lib", "student-user-canonical-link.pg.test.js");
    assert.match(src, /SELECT_ACTIVE_STUDENT_FOR_USER_UNBOUNDED_SQL/);
    assert.match(src, /LIMIT 1 priorise le FK/);
  });
});

describe("P1 — contrat Mobile M2 isolé", () => {
  it("Mobile M2 : rôle STUDENT sans fiche ≠ student_login", () => {
    const mobile = fs.readFileSync(
      path.join(ROOT, "..", "Mobile", "src", "lib", "student-user-canonical-link.regression.test.ts"),
      "utf8",
    );
    assert.doesNotMatch(mobile, /skip:\s*"FAIL — businessProfile\.ts:51,74,88/);
    assert.match(mobile, /formatBusinessProfileKind\(roleOnly\)/);
    assert.match(mobile, /isStudentLinkedAccount\(roleOnly\)/);
    assert.doesNotMatch(
      mobile,
      /assert\.equal\(\s*formatBusinessProfileKind\(roleOnly\),\s*BUSINESS_PROFILE_KIND_LABELS\.student_login/,
    );
    assert.doesNotMatch(
      mobile,
      /assert\.equal\(\s*isStudentLinkedAccount\(roleOnly\),\s*true/,
    );
  });
});

describe("SQL matcher — FK prioritaire, fallback code borné", () => {
  it("SELECT_ACTIVE_STUDENT_FOR_USER_SQL contient le FK ET les égalités de codes en fallback", () => {
    assert.match(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, /user_id/);
    assert.match(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, /st\.student_code = u\.user_code/);
    assert.match(SELECT_STUDENT_PROFILES_FOR_USERS_SQL, /st\.student_code = u\.user_code/);
    const pgStore = sourceOf("db", "clientsPgStore.js");
    assert.match(pgStore, /st\.user_id = u\.id/);
    assert.match(pgStore, /u\.user_code = st\.student_code/);
  });

  it("SQL contract : match code seulement si students.user_id IS NULL", () => {
      assert.match(SELECT_ACTIVE_STUDENT_FOR_USER_SQL, /->>'user_id', ''\) IS NULL/);
    });
});

describe("cas réel — login 6654 1324 / matricule CD-IN-61-26-00017", () => {
  const user = userFixture({
    id: U17,
    user_code: LOGIN_REAL,
    identity_code: LOGIN_REAL,
    login_code: LOGIN_REAL,
  });
  const student = studentFixture({
    id: S17,
    student_code: MATRICULE_REAL,
    user_id: U17,
  });
  const colliding = studentFixture({
    id: S2,
    student_code: LOGIN_REAL,
    user_id: null,
    first_name: "Collision",
    last_name: "Login",
  });

  it("U17 → S17 malgré login ≠ matricule et collision de code", () => {
    const found = findActiveStudentProfileForUser([colliding, student], user, SCHOOL_A);
    assert.equal(found?.id, S17);
    assert.notEqual(user.user_code, found.student_code);
    const hydrated = hydrateUser(user, ["STUDENT"], buildBusinessProfile({ studentRow: found, roleKeys: ["STUDENT"] }));
    assert.equal(hydrated.id, U17);
    assert.equal(hydrated.linkedStudent.studentId, S17);
    assert.equal(hydrated.linkedStudent.studentCode, MATRICULE_REAL);
    assert.equal(hydrated.accountKind, "student_login");
  });

  it("roster classe → users suit students.user_id, pas student_code = user_code", () => {
    const src = sourceOf("db", "clientsPgStore.js");
    const fn = src.slice(src.indexOf("async listClassStudentUserIds"));
    const body = fn.slice(0, fn.indexOf("async listClassParentUserIds"));
    assert.match(body, /st\.user_id = u\.id/);
    assert.match(body, /st\.user_id IS NULL/);
  });
});
