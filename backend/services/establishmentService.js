const { BusinessError } = require("./authService");
const {
  findCanonicalCountry,
  COUNTRY_NOT_FOUND_CODE,
  COUNTRY_NOT_FOUND_MESSAGE,
} = require("../lib/schoolsManagement");
const { schoolMatchesCountryScope } = require("../lib/countryScope");
const {
  allocateNextSchoolLoginCode,
  generateInternalSchoolAlias,
  isLegacySchoolCodeFormat,
  matchesSchoolLookup,
  publicSchoolCodeFromRecord,
} = require("../lib/schoolCodeV2");
const {
  filterActiveSchools,
  withActiveStudentCounts,
  validateSchoolPayload,
  findPotentialDuplicates,
  classifySchoolDuplicates,
  isSchoolDeleted,
  DUPLICATE_STRONG,
  DUPLICATE_CONTACT,
} = require("../lib/schoolModule");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const ESTABLISHMENT_PROFILE_PATCH_FIELDS = new Set([
  "name",
  "type",
  "address",
  "phone",
  "email",
  "logoUrl",
  "principalName",
  "principalEmail",
  "principalPhone",
]);

function isSuperAdmin(principal) {
  return SUPER_ADMIN_ROLES.has(principal?.role);
}

function scopeEstablishments(state, principal) {
  const schools = filterActiveSchools(state.schools ?? []);
  if (!principal || isSuperAdmin(principal)) return schools;
  if (principal.role === "Admin Pays") {
    const scope = principal.countryScope ?? principal.countryCode ?? "";
    return schools.filter((school) => schoolMatchesCountryScope(school, scope));
  }
  const code = String(principal.schoolCode ?? "").trim().toUpperCase();
  return schools.filter((school) => matchesSchoolLookup(school, code));
}

function assertCanAccessEstablishment(principal, school) {
  if (!school || isSchoolDeleted(school)) {
    throw new BusinessError(404, "Établissement introuvable");
  }
  const visible = scopeEstablishments({ schools: [school] }, principal);
  if (!visible.length) {
    throw new BusinessError(403, "Accès refusé à cet établissement");
  }
}

function hasFullEstablishmentManagePermission(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return (
    isSuperAdmin(principal) ||
    principal?.role === "Admin Pays" ||
    permissions.has("ALL_PRIVILEGES") ||
    permissions.has("COUNTRY_PRIVILEGES") ||
    permissions.has("Établissements:CREATE") ||
    permissions.has("Établissements:UPDATE") ||
    permissions.has("Gérer établissements")
  );
}

function hasEstablishmentProfileReadPermission(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return permissions.has("Paramètres Établissement:READ");
}

function hasEstablishmentProfileUpdatePermission(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return permissions.has("Paramètres Établissement:UPDATE");
}

