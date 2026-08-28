"use strict";

/**
 * Bootstrap canonique Clients / parent-linking.
 *
 * Ordre unique runtime + tests PG :
 *   CLIENTS_SCHEMA_SQL (tables, SANS index parent-linking)
 *   → ensureParentLinkingConstraints() (inventaire fail-safe → index)
 *   → opérations relationnelles (`insertRelation` ON CONFLICT … WHERE status = 'active')
 *
 * Ne jamais recréer `uq_contacts_school_user_active` /
 * `uq_contact_relations_active` dans CLIENTS_SCHEMA_SQL : un 23505 brut
 * masquerait le diagnostic d'inventaire.
 */

const { CLIENTS_SCHEMA_SQL } = require("./clientsSchema");
const { COMMUNICATIONS_C2_SCHEMA_SQL } = require("./communicationsMessagesSchema");
const { COMMUNICATIONS_C3_SCHEMA_SQL } = require("./communicationsAnnouncementsSchema");
const { ensureParentLinkingConstraints } = require("../lib/parentLinkingConstraints");

function asClientsDb(queryable) {
  if (!queryable || typeof queryable.query !== "function") {
    throw new Error("asClientsDb: queryable.query requis");
  }
  if (typeof queryable.one === "function" && typeof queryable.all === "function") {
    return queryable;
  }
  return {
    query: (sql, params) => queryable.query(sql, params),
    one: async (sql, params) => (await queryable.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await queryable.query(sql, params)).rows,
  };
}

async function applyClientsTablesSchema(queryable) {
  const db = asClientsDb(queryable);
  await db.query(CLIENTS_SCHEMA_SQL);
  return db;
}

async function applyCommunicationsC2Schema(queryable) {
  const db = asClientsDb(queryable);
  await db.query(COMMUNICATIONS_C2_SCHEMA_SQL);
  return db;
}

async function applyCommunicationsC3Schema(queryable) {
  const db = asClientsDb(queryable);
  await db.query(COMMUNICATIONS_C3_SCHEMA_SQL);
  return db;
}

async function ensureClientsCanonicalBootstrap(queryable, logger = console) {
  const db = await applyClientsTablesSchema(queryable);
  await applyCommunicationsC2Schema(db);
  await applyCommunicationsC3Schema(db);
  await ensureParentLinkingConstraints(db, logger);
  return db;
}

module.exports = {
  asClientsDb,
  applyClientsTablesSchema,
  applyCommunicationsC2Schema,
  applyCommunicationsC3Schema,
  ensureClientsCanonicalBootstrap,
};
