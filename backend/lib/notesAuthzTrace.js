/**
 * Trace de causalité — autorisation POST /api/notes (enseignant).
 *
 * Activée uniquement si SOMAFRIK_AUTHZ_TRACE=1.
 * Ne constitue PAS une validation CTO ; sert l'audit de causalité Pré-E1.
 *
 * Fichier optionnel : SOMAFRIK_AUTHZ_TRACE_FILE (défaut docs/audits/evidence/notes-authz-trace.jsonl)
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "audits",
  "evidence",
  "notes-authz-trace.jsonl",
);

function isEnabled() {
  return String(process.env.SOMAFRIK_AUTHZ_TRACE || "").trim() === "1";
}

function createNotesAuthzTrace(seed = {}) {
  if (!isEnabled()) return null;
  return {
    kind: "NOTES_AUTHZ_CAUSALITY",
    notACtoValidation: true,
    startedAt: new Date().toISOString(),
    route: "POST /api/notes",
    principal: {
      sub: seed.principal?.sub ?? null,
      role: seed.principal?.role ?? null,
      schoolCode: seed.principal?.schoolCode ?? null,
      classNames: Array.isArray(seed.principal?.classNames)
        ? [...seed.principal.classNames]
        : [],
      identifier: seed.principal?.identifier ?? null,
    },
    payload: {
      studentId: seed.payload?.studentId ?? null,
      className: seed.payload?.className ?? null,
      subject: seed.payload?.subject ?? null,
      schoolCode: seed.payload?.schoolCode ?? null,
      evaluationId: seed.payload?.evaluationId ?? null,
    },
    steps: [],
    decision: null,
    grantedBy: null,
  };
}

function pushStep(trace, step) {
  if (!trace) return;
  trace.steps.push({
    at: new Date().toISOString(),
    ...step,
  });
}

function finalizeTrace(trace, { allowed, grantedBy, denyReason = null } = {}) {
  if (!trace) return null;
  trace.finishedAt = new Date().toISOString();
  trace.decision = allowed ? "ALLOW" : "DENY";
  trace.grantedBy = allowed ? grantedBy ?? "unknown" : null;
  trace.denyReason = allowed ? null : denyReason;
  return trace;
}

function persistTrace(trace) {
  if (!trace || !isEnabled()) return;
  const file = String(process.env.SOMAFRIK_AUTHZ_TRACE_FILE || DEFAULT_FILE).trim();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(trace)}\n`, "utf8");
  } catch (error) {
    console.error("[notesAuthzTrace] persist failed:", error?.message || error);
  }
}

module.exports = {
  isEnabled,
  createNotesAuthzTrace,
  pushStep,
  finalizeTrace,
  persistTrace,
};
