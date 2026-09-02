"use strict";

const { createTeacherHttpError } = require("./teachersManagement");
const { assignmentError } = require("./teacherAssignmentsManagement");

function resolveTransactionalScope(db, tx, unavailableError) {
  if (typeof db.createTxScope === "function") {
    const scope = db.createTxScope(tx);
    if (typeof scope.recordAudit === "function") {
      return scope;
    }
  }
  if (tx && typeof tx.recordAudit === "function") {
    return tx;
  }
  if (typeof db.recordAudit === "function") {
    return {
      one: (sql, params) => tx.one(sql, params),
      all: (sql, params) => tx.all(sql, params),
      query: (sql, params) => tx.query(sql, params),
      getSchoolByCode: (code) => (typeof db.getSchoolByCode === "function" ? db.getSchoolByCode(code) : null),
      recordAudit: (payload, innerTx) => db.recordAudit(payload, innerTx ?? tx),
    };
  }
  throw unavailableError;
}

async function writeTransactionalAudit(scope, tx, payload) {
  if (typeof scope.recordAudit !== "function") {
    throw createTeacherHttpError(500, "Audit enseignant indisponible dans la transaction.");
  }
  await scope.recordAudit(
    {
      schoolCode: payload.schoolCode,
      userId: payload.principal?.sub || payload.principal?.id || payload.auditMeta?.userId,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      oldValue: payload.oldValue ?? null,
      newValue: payload.newValue ?? null,
      ipAddress: payload.auditMeta?.ipAddress ?? "",
      userAgent: payload.auditMeta?.userAgent ?? "",
    },
    tx,
  );
}

function teacherAuditScope(db, tx) {
  return resolveTransactionalScope(
    db,
    tx,
    createTeacherHttpError(500, "Audit enseignant indisponible dans la transaction."),
  );
}

function assignmentAuditScope(db, tx) {
  return resolveTransactionalScope(
    db,
    tx,
    assignmentError(500, "Audit affectation indisponible dans la transaction.", "ASSIGNMENT_AUDIT_UNAVAILABLE"),
  );
}

function auditMetaFromRequest(req) {
  return {
    userId: req.principal?.sub || req.principal?.id,
    ipAddress: req.ip,
    userAgent: typeof req.get === "function" ? req.get("user-agent") : "",
  };
}

module.exports = {
  resolveTransactionalScope,
  teacherAuditScope,
  assignmentAuditScope,
  writeTransactionalAudit,
  auditMetaFromRequest,
};
