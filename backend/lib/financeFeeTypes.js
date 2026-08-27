"use strict";

/**
 * F2 — Référentiel unique des types de frais (catalogue système).
 * Pas de table PostgreSQL : les types V1 ne sont pas personnalisables par établissement.
 * Identité stable = code (TUITION, …). fee_type TEXT conserve le label FR (snapshot).
 *
 * Source : docs/audits/go-prod-finance-business-domain-audit-2026-08-27.md
 *          docs/audits/finance-f1-domain-invariants-2026-08-27.md
 */

const {
  FORBIDDEN_CANONICAL_FEE_TYPES,
  INVARIANT_ERROR,
  createInvariantError,
  assertNotCanonicalFeeType,
} = require("./financeDomainInvariants");

const FEE_TYPE_ERROR = Object.freeze({
  FORBIDDEN: INVARIANT_ERROR.FORBIDDEN_FEE_TYPE,
  AMBIGUOUS: "FINANCE_FEE_TYPE_AMBIGUOUS",
  UNKNOWN: "FINANCE_FEE_TYPE_UNKNOWN",
  INACTIVE: "FINANCE_FEE_TYPE_INACTIVE",
});

const CANONICAL_FEE_TYPE_CATALOG = Object.freeze([
  Object.freeze({ code: "ENROLLMENT", label: "Inscription", active: true }),
  Object.freeze({ code: "REENROLLMENT", label: "Réinscription", active: true }),
  Object.freeze({ code: "TUITION", label: "Scolarité", active: true }),
  Object.freeze({ code: "EXAM", label: "Examen", active: true }),
  Object.freeze({ code: "UNIFORM", label: "Uniforme", active: true }),
  Object.freeze({ code: "TRANSPORT", label: "Transport", active: true }),
  Object.freeze({ code: "CANTEEN", label: "Cantine", active: true }),
  Object.freeze({ code: "OTHER", label: "Autre", active: true }),
]);

/**
 * Aliases de lecture / migration. Pas une autorité.
 * Mensualité → Scolarité (périodicité, pas un type).
 * Minerval → Scolarité (libellé historique).
 */
const LEGACY_FEE_TYPE_ALIASES = Object.freeze({
  inscription: "ENROLLMENT",
  reinscription: "REENROLLMENT",
  scolarite: "TUITION",
  "scolarite mensualite": "TUITION",
  mensualite: "TUITION",
  minerval: "TUITION",
  "minerval scolarite": "TUITION",
  examen: "EXAM",
  "frais d examen": "EXAM",
  uniforme: "UNIFORM",
  transport: "TRANSPORT",
  "frais de transport": "TRANSPORT",
  cantine: "CANTEEN",
  "frais de cantine": "CANTEEN",
  autre: "OTHER",
  "autre frais": "OTHER",
  "autres frais etablissement": "OTHER",
});

/** Fail closed : pas de mapping automatique. */
const AMBIGUOUS_FEE_TYPE_TOKENS = Object.freeze(["annexe", "bulletin", "frais de bulletin"]);

const UNALLOCATED_FEE_TYPE_TOKENS = Object.freeze(["", "acompte", "non impute"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function feeTypeToken(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function catalogByCode() {
  return new Map(CANONICAL_FEE_TYPE_CATALOG.map((row) => [row.code, row]));
}

function findCatalogEntry(input) {
  const token = feeTypeToken(input);
  if (!token) return null;
  const upper = asTrimmed(input).toUpperCase();
  const byCode = catalogByCode().get(upper);
  if (byCode) return byCode;
  for (const row of CANONICAL_FEE_TYPE_CATALOG) {
    if (feeTypeToken(row.label) === token || feeTypeToken(row.code) === token) return row;
  }
  const mapped = LEGACY_FEE_TYPE_ALIASES[token];
  return mapped ? catalogByCode().get(mapped) : null;
}

function projectCatalog(row) {
  return {
    code: row.code,
    feeType: row.label,
    label: row.label,
    active: row.active !== false,
  };
}

function canonicalFeeTypeCatalog() {
  return CANONICAL_FEE_TYPE_CATALOG.map(projectCatalog);
}

function activeFeeTypeCatalog() {
  return canonicalFeeTypeCatalog().filter((row) => row.active);
}

function isUnallocatedFeeTypeInput(value) {
  return UNALLOCATED_FEE_TYPE_TOKENS.includes(feeTypeToken(value));
}

function resolveFeeType(input, { mode = "read" } = {}) {
  const raw = asTrimmed(input);
  if (mode === "write") {
    assertNotCanonicalFeeType(raw);
  } else if (FORBIDDEN_CANONICAL_FEE_TYPES.some((item) => feeTypeToken(item) === feeTypeToken(raw))) {
    return null;
  }

  if (!raw) {
    if (mode === "write") {
      throw createInvariantError("Type de frais requis.", FEE_TYPE_ERROR.UNKNOWN, { feeType: raw });
    }
    return null;
  }

  const token = feeTypeToken(raw);
  if (AMBIGUOUS_FEE_TYPE_TOKENS.includes(token)) {
    if (mode === "write") {
      throw createInvariantError(
        "Type de frais ambigu (Annexe / Bulletin). Choisissez une catégorie canonique.",
        FEE_TYPE_ERROR.AMBIGUOUS,
        { feeType: raw },
      );
    }
    return null;
  }

  const row = findCatalogEntry(raw);
  if (!row) {
    if (mode === "write") {
      throw createInvariantError("Type de frais inconnu.", FEE_TYPE_ERROR.UNKNOWN, { feeType: raw });
    }
    return null;
  }
  if (mode === "write" && row.active === false) {
    throw createInvariantError("Type de frais inactif.", FEE_TYPE_ERROR.INACTIVE, { feeType: raw, code: row.code });
  }
  return projectCatalog(row);
}

function persistableFeeType(input) {
  return resolveFeeType(input, { mode: "write" }).feeType;
}

function isTuitionFeeType(input) {
  const row = resolveFeeType(input, { mode: "read" });
  return row?.code === "TUITION";
}

module.exports = {
  FEE_TYPE_ERROR,
  CANONICAL_FEE_TYPE_CATALOG,
  LEGACY_FEE_TYPE_ALIASES,
  AMBIGUOUS_FEE_TYPE_TOKENS,
  feeTypeToken,
  canonicalFeeTypeCatalog,
  activeFeeTypeCatalog,
  isUnallocatedFeeTypeInput,
  resolveFeeType,
  persistableFeeType,
  isTuitionFeeType,
  projectCatalog,
};
