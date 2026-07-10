/**
 * Validation d'import CSV/Excel — rapport lignes acceptées / rejetées.
 */
const { normalize, normalizeSchoolCode } = require("../lib/dataIntegrityRules");
const { validateEmail } = require("../lib/dataIntegrityRules");

function normalizeHeader(value) {
  return normalize(String(value ?? "").replace(/\s+/g, " "));
}

const STUDENT_IMPORT_ALIASES = {
  schoolcode: ["schoolcode", "code etablissement", "etablissement", "school"],
  lastname: ["lastname", "nom", "name"],
  firstname: ["firstname", "prenom", "first name"],
  className: ["classname", "classe", "class"],
  matricule: ["matricule", "id eleve", "student id", "identifiant"],
  email: ["email", "courriel"],
  phone: ["phone", "telephone", "tel"],
  gender: ["gender", "sexe"],
};

function mapRowHeaders(row = {}) {
  const mapped = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = normalizeHeader(rawKey);
    let target = null;
    for (const [canonical, aliases] of Object.entries(STUDENT_IMPORT_ALIASES)) {
      if (aliases.includes(key)) {
        target = canonical;
        break;
      }
    }
    if (target) mapped[target] = String(rawValue ?? "").trim();
  }
  return mapped;
}

function validateStudentImportRow(row, state = {}, lineNumber) {
  const mapped = mapRowHeaders(row);
  const errors = [];

  if (!mapped.lastname) errors.push("Nom obligatoire");
  if (!mapped.firstname) errors.push("Prénom obligatoire");

  const schoolCode = normalizeSchoolCode(mapped.schoolcode || row.schoolCode);
  if (!schoolCode) {
    errors.push("Établissement obligatoire");
  } else {
    const school = (state.schools ?? []).find(
      (item) => normalizeSchoolCode(item.code) === schoolCode,
    );
    if (!school) errors.push(`Établissement inconnu : ${schoolCode}`);
  }

  if (mapped.className) {
    const classExists = (state.classes ?? []).some(
      (item) =>
        normalize(item.name ?? item.className) === normalize(mapped.className) &&
        (!schoolCode || normalizeSchoolCode(item.schoolCode) === schoolCode),
    );
    if (!classExists) errors.push(`Classe inexistante : ${mapped.className}`);
  }

  if (mapped.email) {
    const emailError = validateEmail(mapped.email);
    if (emailError) errors.push(emailError);
  }

  if (mapped.matricule) {
    const duplicate = (state.students ?? []).find(
      (student) =>
        normalize(student.matricule) === normalize(mapped.matricule) &&
        (!schoolCode || normalizeSchoolCode(student.schoolCode) === schoolCode),
    );
    if (duplicate) errors.push(`Matricule déjà utilisé : ${mapped.matricule}`);
  }

  return {
    line: lineNumber,
    ok: !errors.length,
    errors,
    normalized: {
      schoolCode,
      lastName: mapped.lastname,
      firstName: mapped.firstname,
      className: mapped.className || "",
      matricule: mapped.matricule || "",
      email: mapped.email || "",
      phone: mapped.phone || "",
      gender: mapped.gender || "",
    },
    raw: row,
  };
}

function validateStudentImportRows(rows = [], state = {}) {
  const results = rows.map((row, index) => validateStudentImportRow(row, state, index + 1));
  const accepted = results.filter((row) => row.ok);
  const rejected = results.filter((row) => !row.ok);
  const internalDuplicates = new Map();
  const duplicateLines = [];

  accepted.forEach((row) => {
    const key = `${row.normalized.schoolCode}|${normalize(row.normalized.matricule || `${row.normalized.lastName}|${row.normalized.firstName}`)}`;
    if (internalDuplicates.has(key)) {
      duplicateLines.push(row.line);
    } else {
      internalDuplicates.set(key, row.line);
    }
  });

  const finalRejected = [
    ...rejected,
    ...accepted
      .filter((row) => duplicateLines.includes(row.line))
      .map((row) => ({
        ...row,
        ok: false,
        errors: [...row.errors, "Doublon interne au fichier d'import"],
      })),
  ];
  const finalAccepted = accepted.filter((row) => !duplicateLines.includes(row.line));

  return {
    summary: {
      total: rows.length,
      accepted: finalAccepted.length,
      rejected: finalRejected.length,
      autoCorrected: 0,
    },
    accepted: finalAccepted,
    rejected: finalRejected,
    report: {
      lignesReussies: finalAccepted.length,
      lignesRejetees: finalRejected.length,
      motifs: finalRejected.map((row) => ({ ligne: row.line, erreurs: row.errors })),
      doublonsDetectes: duplicateLines.length,
      donneesCorrigeesAutomatiquement: [],
    },
  };
}

module.exports = {
  mapRowHeaders,
  validateStudentImportRow,
  validateStudentImportRows,
};
