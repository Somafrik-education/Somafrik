"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STUDENT_CARD_BATCHES_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261023_student_card_batches.sql"),
  "utf8",
);

/**
 * Applique les lots seulement lorsque `classes` et `student_access_cards` existent.
 * Le socle des cartes reste applicable sur schools / users / students seuls.
 */
async function ensureStudentCardBatchesSchema(db) {
  if (typeof db?.one !== "function" || typeof db?.query !== "function") {
    throw new Error("PostgreSQL requis pour le schéma des lots de cartes.");
  }
  const required = [
    ["public.classes", "classes"],
    ["public.student_access_cards", "student_access_cards"],
    ["public.schools", "schools"],
    ["public.students", "students"],
    ["public.users", "users"],
  ];
  for (const [regclass, label] of required) {
    const found = await db.one("SELECT to_regclass($1) AS ref", [regclass]);
    if (!found?.ref) {
      const error = new Error(`Schéma ${label} requis avant student_card_batches.`);
      error.code = "STUDENT_CARD_BATCHES_SCHEMA_PREFLIGHT";
      throw error;
    }
  }
  await db.query(STUDENT_CARD_BATCHES_SCHEMA_SQL);
}

module.exports = {
  STUDENT_CARD_BATCHES_SCHEMA_SQL,
  ensureStudentCardBatchesSchema,
};
