const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { AuthService, BusinessError } = require("../services/authService");
const { BackOfficeAccessService } = require("../services/backOfficeAccessService");
const { TokenService } = require("../services/tokenService");
const { hashSecret } = require("../services/credentialService");
const {
  clearFailedLoginAttempts,
  getLoginAttemptKey,
  recordFailedLoginAttempt,
} = require("../lib/loginLockout");
const { canUserAccountLogin, loginBlockedMessage } = require("../lib/userAccountRules");

const SCHOOL_CODE = "SCH1";

function makeSchool(overrides = {}) {
  return {
    code: SCHOOL_CODE,
    name: "École Test",
    status: "Actif",
    validationStatus: "Validé",
    ...overrides,
  };
}

function makeAuthService(overrides = {}) {
  const school = makeSchool(overrides.school);
  return new AuthService({
    school,
    schools: [school],
    teachers: overrides.teachers ?? [],
    students: overrides.students ?? [],
    userAccounts: overrides.userAccounts ?? [],
    countries: overrides.countries ?? [],
    subscriptions: overrides.subscriptions ?? [{ schoolCode: SCHOOL_CODE, status: "Actif" }],
    assignments: overrides.assignments ?? [],
  });
}

function makeBackOfficeService(overrides = {}) {
  const school = makeSchool(overrides.school);
  return new BackOfficeAccessService({
    school,
    schools: [school],
    userAccounts: overrides.userAccounts ?? [],
    students: overrides.students ?? [],
    countries: overrides.countries ?? [],
    subscriptions: overrides.subscriptions ?? [{ schoolCode: SCHOOL_CODE, status: "Actif" }],
    notifications: overrides.notifications ?? [],
  });
}

const activeTeacher = {
  id: "user-teacher-1",
  publicId: "USR-T1",
  identifier: "prof@ecole.app",
  email: "prof@ecole.app",
  role: "Enseignant",
  schoolCode: SCHOOL_CODE,
  status: "Actif",
  password: "Secret123",
};

const activeParent = {
  id: "user-parent-1",
  publicId: "USR-P1",
  identifier: "+243820123456",
  phone: "+243820123456",
  role: "Parent",
  schoolCode: SCHOOL_CODE,
  status: "Actif",
  pin: "123456",
};

const inactiveUser = {
  id: "user-inactive",
  identifier: "inactif@ecole.app",
  email: "inactif@ecole.app",
  role: "Enseignant",
  schoolCode: SCHOOL_CODE,
  status: "Inactif",
  password: "Secret123",
};

const backOfficeOnlyUser = {
  id: "user-bo",
  identifier: "secretaire@ecole.app",
  email: "secretaire@ecole.app",
  role: "Secrétaire",
  schoolCode: SCHOOL_CODE,
  status: "Actif",
  accessChannel: "BackOffice",
  password: "Secret123",
};

function expectBusinessError(fn, statusCode, messageIncludes) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BusinessError);
    assert.equal(error.statusCode, statusCode);
    if (messageIncludes) {
      assert.match(String(error.message), messageIncludes);
    }
    return true;
  });
}

describe("AuthService — connexion mobile", () => {
  beforeEach(() => {
    clearFailedLoginAttempts(getLoginAttemptKey(SCHOOL_CODE, "prof@ecole.app"));
    clearFailedLoginAttempts(getLoginAttemptKey(SCHOOL_CODE, "+243820123456"));
    clearFailedLoginAttempts(getLoginAttemptKey(SCHOOL_CODE, "inconnu@ecole.app"));
  });

  it("accepte un email valide avec mot de passe correct", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    const result = auth.login({
      role: "teacher",
      schoolCode: SCHOOL_CODE,
      identifier: "prof@ecole.app",
      pin: "Secret123",
    });

    assert.equal(result.role, "teacher");
    assert.equal(result.user.email, "prof@ecole.app");
    assert.equal(result.school.code, SCHOOL_CODE);
  });

  it("accepte un téléphone valide avec PIN correct", () => {
    const auth = makeAuthService({ userAccounts: [activeParent] });
    const result = auth.login({
      role: "parent_student",
      schoolCode: SCHOOL_CODE,
      identifier: "+243820123456",
      pin: "123456",
    });

    assert.equal(result.role, "parent_student");
    assert.equal(result.user.phone, "+243820123456");
  });

  it("rejette un identifiant vide", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "",
          pin: "Secret123",
        }),
      400,
      /champs manquants/i,
    );
  });

  it("rejette un mot de passe/PIN vide", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "prof@ecole.app",
          pin: "",
        }),
      400,
      /champs manquants/i,
    );
  });

  it("rejette des identifiants incorrects", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "prof@ecole.app",
          pin: "MauvaisMotDePasse",
        }),
      401,
      /identifiant ou mot de passe incorrect/i,
    );
  });

  it("rejette un compte inexistant", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "inconnu@ecole.app",
          pin: "Secret123",
        }),
      401,
      /identifiant ou mot de passe incorrect/i,
    );
  });

  it("rejette un compte désactivé", () => {
    const auth = makeAuthService({ userAccounts: [inactiveUser] });
    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "inactif@ecole.app",
          pin: "Secret123",
        }),
      403,
      /inactif/i,
    );
  });

  it("rejette un rôle non autorisé sur mobile", () => {
    const auth = makeAuthService({ userAccounts: [backOfficeOnlyUser] });
    expectBusinessError(
      () =>
        auth.login({
          role: "secretary",
          schoolCode: SCHOOL_CODE,
          identifier: "secretaire@ecole.app",
          pin: "Secret123",
        }),
      403,
      /plateforme Somafrik|portail PC/i,
    );
  });

  it("rejette un rôle mobile incompatible avec le compte", () => {
    const auth = makeAuthService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        auth.login({
          role: "parent_student",
          schoolCode: SCHOOL_CODE,
          identifier: "prof@ecole.app",
          pin: "Secret123",
        }),
      401,
      /identifiant ou mot de passe incorrect/i,
    );
  });
});

