"use strict";

/**
 * LOT 9 — orchestration correction serveur.
 * Recalcul LOT 3 + publication LOT 4. Aucune mutation de la version source.
 */

const { computeReportCard } = require("./reportCardEngine");
const { IdempotencyConflict, ReportCardPublicationError } = require("./reportCardPublication");

function requireReason(reason) {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) {
    const err = new ReportCardPublicationError("REASON_REQUIRED");
    throw err;
  }
  return text;
}

function createReportCardCorrection({ publication, getFacts, getProfile, getSchema } = {}) {
  if (!publication || typeof publication.publish !== "function") {
    throw new ReportCardPublicationError("PUBLICATION_REQUIRED");
  }
  const locks = new Map();

  function withLock(lockKey, fn) {
    const previous = locks.get(lockKey) || Promise.resolve();
    const next = previous.then(fn, fn);
    locks.set(
      lockKey,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  async function correct({ tenant, actor, reportCardId, sourceVersion, reason, commandId } = {}) {
    const trimmed = requireReason(reason);
    const schoolId = tenant && tenant.schoolId;
    const lockKey = `${schoolId}\0${reportCardId}`;
    return withLock(lockKey, () => runCorrect({ tenant, actor, reportCardId, sourceVersion, reason: trimmed, commandId, schoolId }));
  }

  async function runCorrect({ tenant, actor, reportCardId, sourceVersion, reason, commandId, schoolId }) {
    if (commandId) {
      const existing = await Promise.resolve(
        publication.findCommand({ tenant, reportCardId, commandId })
      );
      if (existing) {
        if (existing.reason !== reason || Number(existing.source_version) !== Number(sourceVersion)) {
          throw new IdempotencyConflict();
        }
        return publication.lookup({ tenant, reportCardId, version: existing.result_version });
      }
      const recovered = await Promise.resolve(
        typeof publication.findByCommand === "function"
          ? publication.findByCommand({ tenant, reportCardId, commandId })
          : null
      );
      if (recovered) {
        if (recovered.correction_reason && recovered.correction_reason !== reason) {
          throw new IdempotencyConflict();
        }
        if (typeof publication.saveCommand === "function") {
          await Promise.resolve(
            publication.saveCommand({
              tenant,
              reportCardId,
              commandId,
              reason,
              sourceVersion: Number(sourceVersion),
              resultVersion: recovered.published_snapshot_version,
              publicId: recovered.public_id,
            })
          ).catch((err) => {
            if (err instanceof IdempotencyConflict || (err && err.name === "IdempotencyConflict")) throw err;
          });
        }
        return recovered;
      }
    }
    const source = await Promise.resolve(
      publication.lookup({ tenant, reportCardId, version: Number(sourceVersion) })
    );
    if (source.verification_status === "REVOKED") {
      throw new ReportCardPublicationError("INVALID_TRANSITION");
    }
    if (source.verification_status !== "ACTIVE") {
      throw new ReportCardPublicationError("CONCURRENCY_CONFLICT");
    }
    const unscoped = await Promise.resolve(
      publication.payloadForRender({ tenant, reportCardId, version: Number(sourceVersion) })
    );
    if (typeof getFacts !== "function" || typeof getProfile !== "function" || typeof getSchema !== "function") {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const facts = await getFacts({
      tenant,
      schoolId,
      reportCardId,
      sourceVersion: Number(sourceVersion),
    });
    if (!Array.isArray(facts)) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const profile = await getProfile({ tenant, ref: unscoped.provenance && unscoped.provenance.profile });
    const schema = await getSchema({ tenant, ref: unscoped.provenance && unscoped.provenance.schema });
    if (!profile || !schema) {
      throw new ReportCardPublicationError("FACTS_REQUIRED");
    }
    const computed = computeReportCard({
      profile,
      schema,
      facts,
      provenance: unscoped.provenance,
      tenant,
    });
    const payload = {
      report_card_id: unscoped.report_card_id,
      published_snapshot_version: Number(sourceVersion) + 1,
      school_id: unscoped.school_id,
      published_at: new Date().toISOString(),
      engine_id: computed.engine_id,
      provenance: unscoped.provenance,
      students: computed.students,
    };
    let published;
    try {
      published = await Promise.resolve(
        publication.publish({
          tenant,
          payload,
          lineage: {
            corrected_from_version: Number(sourceVersion),
            correction_reason: reason,
            actor_id: actor && actor.actorId,
            command_id: commandId,
          },
          command: commandId
            ? {
                commandId,
                reason,
                sourceVersion: Number(sourceVersion),
              }
            : null,
        })
      );
    } catch (err) {
      if (err instanceof IdempotencyConflict || (err && err.name === "IdempotencyConflict")) {
        throw new ReportCardPublicationError("CONCURRENCY_CONFLICT");
      }
      throw err;
    }
    return published;
  }

  return { correct };
}

module.exports = {
  createReportCardCorrection,
};