function assertCanReadEstablishment(principal, school) {
  assertCanAccessEstablishment(principal, school);
  if (hasFullEstablishmentManagePermission(principal)) return;
  if (hasEstablishmentProfileReadPermission(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour consulter cet établissement");
}

function assertCanUpdateEstablishment(principal, patch) {
  if (hasFullEstablishmentManagePermission(principal)) return "full";
  if (hasEstablishmentProfileUpdatePermission(principal)) {
    const keys = Object.keys(patch ?? {}).filter((key) => patch[key] !== undefined);
    const forbidden = keys.filter((key) => !ESTABLISHMENT_PROFILE_PATCH_FIELDS.has(key));
    if (forbidden.length) {
      throw new BusinessError(403, `Modification non autorisée : ${forbidden.join(", ")}`);
    }
    return "profile";
  }
  throw new BusinessError(403, "Permission insuffisante pour modifier cet établissement");
}

function filterEstablishmentProfilePatch(patch) {
  const filtered = {};
  for (const key of ESTABLISHMENT_PROFILE_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) {
      filtered[key] = patch[key];
    }
  }
  return filtered;
}

function assertCanManageEstablishments(principal) {
  if (hasFullEstablishmentManagePermission(principal)) return;
  throw new BusinessError(403, "Permission insuffisante pour gérer les établissements");
}

function appendAudit(state, entry) {
  const row = {
    id: `AUDIT-${Date.now().toString(36).toUpperCase()}`,
    at: new Date().toISOString(),
    entityType: "school",
    ...entry,
  };
  const log = Array.isArray(state.auditLog) ? state.auditLog : [];
  return [row, ...log].slice(0, 200);
}

function assertCanonicalCountry(school, state) {
  const canonical = findCanonicalCountry(state.countries, school.countryCode, school.country);
  if (!canonical) {
    const error = new BusinessError(400, COUNTRY_NOT_FOUND_MESSAGE);
    error.code = COUNTRY_NOT_FOUND_CODE;
    throw error;
  }
  school.country = canonical.name;
  school.countryCode = canonical.code;
  return canonical;
}

function hydrateSchoolPayload(payload, state, { isNew = false } = {}) {
  const schools = state.schools ?? [];
  const canonical = findCanonicalCountry(state.countries, payload.countryCode, payload.country);
  const country = canonical?.name ?? payload.country;
  const countryCode = canonical?.code ?? payload.countryCode;
  const requested = String(payload.code ?? "").trim().toUpperCase();
  const name = String(payload.name ?? "").trim();

  let code = requested;
  let loginCode = String(payload.loginCode ?? payload.login_code ?? payload.publicId ?? "").trim().toUpperCase();
  if (isNew) {
    // Client/Web/Mobile n'allouent plus. En mémoire (E2E / fallback) on
    // reflète le trigger PG : SCH-* interne + login_code V2. Jamais CC-YYYY-NNNN.
    code = generateInternalSchoolAlias();
    if (!isLegacySchoolCodeFormat(requested)) {
      loginCode = allocateNextSchoolLoginCode(schools, {
        countryIso: countryCode,
        schoolName: name,
      });
    }
  } else if (!code) {
    code = String(payload.legacySchoolCode ?? "").trim().toUpperCase();
  }

  return {
    ...payload,
    requestedCode: requested,
    code,
    loginCode,
    publicId: loginCode || payload.publicId || code,
    name,
    type: payload.type ?? "Collège",
    country,
    countryCode,
    city: String(payload.city ?? "").trim(),
    phone: String(payload.phone ?? "").trim(),
    email: String(payload.email ?? "").trim(),
    principalName: String(payload.principalName ?? "").trim(),
    principalEmail: String(payload.principalEmail ?? payload.email ?? "").trim(),
    address: payload.address ?? "",
    logoUrl: payload.logoUrl ?? "",
    subscriptionPlan: payload.subscriptionPlan ?? "Standard",
    status: payload.status ?? "Actif",
    validationStatus: payload.validationStatus ?? "Validé",
  };
}

class EstablishmentService {
  list(state, principal) {
    const visibleSchools = scopeEstablishments(state, principal);
    return withActiveStudentCounts(visibleSchools, state.students ?? []);
  }

  get(code, state, principal) {
    const school = (state.schools ?? []).find((item) => matchesSchoolLookup(item, code));
    assertCanReadEstablishment(principal, school);
    return school;
  }

  getUsers(code, state, principal) {
    this.get(code, state, principal);
    const normalized = String(code).trim().toUpperCase();
    return (state.users ?? []).filter(
      (user) => String(user.schoolCode ?? "").trim().toUpperCase() === normalized,
    );
  }

  getSubscription(code, state, principal) {
    const school = this.get(code, state, principal);
    const subscription = (state.subscriptions ?? []).find(
      (row) => String(row.schoolCode ?? "").trim().toUpperCase() === String(code).trim().toUpperCase(),
    );
    return {
      schoolCode: school.code,
      plan: subscription?.plan ?? school.subscriptionPlan,
      status: subscription?.status ?? school.subscriptionStatus,
      paymentStatus: subscription?.paymentStatus,
      lifecycleStatus: subscription?.lifecycleStatus,
      endDate: subscription?.endDate ?? school.subscriptionEndDate,
      subscription,
    };
  }

  create(payload, state, principal, { force = false } = {}) {
    assertCanManageEstablishments(principal);
    const school = hydrateSchoolPayload(payload, state, { isNew: true });
    assertCanonicalCountry(school, state);
    const error = validateSchoolPayload(school, state.schools ?? [], { isNew: true });
    if (error) throw new BusinessError(400, error);

    if (!force) {
      const duplicates = findPotentialDuplicates(school, state.schools ?? []);
      const strong = duplicates.filter((match) => match.level === DUPLICATE_STRONG);
      const contact = duplicates.filter((match) => match.level === DUPLICATE_CONTACT);
      if (strong.length) {
        const error = new BusinessError(409, "Établissement déjà existant dans ce pays (même nom et ville).", {
          duplicates: strong,
        });
        error.code = "SCHOOL_DUPLICATE_STRONG";
        throw error;
      }
      if (contact.length) {
        const error = new BusinessError(409, "Doublon potentiel détecté", { duplicates: contact });
        error.code = "SCHOOL_DUPLICATE_CONTACT";
        throw error;
      }
    } else {
      const strong = classifySchoolDuplicates(school, state.schools ?? []).filter(
        (match) => match.level === DUPLICATE_STRONG,
      );
      if (strong.length) {
        const error = new BusinessError(409, "Établissement déjà existant dans ce pays (même nom et ville).", {
          duplicates: strong,
        });
        error.code = "SCHOOL_DUPLICATE_STRONG";
        throw error;
      }
    }

    if (principal.role === "Admin Pays") {
      school.validationStatus = "En attente de validation";
      school.status = "En attente";
      school.validationRequestedBy = principal.identifier ?? principal.sub ?? "Admin Pays";
      school.validationRequestedAt = new Date().toISOString();
    }

    school.createdAt = new Date().toISOString();
    school.updatedAt = school.createdAt;
    delete school.requestedCode;

    const nextState = {
      ...state,
      schools: [school, ...(state.schools ?? [])],
      auditLog: appendAudit(state, {
        action: "Création établissement",
        entityId: publicSchoolCodeFromRecord(school) || school.code,
        entityLabel: school.name,
        schoolCode: publicSchoolCodeFromRecord(school) || school.code,
        actorId: principal.sub,
        actorName: principal.identifier,
        actorRole: principal.role,
      }),
    };

    return { school, state: nextState };
  }

  update(code, patch, state, principal) {
    const existing = (state.schools ?? []).find((item) => matchesSchoolLookup(item, code));
    assertCanAccessEstablishment(principal, existing);
    const updateMode = assertCanUpdateEstablishment(principal, patch);
    const effectivePatch = updateMode === "profile" ? filterEstablishmentProfilePatch(patch) : patch ?? {};
    const canEditCode = isSuperAdmin(principal);
    const canEditCountry = isSuperAdmin(principal);

    const merged = hydrateSchoolPayload(
      {
        ...existing,
        ...effectivePatch,
        code: canEditCode && effectivePatch.code ? effectivePatch.code : existing.code,
        country: canEditCountry && effectivePatch.country ? effectivePatch.country : existing.country,
        countryCode:
          canEditCountry && effectivePatch.countryCode ? effectivePatch.countryCode : existing.countryCode,
      },
      state,
      { isNew: false },
    );

    const error = validateSchoolPayload(merged, state.schools ?? [], { isNew: false });
    if (error) throw new BusinessError(400, error);
    assertCanonicalCountry(merged, state);

    merged.updatedAt = new Date().toISOString();
    delete merged.requestedCode;

    const nextState = {
      ...state,
      schools: (state.schools ?? []).map((school) => (school.code === existing.code ? merged : school)),
      auditLog: appendAudit(state, {
        action: updateMode === "profile" ? "Modification profil établissement" : "Modification établissement",
        entityId: merged.code,
        entityLabel: merged.name,
        schoolCode: merged.code,
        actorId: principal.sub,
        actorRole: principal.role,
        details: `Mise à jour ${Object.keys(effectivePatch).join(", ")}`,
      }),
    };

    return { school: merged, state: nextState };
  }

  activate(code, state, principal) {
    return this.update(
      code,
      { status: "Actif", validationStatus: "Validé", validatedAt: new Date().toISOString() },
      state,
      principal,
    );
  }

  suspend(code, state, principal) {
    assertCanManageEstablishments(principal);
    const existing = this.get(code, state, principal);
    const merged = { ...existing, status: "Suspendu", updatedAt: new Date().toISOString() };
    const nextState = {
      ...state,
      schools: (state.schools ?? []).map((school) => (school.code === existing.code ? merged : school)),
      auditLog: appendAudit(state, {
        action: "Suspension établissement",
        entityId: merged.code,
        schoolCode: merged.code,
        actorId: principal.sub,
        actorRole: principal.role,
      }),
    };
    return { school: merged, state: nextState };
  }

  softDelete(code, state, principal) {
    if (!isSuperAdmin(principal)) {
      throw new BusinessError(403, "Seul le Super Administrateur peut supprimer un établissement");
    }
    const existing = this.get(code, state, principal);
    const merged = {
      ...existing,
      status: "Supprimé",
      deletedAt: new Date().toISOString(),
      deletedBy: principal.identifier ?? principal.sub,
      updatedAt: new Date().toISOString(),
    };
    const nextState = {
      ...state,
      schools: (state.schools ?? []).map((school) => (school.code === existing.code ? merged : school)),
      auditLog: appendAudit(state, {
        action: "Suppression logique établissement",
        entityId: merged.code,
        schoolCode: merged.code,
        actorId: principal.sub,
        actorRole: principal.role,
      }),
    };
    return { school: merged, state: nextState };
  }

  importRows(rows, state, principal, { force = false } = {}) {
    assertCanManageEstablishments(principal);
    if (!Array.isArray(rows) || !rows.length) {
      throw new BusinessError(400, "Aucune ligne à importer");
    }

    let workingState = { ...state };
    const created = [];
    const errors = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        const result = this.create(row, workingState, principal, { force });
        workingState = result.state;
        created.push(result.school);
      } catch (error) {
        errors.push({
          line: index + 1,
          message: error.message ?? "Erreur",
          row,
        });
      }
    }

    return { created, errors, state: workingState };
  }
}

module.exports = { EstablishmentService };