describe("BackOfficeAccessService — connexion web", () => {
  beforeEach(() => {
    clearFailedLoginAttempts(getLoginAttemptKey(SCHOOL_CODE, "prof@ecole.app"));
    clearFailedLoginAttempts(getLoginAttemptKey("", "admin@somafrik.app"));
  });

  it("accepte un email valide avec mot de passe correct", () => {
    const superAdmin = {
      id: "user-sa",
      identifier: "admin@somafrik.app",
      email: "admin@somafrik.app",
      role: "Super Administrateur Somafrik",
      schoolCode: "*",
      status: "Actif",
      password: "Admin1234",
    };
    const service = makeBackOfficeService({ userAccounts: [superAdmin] });
    const result = service.login({
      identifier: "admin@somafrik.app",
      password: "Admin1234",
    });

    assert.equal(result.user.email, "admin@somafrik.app");
    assert.equal(result.user.role, "Super Administrateur Somafrik");
  });

  it("rejette un identifiant vide", () => {
    const service = makeBackOfficeService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        service.login({
          schoolCode: SCHOOL_CODE,
          identifier: "",
          password: "Secret123",
        }),
      400,
      /obligatoires/i,
    );
  });

  it("rejette un mot de passe vide", () => {
    const service = makeBackOfficeService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        service.login({
          schoolCode: SCHOOL_CODE,
          identifier: "prof@ecole.app",
          password: "",
        }),
      400,
      /obligatoires/i,
    );
  });

  it("rejette des identifiants incorrects", () => {
    const service = makeBackOfficeService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        service.login({
          schoolCode: SCHOOL_CODE,
          identifier: "prof@ecole.app",
          password: "MauvaisMotDePasse",
        }),
      401,
      /identifiant ou mot de passe incorrect/i,
    );
  });

  it("rejette un compte inexistant", () => {
    const service = makeBackOfficeService({ userAccounts: [activeTeacher] });
    expectBusinessError(
      () =>
        service.login({
          schoolCode: SCHOOL_CODE,
          identifier: "inconnu@ecole.app",
          password: "Secret123",
        }),
      401,
      /identifiant ou mot de passe incorrect/i,
    );
  });

  it("rejette un compte désactivé", () => {
    const service = makeBackOfficeService({ userAccounts: [inactiveUser] });
    expectBusinessError(
      () =>
        service.login({
          schoolCode: SCHOOL_CODE,
          identifier: "inactif@ecole.app",
          password: "Secret123",
        }),
      403,
      /inactif/i,
    );
  });
});

describe("TokenService — session et jetons", () => {
  const tokenService = new TokenService({
    secret: "test-secret-key",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  });

  const subject = {
    sub: "user-teacher-1",
    role: "teacher",
    schoolCode: SCHOOL_CODE,
    countryCode: "CD",
    authSource: "mobile",
  };

  it("génère un access token valide avec les bonnes propriétés", () => {
    const token = tokenService.createAccessToken(subject);
    const payload = tokenService.verify(token, "access");

    assert.equal(payload.sub, subject.sub);
    assert.equal(payload.role, subject.role);
    assert.equal(payload.schoolCode, subject.schoolCode);
    assert.equal(payload.typ, "access");
    assert.equal(payload.iss, "somafrik-api");
    assert.ok(payload.exp > payload.iat);
  });

  it("génère un refresh token avec sessionId", () => {
    const refresh = tokenService.createRefreshToken(subject);

    assert.ok(refresh.token);
    assert.ok(refresh.sessionId);
    assert.ok(refresh.expiresAt instanceof Date);

    const payload = tokenService.verify(refresh.token, "refresh");
    assert.equal(payload.sessionId, refresh.sessionId);
    assert.equal(payload.typ, "refresh");
  });

  it("rejette un token expiré", () => {
    const expiredService = new TokenService({
      secret: "test-secret-key",
      accessTokenTtlSeconds: -10,
    });
    const token = expiredService.createAccessToken(subject);

    assert.throws(
      () => expiredService.verify(token, "access"),
      (error) => /expire/i.test(error.message),
    );
  });

  it("rejette une signature invalide", () => {
    const token = tokenService.createAccessToken(subject);
    const tampered = `${token.slice(0, -4)}xxxx`;

    assert.throws(
      () => tokenService.verify(tampered, "access"),
      (error) => /signature/i.test(error.message),
    );
  });

  it("permet de rafraîchir la session via un refresh token valide", () => {
    const refresh = tokenService.createRefreshToken(subject);
    const refreshPayload = tokenService.verify(refresh.token, "refresh");

    const newAccessToken = tokenService.createAccessToken({
      sub: refreshPayload.sub,
      role: refreshPayload.role,
      schoolCode: refreshPayload.schoolCode,
      countryCode: subject.countryCode,
      authSource: refreshPayload.authSource,
      sessionId: refreshPayload.sessionId,
    });

    const accessPayload = tokenService.verify(newAccessToken, "access");
    assert.equal(accessPayload.sessionId, refresh.sessionId);
    assert.equal(accessPayload.sub, subject.sub);
  });

  it("hash le refresh token pour stockage sécurisé (déconnexion)", () => {
    const refresh = tokenService.createRefreshToken(subject);
    const hash = tokenService.hashToken(refresh.token);

    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.notEqual(hash, refresh.token);
    assert.equal(tokenService.hashToken(refresh.token), hash);
  });
});

