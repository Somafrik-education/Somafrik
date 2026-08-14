"use strict";

const DOMAIN_TO_RECORD = Object.freeze({
  exam: "exam",
  exams: "exam",
  bulletin: "bulletin",
  bulletins: "bulletin",
  document: "document",
  documents: "document",
});

function normalizeDomain(domain) {
  return DOMAIN_TO_RECORD[domain] ?? domain;
}

async function recordResidualReplace(repository, domain, schoolCode, items, principal, auditMeta) {
  const recordDomain = normalizeDomain(domain);
  if (!["exam", "bulletin", "document"].includes(recordDomain)) {
    const error = new Error("Domaine résiduel inconnu.");
    error.statusCode = 400;
    throw error;
  }

  const scopedSchoolCode = String(schoolCode ?? principal?.schoolCode ?? "").trim().toUpperCase();
  if (!scopedSchoolCode || scopedSchoolCode === "*") {
    const error = new Error("schoolCode établissement requis.");
    error.statusCode = 400;
    throw error;
  }

  if (typeof repository.getResidualStore !== "function") {
    const error = new Error("Persistance résiduelle indisponible.");
    error.statusCode = 503;
    throw error;
  }

  const run = async (tx) => {
    const scope = typeof repository.createTxScope === "function" ? repository.createTxScope(tx) : repository;
    const store = repository.getResidualStore();
    const result = await store.replaceDomainRecords(recordDomain, scopedSchoolCode, items ?? [], tx);
    if (typeof scope.recordAudit === "function" && auditMeta) {
      await scope.recordAudit(
        {
          schoolCode: scopedSchoolCode,
          userId: auditMeta.userId,
          action: `replace_residual_${recordDomain}`,
          entityType: recordDomain,
          entityId: scopedSchoolCode,
          newValue: { count: result.length },
          ipAddress: auditMeta.ipAddress ?? "",
          userAgent: auditMeta.userAgent ?? "",
        },
        tx,
      );
    }
    return result;
  };

  const saved =
    typeof repository.withTransaction === "function"
      ? await repository.withTransaction(run)
      : await run(null);

  if (typeof repository.invalidateCachedDataset === "function") {
    repository.invalidateCachedDataset();
  } else {
    repository.cachedDataset = null;
  }

  return saved;
}

module.exports = {
  DOMAIN_TO_RECORD,
  normalizeDomain,
  recordResidualReplace,
};
