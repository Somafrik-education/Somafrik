"use strict";

const crypto = require("crypto");
const { BusinessError } = require("../services/authService");
const { USER_ACCOUNT_STATUSES, softDeleteUserAccount } = require("./userAccountRules");
const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");

const PRIVACY_ERROR = Object.freeze({
  INVALID: "PRIVACY_REQUEST_INVALID",
  NOT_FOUND: "PRIVACY_REQUEST_NOT_FOUND",
  FORBIDDEN: "PRIVACY_REQUEST_FORBIDDEN",
  ALREADY_PROCESSED: "PRIVACY_REQUEST_ALREADY_PROCESSED",
});

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function privacyError(status, message, code) {
  const error = new BusinessError(status, message);
  error.code = code;
  return error;
}

function newRequestCode() {
  return `PRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function sanitizePrivacyRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestCode: row.request_code ?? row.requestCode,
    schoolCode: row.school_code ?? row.schoolCode ?? "",
    identifier: row.identifier ?? "",
    contactEmail: row.contact_email ?? row.contactEmail ?? "",
    roleLabel: row.role_label ?? row.roleLabel ?? "",
    requestType: row.request_type ?? row.requestType ?? "erasure",
    status: row.status,
    reason: row.reason ?? "",
    actorUserId: row.actor_user_id ?? row.actorUserId ?? null,
    processedAt: row.processed_at ?? row.processedAt ?? null,
    createdAt: row.created_at ?? row.createdAt,
  };
}

function assertSchoolScopedPrincipal(principal) {
  const principalSchool = asTrimmed(principal?.schoolCode).toUpperCase();
  if (!principalSchool || principalSchool === "*") {
    throw privacyError(403, "Périmètre établissement insuffisant.", PRIVACY_ERROR.FORBIDDEN);
  }
  return principalSchool;
}

function assertCanExecuteSchoolErasure(principal, schoolCode) {
  if (isPlatformAdminPrincipal(principal)) {
    throw privacyError(
      403,
      "Un administrateur plateforme ne peut pas exécuter l'effacement d'un compte établissement.",
      PRIVACY_ERROR.FORBIDDEN,
    );
  }
  const principalSchool = assertSchoolScopedPrincipal(principal);
  const target = asTrimmed(schoolCode).toUpperCase();
  if (!target || principalSchool !== target) {
    throw privacyError(403, "Périmètre établissement insuffisant.", PRIVACY_ERROR.FORBIDDEN);
  }
}

async function createErasureRequest(repository, payload, principal = null) {
  const schoolCode = asTrimmed(payload.schoolCode).toUpperCase();
  const identifier = asTrimmed(payload.identifier);
  const contactEmail = asTrimmed(payload.contactEmail ?? payload.email);
  const roleLabel = asTrimmed(payload.role ?? payload.roleLabel);
  const reason = asTrimmed(payload.reason).slice(0, 500);

  const fromPrincipal = Boolean(principal?.sub);
  if (!fromPrincipal && (!schoolCode || !identifier)) {
    throw privacyError(
      400,
      "Identifiant et code établissement requis pour une demande non authentifiée.",
      PRIVACY_ERROR.INVALID,
    );
  }

  const row = {
    id: crypto.randomUUID(),
    requestCode: newRequestCode(),
    schoolCode: schoolCode || asTrimmed(principal?.schoolCode).toUpperCase(),
    userId: fromPrincipal ? principal.sub : null,
    identifier: identifier || asTrimmed(principal?.identifier) || asTrimmed(principal?.publicId),
    contactEmail,
    roleLabel: roleLabel || asTrimmed(principal?.role),
    requestType: "erasure",
    status: "pending",
    reason,
  };

  const stored = await repository.createPrivacyRequest(row);
  return sanitizePrivacyRequest(stored ?? row);
}

async function executeErasureRequest(repository, requestId, principal) {
  const request = await repository.getPrivacyRequest(requestId);
  if (!request) {
    throw privacyError(404, "Demande introuvable.", PRIVACY_ERROR.NOT_FOUND);
  }
  if (String(request.status) !== "pending") {
    throw privacyError(409, "Demande déjà traitée.", PRIVACY_ERROR.ALREADY_PROCESSED);
  }

  const schoolCode = request.school_code ?? request.schoolCode;
  const isSelf =
    principal?.sub &&
    String(request.user_id ?? request.userId ?? "") === String(principal.sub);
  if (!isSelf) {
    assertCanExecuteSchoolErasure(principal, schoolCode);
  }

  const targetUserId = request.user_id ?? request.userId ?? (isSelf ? principal.sub : null);
  const result = await repository.executePrivacyErasure({
    requestId: request.id,
    actorUserId: principal.sub,
    userId: targetUserId,
    identifier: request.identifier,
    schoolCode,
  });

  return {
    request: sanitizePrivacyRequest(result?.request ?? { ...request, status: "processed" }),
    sessionsRevoked: Number(result?.sessionsRevoked ?? 0),
    accountAnonymized: result?.accountAnonymized !== false,
    schoolRecordsRetained: true,
  };
}

async function executeSelfErasure(repository, principal) {
  const created = await createErasureRequest(repository, {}, principal);
  return executeErasureRequest(repository, created.id, principal);
}

function anonymizeAccountFields(user = {}) {
  const deleted = softDeleteUserAccount(user, "privacy-erasure");
  return {
    ...deleted,
    status: USER_ACCOUNT_STATUSES.DELETED,
    firstName: "Anonymisé",
    lastName: "Anonymisé",
    email: "",
    phone: "",
    password: "",
    pin: "",
    passwordHash: "",
    pinHash: "",
    temporaryPassword: "",
  };
}

module.exports = {
  PRIVACY_ERROR,
  sanitizePrivacyRequest,
  createErasureRequest,
  executeErasureRequest,
  executeSelfErasure,
  anonymizeAccountFields,
};