describe("Règles de compte utilisateur", () => {
  it("autorise uniquement les comptes actifs", () => {
    assert.equal(canUserAccountLogin({ status: "Actif" }), true);
    assert.equal(canUserAccountLogin({ status: "Inactif" }), false);
    assert.equal(canUserAccountLogin({ status: "Suspendu" }), false);
    assert.equal(canUserAccountLogin({ status: "En attente de validation" }), false);
  });

  it("fournit un message explicite pour un compte désactivé", () => {
    const message = loginBlockedMessage({ status: "Inactif" });
    assert.match(message, /inactif/i);
  });
});

describe("Verrouillage après échecs de connexion", () => {
  it("verrouille temporairement après plusieurs tentatives échouées", () => {
    const key = getLoginAttemptKey(SCHOOL_CODE, "locked-user@test.app");
    clearFailedLoginAttempts(key);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedLoginAttempt(key);
    }

    const auth = makeAuthService({
      userAccounts: [
        {
          ...activeTeacher,
          identifier: "locked-user@test.app",
          email: "locked-user@test.app",
        },
      ],
    });

    expectBusinessError(
      () =>
        auth.login({
          role: "teacher",
          schoolCode: SCHOOL_CODE,
          identifier: "locked-user@test.app",
          pin: "MauvaisMotDePasse",
        }),
      423,
      /verrouillé/i,
    );

    clearFailedLoginAttempts(key);
  });
});

describe("FallbackRepository — déconnexion et session", () => {
  const { FallbackRepository } = require("../db/fallbackRepository");
  const tokenService = new TokenService({ secret: "test-secret-key" });

  it("révoque la session à la déconnexion (suppression effective du token)", async () => {
    const repo = new FallbackRepository();
    await repo.init();

    const refresh = tokenService.createRefreshToken({
      sub: "user-1",
      role: "teacher",
      schoolCode: SCHOOL_CODE,
      authSource: "mobile",
    });
    const hash = tokenService.hashToken(refresh.token);

    await repo.createSession({
      sessionId: refresh.sessionId,
      refreshTokenHash: hash,
      userId: "user-1",
      schoolCode: SCHOOL_CODE,
      role: "teacher",
      expiresAt: refresh.expiresAt,
    });

    const activeBefore = await repo.findActiveSession(refresh.sessionId, hash);
    assert.ok(activeBefore);

    await repo.revokeSession(refresh.sessionId, "logout");

    const activeAfter = await repo.findActiveSession(refresh.sessionId, hash);
    assert.equal(activeAfter, null);
  });

  it("rejette une session expirée", async () => {
    const repo = new FallbackRepository();
    await repo.init();

    const sessionId = "expired-session";
    const hash = tokenService.hashToken("expired-refresh-token");

    await repo.createSession({
      sessionId,
      refreshTokenHash: hash,
      userId: "user-1",
      schoolCode: SCHOOL_CODE,
      role: "teacher",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const session = await repo.findActiveSession(sessionId, hash);
    assert.equal(session, null);
  });
});

describe("Vérification des secrets hashés", () => {
  it("accepte un mot de passe hashé", () => {
    const hashedTeacher = {
      ...activeTeacher,
      password: undefined,
      passwordHash: hashSecret("Secret123"),
    };
    const auth = makeAuthService({ userAccounts: [hashedTeacher] });
    const result = auth.login({
      role: "teacher",
      schoolCode: SCHOOL_CODE,
      identifier: "prof@ecole.app",
      pin: "Secret123",
    });

    assert.equal(result.user.id, hashedTeacher.id);
  });
});
