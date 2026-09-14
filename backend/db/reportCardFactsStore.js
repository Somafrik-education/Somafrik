"use strict";

function createReportCardFactsPgStore(db) {
  async function withClient(fn) {
    if (typeof db.connect === "function") {
      const client = await db.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    }
    return fn(db);
  }

  async function listFacts({ schoolId, reportCardId } = {}) {
    return withClient(async (client) => {
      const result = await client.query(
        `SELECT facts FROM report_card_engine_facts
         WHERE school_id = $1 AND report_card_id = $2`,
        [schoolId, reportCardId]
      );
      const row = result.rows[0];
      if (!row || !Array.isArray(row.facts)) return null;
      return row.facts;
    });
  }

  async function upsertFacts({ schoolId, reportCardId, facts } = {}) {
    return withClient(async (client) => {
      await client.query(
        `INSERT INTO report_card_engine_facts (school_id, report_card_id, facts, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (school_id, report_card_id)
         DO UPDATE SET facts = EXCLUDED.facts, updated_at = NOW()`,
        [schoolId, reportCardId, JSON.stringify(facts || [])]
      );
      return facts;
    });
  }

  return { listFacts, upsertFacts };
}

function createMemoryFactsStore(seed = []) {
  const map = new Map();
  for (const row of seed) {
    map.set(`${row.schoolId}\0${row.reportCardId}`, row.facts);
  }
  return {
    listFacts({ schoolId, reportCardId } = {}) {
      return map.get(`${schoolId}\0${reportCardId}`) || null;
    },
    upsertFacts({ schoolId, reportCardId, facts } = {}) {
      map.set(`${schoolId}\0${reportCardId}`, facts);
      return facts;
    },
  };
}

module.exports = { createReportCardFactsPgStore, createMemoryFactsStore };
