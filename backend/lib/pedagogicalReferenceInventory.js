"use strict";

/**
 * PR-0 — Inventaire lecture seule des référentiels pédagogiques.
 *
 * Aucun INSERT / UPDATE / DELETE / migration.
 * Les classifications proposées sont des hypothèses CTO, jamais appliquées.
 * Toute valeur de la liste de signalement est AMBIGUË → STOP.
 */

const REQUIRED_TABLES = Object.freeze([
  "countries",
  "schools",
  "academic_years",
  "education_levels",
  "education_streams",
  "education_class_groups",
  "school_streams",
  "school_class_groups",
  "classes",
]);

const WRITE_FLAG_ARGS = Object.freeze(["--apply", "--write", "--fix", "--migrate", "--backfill"]);
const WRITE_ENV_KEYS = Object.freeze([
  "SOMAFRIK_PEDAGOGICAL_BACKFILL",
  "SOMAFRIK_PEDAGOGICAL_REFERENCE_BACKFILL",
]);

const SQL_WRITE_TOKEN = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL)\b/i;

const STREAM_WATCHLIST = Object.freeze([
  {
    id: "biochimie",
    labels: ["bio-chimie", "biochimie", "bio chimie", "chimie-biologie", "chimie biologie"],
    proposedClassification: "option (RDC historique, enfant de la section Scientifique)",
    reason:
      "Vocabulaire officiel RDC = option d’une section, pas une filière. Options Biochimie / Math-Physique supprimées par arrêté MINEPSP/CABMIN/600/2019. Aucune conversion automatique.",
  },
  {
    id: "math-physique",
    labels: [
      "math-physique",
      "math physique",
      "mathematique-physique",
      "mathematique physique",
      "mathématique-physique",
    ],
    proposedClassification: "option (RDC historique, enfant de la section Scientifique)",
    reason:
      "Même famille que Bio-chimie : option historique, pas une filière. Aucune conversion automatique.",
  },
  {
    id: "scientifique",
    labels: ["scientifique"],
    proposedClassification: "section (RDC humanités) — à confirmer pays par pays",
    reason:
      "En RDC post-2019 la section scientifique remplace les options. Ailleurs le mot peut désigner une série. STOP.",
  },
  {
    id: "sciences",
    labels: ["sciences"],
    proposedClassification: "ambigu — seed démo vs section/série nationale",
    reason: "Présent dans DEMO_TRACKS, distinct de « Scientifique ». STOP, pas de mapping silencieux.",
  },
  {
    id: "generale",
    labels: ["generale", "générale"],
    proposedClassification: "ambigu — seed démo vs humanités générales",
    reason:
      "« Générale » n’est pas une section officielle RDC. Humanités générales est une famille, pas une orientation de classe. STOP.",
  },
]);

const GROUP_WATCHLIST = Object.freeze([
  {
    id: "confession",
    pattern: /\bconfession/,
    proposedClassification: "hors Groupe — régime / réseau d’établissement",
    reason: "Une confession n’est pas une division A/B/C.",
  },
  {
    id: "catholique",
    pattern: /\bcatholique/,
    proposedClassification: "hors Groupe — régime / réseau d’établissement",
    reason: "Écoles conventionnées catholiques = gestion d’établissement, pas un groupe de classe.",
  },
  {
    id: "protestant",
    pattern: /\bprotestant/,
    proposedClassification: "hors Groupe — régime / réseau d’établissement",
    reason: "Réseau confessionnel, pas une division pédagogique.",
  },
  {
    id: "conventionne",
    pattern: /\bconventionn/,
    proposedClassification: "hors Groupe — régime de gestion",
    reason: "Conventionné / non conventionné décrit l’école, pas la classe.",
  },
  {
    id: "officiel",
    pattern: /\bofficiel/,
    proposedClassification: "hors Groupe — régime de gestion (réseau officiel)",
    reason: "« Officiel » est un régime de gestion RDC, pas un groupe A/B/C.",
  },
]);

const SELECT_REQUIRED_TABLES_SQL = `
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name = ANY($1::text[])
`;

const SELECT_STREAMS_SQL = `
SELECT es.id,
       c.iso_code AS country_code,
       c.name AS country_name,
       es.name,
       es.stream_type,
       es.level_id,
       el.name AS level_name,
       el.level_code,
       es.stream_code,
       es.status,
       es.display_order
  FROM education_streams es
  JOIN countries c ON c.id = es.country_id
  LEFT JOIN education_levels el ON el.id = es.level_id
 ORDER BY c.iso_code, es.stream_type, es.name, es.stream_code
`;

const SELECT_GROUPS_SQL = `
SELECT eg.id,
       c.iso_code AS country_code,
       c.name AS country_name,
       eg.group_code,
       eg.name,
       eg.status,
       eg.display_order
  FROM education_class_groups eg
  JOIN countries c ON c.id = eg.country_id
 ORDER BY c.iso_code, eg.display_order, eg.group_code
`;

const SELECT_SCHOOL_STREAMS_SQL = `
SELECT s.school_code,
       s.name AS school_name,
       c.iso_code AS country_code,
       es.id AS stream_id,
       es.name AS stream_name,
       es.stream_type,
       ss.status AS activation_status
  FROM school_streams ss
  JOIN schools s ON s.id = ss.school_id
  JOIN countries c ON c.id = s.country_id
  JOIN education_streams es ON es.id = ss.stream_id
 ORDER BY s.school_code, es.stream_type, es.name
`;

const SELECT_SCHOOL_GROUPS_SQL = `
SELECT s.school_code,
       s.name AS school_name,
       c.iso_code AS country_code,
       eg.id AS group_id,
       eg.group_code,
       eg.name AS group_name,
       sg.status AS activation_status
  FROM school_class_groups sg
  JOIN schools s ON s.id = sg.school_id
  JOIN countries c ON c.id = s.country_id
  JOIN education_class_groups eg ON eg.id = sg.group_id
 ORDER BY s.school_code, eg.display_order, eg.group_code
`;

const SELECT_CLASSES_SQL = `
SELECT cl.class_code,
       s.school_code,
       s.name AS school_name,
       ay.name AS academic_year_name,
       cl.academic_year_id,
       cl.level_id,
       el.name AS level_name,
       cl.stream_id,
       es.name AS stream_name,
       es.stream_type,
       cl.group_id,
       cl.group_code,
       eg.name AS group_name,
       cl.name AS class_name,
       cl.status
  FROM classes cl
  JOIN schools s ON s.id = cl.school_id
  LEFT JOIN academic_years ay ON ay.id = cl.academic_year_id
  LEFT JOIN education_levels el ON el.id = cl.level_id
  LEFT JOIN education_streams es ON es.id = cl.stream_id
  LEFT JOIN education_class_groups eg ON eg.id = cl.group_id
 ORDER BY s.school_code, ay.name, cl.class_code
`;

const SELECT_NULL_GROUP_COUNT_SQL = `
SELECT COUNT(*)::int AS count
  FROM classes
 WHERE group_id IS NULL
`;

const SELECT_NULL_GROUP_STRUCTURAL_DUPLICATES_SQL = `
SELECT s.school_code,
       ay.name AS academic_year_name,
       cl.level_id,
       el.name AS level_name,
       cl.stream_id,
       es.name AS stream_name,
       COUNT(*)::int AS duplicate_count,
       ARRAY_AGG(cl.class_code ORDER BY cl.class_code) AS class_codes
  FROM classes cl
  JOIN schools s ON s.id = cl.school_id
  LEFT JOIN academic_years ay ON ay.id = cl.academic_year_id
  LEFT JOIN education_levels el ON el.id = cl.level_id
  LEFT JOIN education_streams es ON es.id = cl.stream_id
 WHERE cl.group_id IS NULL
   AND cl.level_id IS NOT NULL
 GROUP BY s.school_code, ay.name, cl.level_id, el.name, cl.stream_id, es.name
HAVING COUNT(*) > 1
 ORDER BY s.school_code, ay.name, el.name, es.name
`;

const ALL_INVENTORY_SQL = Object.freeze([
  SELECT_REQUIRED_TABLES_SQL,
  SELECT_STREAMS_SQL,
  SELECT_GROUPS_SQL,
  SELECT_SCHOOL_STREAMS_SQL,
  SELECT_SCHOOL_GROUPS_SQL,
  SELECT_CLASSES_SQL,
  SELECT_NULL_GROUP_COUNT_SQL,
  SELECT_NULL_GROUP_STRUCTURAL_DUPLICATES_SQL,
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripSqlComments(sql) {
  return String(sql ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function assertSelectOnlySql(sql) {
  const text = stripSqlComments(sql);
  if (SQL_WRITE_TOKEN.test(text)) {
    throw new Error("SQL d'inventaire invalide : jeton d'écriture détecté.");
  }
  if (!/\bSELECT\b/i.test(text)) {
    throw new Error("SQL d'inventaire invalide : SELECT obligatoire.");
  }
}

function assertInventorySqlIsSelectOnly(sqlList = ALL_INVENTORY_SQL) {
  for (const sql of sqlList) {
    assertSelectOnlySql(sql);
  }
}

function assertNoWriteFlags(argv = process.argv, env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  const flaggedArg = args.find((arg) => WRITE_FLAG_ARGS.includes(String(arg)));
  if (flaggedArg) {
    const error = new Error(
      `Inventaire SELECT-only : drapeau d'écriture refusé (${flaggedArg}). Aucune correction automatique.`,
    );
    error.code = "PEDAGOGICAL_INVENTORY_WRITE_REFUSED";
    throw error;
  }
  for (const key of WRITE_ENV_KEYS) {
    const raw = asTrimmed(env?.[key]);
    if (raw && raw !== "0" && raw.toLowerCase() !== "false") {
      const error = new Error(
        `Inventaire SELECT-only : variable ${key} refusée. Aucun backfill pédagogique.`,
      );
      error.code = "PEDAGOGICAL_INVENTORY_WRITE_REFUSED";
      throw error;
    }
  }
}

function matchStreamWatch(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  return (
    STREAM_WATCHLIST.find((entry) =>
      entry.labels.some((label) => normalizeName(label) === normalized),
    ) ?? null
  );
}

function matchGroupWatch(name, code) {
  const haystack = `${normalizeName(name)} ${normalizeName(code)}`.trim();
  if (!haystack) return null;
  return GROUP_WATCHLIST.find((entry) => entry.pattern.test(haystack)) ?? null;
}

function looksLikeClassDivision(group) {
  const code = asTrimmed(group?.group_code || group?.code).toUpperCase();
  const name = asTrimmed(group?.name);
  if (!/^[A-Z0-9]{1,3}$/.test(code)) return false;
  if (!name) return true;
  const normalizedName = normalizeName(name);
  const normalizedCode = normalizeName(code);
  return normalizedName === normalizedCode || normalizedName === `groupe ${normalizedCode}`;
}

function classifyStreamRow(row) {
  const watch = matchStreamWatch(row?.name);
  if (watch) {
    return {
      kind: "stream",
      value: asTrimmed(row.name),
      currentType: asTrimmed(row.stream_type) || "inconnu",
      proposedClassification: watch.proposedClassification,
      ambiguous: true,
      stop: true,
      watchId: watch.id,
      reason: watch.reason,
    };
  }
  return {
    kind: "stream",
    value: asTrimmed(row?.name),
    currentType: asTrimmed(row?.stream_type) || "inconnu",
    proposedClassification: "conserver le type actuel jusqu'à revue pays",
    ambiguous: false,
    stop: false,
    watchId: null,
    reason: "Hors liste de signalement PR-0.",
  };
}

function classifyGroupRow(row) {
  const watch = matchGroupWatch(row?.name, row?.group_code ?? row?.code);
  if (watch) {
    return {
      kind: "group",
      value: asTrimmed(row?.name) || asTrimmed(row?.group_code),
      currentType: "groupe",
      proposedClassification: watch.proposedClassification,
      ambiguous: true,
      stop: true,
      watchId: watch.id,
      reason: watch.reason,
    };
  }
  if (looksLikeClassDivision(row)) {
    return {
      kind: "group",
      value: asTrimmed(row?.name) || asTrimmed(row?.group_code),
      currentType: "groupe",
      proposedClassification: "division locale de classe (A/B/C)",
      ambiguous: false,
      stop: false,
      watchId: null,
      reason: "Code court compatible avec une division parallèle.",
    };
  }
  return {
    kind: "group",
    value: asTrimmed(row?.name) || asTrimmed(row?.group_code),
    currentType: "groupe",
    proposedClassification: "à examiner — ne ressemble pas à une division A/B/C",
    ambiguous: true,
    stop: true,
    watchId: "non-division",
    reason: "Nom/code de groupe hors motif A/B/C. STOP, pas d'archivage automatique.",
  };
}

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => asTrimmed(value)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

function buildMatrix({ streams = [], groups = [], classes = [], schoolStreams = [], schoolGroups = [] }) {
  const rows = [];

  for (const stream of streams) {
    const classification = classifyStreamRow(stream);
    const relatedClasses = classes.filter((row) => String(row.stream_id) === String(stream.id));
    const activatedSchools = schoolStreams
      .filter((row) => String(row.stream_id) === String(stream.id))
      .map((row) => row.school_code);
    const classSchools = relatedClasses.map((row) => row.school_code);
    rows.push({
      ...classification,
      id: stream.id,
      countryCode: stream.country_code,
      classCount: relatedClasses.length,
      establishments: uniqueSorted([...activatedSchools, ...classSchools]),
    });
  }

  for (const group of groups) {
    const classification = classifyGroupRow(group);
    if (!classification.stop && !classification.watchId) {
      continue;
    }
    const relatedClasses = classes.filter((row) => String(row.group_id) === String(group.id));
    const activatedSchools = schoolGroups
      .filter((row) => String(row.group_id) === String(group.id))
      .map((row) => row.school_code);
    const classSchools = relatedClasses.map((row) => row.school_code);
    rows.push({
      ...classification,
      id: group.id,
      countryCode: group.country_code,
      classCount: relatedClasses.length,
      establishments: uniqueSorted([...activatedSchools, ...classSchools]),
    });
  }

  return rows;
}

function summarizeReport(input) {
  const matrix = input.matrix || [];
  const stopRows = matrix.filter((row) => row.stop);
  return {
    streamCount: input.streams?.length ?? 0,
    groupCount: input.groups?.length ?? 0,
    schoolStreamActivationCount: input.schoolStreams?.length ?? 0,
    schoolGroupActivationCount: input.schoolGroups?.length ?? 0,
    classCount: input.classes?.length ?? 0,
    classesWithNullGroup: input.classesWithNullGroup ?? 0,
    nullGroupStructuralDuplicateGroups: input.nullGroupStructuralDuplicates?.length ?? 0,
    matrixRowCount: matrix.length,
    stopRowCount: stopRows.length,
    flaggedStreamCount: matrix.filter((row) => row.kind === "stream" && row.stop).length,
    flaggedGroupCount: matrix.filter((row) => row.kind === "group" && row.stop).length,
  };
}

function buildInventoryReport(parts) {
  const matrix = buildMatrix(parts);
  const summary = summarizeReport({ ...parts, matrix });
  const classificationVerdict = summary.stopRowCount > 0 ? "STOP" : "AUCUNE_VALEUR_SIGNALEE";
  return {
    readOnly: true,
    autoMutation: false,
    classificationVerdict,
    uniqueness: {
      classesWithNullGroup: summary.classesWithNullGroup,
      nullGroupStructuralDuplicateGroups: summary.nullGroupStructuralDuplicateGroups,
      note:
        "L'index uq_classes_structural_offering ignore group_id NULL (WHERE group_id IS NOT NULL). " +
        "Ces doublons existent déjà hors contrainte. PR-1 doit corriger l'unicité AVANT d'autoriser les créations sans groupe.",
    },
    summary,
    matrix,
    stopRows: matrix.filter((row) => row.stop),
  };
}

async function inventoryPedagogicalReference(db) {
  assertInventorySqlIsSelectOnly();
  const presentRows = await db.all(SELECT_REQUIRED_TABLES_SQL, [REQUIRED_TABLES]);
  const present = new Set((presentRows || []).map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((name) => !present.has(name));
  if (missingTables.length) {
    return {
      schemaReady: false,
      missingTables,
      readOnly: true,
      autoMutation: false,
      classificationVerdict: "STOP",
      summary: { missingTables },
      matrix: [],
      streams: [],
      groups: [],
      schoolStreams: [],
      schoolGroups: [],
      classes: [],
      nullGroupStructuralDuplicates: [],
      diagnostic: `Schéma incomplet : tables absentes ${missingTables.join(", ")}. Aucune écriture.`,
    };
  }

  const [streams, groups, schoolStreams, schoolGroups, classes, nullGroupCountRow, nullGroupStructuralDuplicates] =
    await Promise.all([
      db.all(SELECT_STREAMS_SQL),
      db.all(SELECT_GROUPS_SQL),
      db.all(SELECT_SCHOOL_STREAMS_SQL),
      db.all(SELECT_SCHOOL_GROUPS_SQL),
      db.all(SELECT_CLASSES_SQL),
      db.one(SELECT_NULL_GROUP_COUNT_SQL),
      db.all(SELECT_NULL_GROUP_STRUCTURAL_DUPLICATES_SQL),
    ]);

  const classesWithNullGroup = Number(nullGroupCountRow?.count ?? 0);
  const built = buildInventoryReport({
    streams,
    groups,
    schoolStreams,
    schoolGroups,
    classes,
    classesWithNullGroup,
    nullGroupStructuralDuplicates,
  });

  return {
    schemaReady: true,
    missingTables: [],
    ...built,
    streams,
    groups,
    schoolStreams,
    schoolGroups,
    classes,
    nullGroupStructuralDuplicates,
    diagnostic:
      built.classificationVerdict === "STOP"
        ? `STOP : ${built.summary.stopRowCount} valeur(s) ambiguë(s). Aucune correction automatique.`
        : "Aucune valeur de la liste de signalement. Inventaire clos sans classification automatique.",
  };
}

function formatMatrixMarkdown(matrix = []) {
  if (!matrix.length) {
    return "_Aucune ligne de matrice (catalogue vide ou schéma incomplet)._\n";
  }
  const lines = [
    "| Valeur | Pays | Type actuel | Classes | Établissements | Classification proposée | Ambiguë |",
    "| --- | --- | --- | ---: | --- | --- | --- |",
  ];
  for (const row of matrix) {
    const establishments = row.establishments?.length ? row.establishments.join(", ") : "—";
    lines.push(
      `| ${row.value || "—"} | ${row.countryCode || "—"} | ${row.currentType} | ${row.classCount} | ${establishments} | ${row.proposedClassification} | ${row.ambiguous ? "oui — STOP" : "non"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatMarkdownReport(report, meta = {}) {
  const generatedAt = meta.generatedAt || new Date().toISOString();
  const lines = [
    "# Inventaire live — référentiels pédagogiques (PR-0)",
    "",
    `Généré : ${generatedAt}`,
    `Cible : ${meta.databaseUrlRedacted || "non connecté"}`,
    `Verdict classification : **${report.classificationVerdict}**`,
    "",
    "Lecture seule. Aucune écriture SQL. Aucune migration de données.",
    "",
    "## Synthèse",
    "",
    `- Streams : ${report.summary?.streamCount ?? 0}`,
    `- Groupes : ${report.summary?.groupCount ?? 0}`,
    `- Activations streams : ${report.summary?.schoolStreamActivationCount ?? 0}`,
    `- Activations groupes : ${report.summary?.schoolGroupActivationCount ?? 0}`,
    `- Classes : ${report.summary?.classCount ?? 0}`,
    `- Classes ` + "`group_id IS NULL`" + ` : ${report.summary?.classesWithNullGroup ?? 0}`,
    `- Doublons structurels à groupe NULL : ${report.summary?.nullGroupStructuralDuplicateGroups ?? 0}`,
    `- Lignes STOP : ${report.summary?.stopRowCount ?? 0}`,
    "",
    "## Matrice",
    "",
    formatMatrixMarkdown(report.matrix),
    "",
    "## Doublons structurels (group_id NULL)",
    "",
  ];

  const dupes = report.nullGroupStructuralDuplicates || [];
  if (!dupes.length) {
    lines.push("Aucun groupe de classes identiques avec `group_id IS NULL`.", "");
  } else {
    lines.push(
      "| Établissement | Année | Niveau | Stream | n | class_code |",
      "| --- | --- | --- | --- | ---: | --- |",
    );
    for (const row of dupes) {
      const codes = Array.isArray(row.class_codes) ? row.class_codes.join(", ") : String(row.class_codes ?? "");
      lines.push(
        `| ${row.school_code} | ${row.academic_year_name || "—"} | ${row.level_name || row.level_id || "—"} | ${row.stream_name || "∅"} | ${row.duplicate_count} | ${codes} |`,
      );
    }
    lines.push("");
  }

  if (report.missingTables?.length) {
    lines.push("## Schéma", "", `Tables absentes : ${report.missingTables.join(", ")}`, "");
  }

  lines.push(
    "## Règle",
    "",
    "Toute ligne **oui — STOP** interdit une correction automatique (typage Bio-chimie, archivage Confession catholique, etc.).",
    "PR-1 (groupe nullable + unicité NULL) peut être conçu ensuite, mais ne doit pas classifier ces valeurs.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  REQUIRED_TABLES,
  STREAM_WATCHLIST,
  GROUP_WATCHLIST,
  ALL_INVENTORY_SQL,
  SELECT_REQUIRED_TABLES_SQL,
  SELECT_STREAMS_SQL,
  SELECT_GROUPS_SQL,
  SELECT_SCHOOL_STREAMS_SQL,
  SELECT_SCHOOL_GROUPS_SQL,
  SELECT_CLASSES_SQL,
  SELECT_NULL_GROUP_COUNT_SQL,
  SELECT_NULL_GROUP_STRUCTURAL_DUPLICATES_SQL,
  normalizeName,
  matchStreamWatch,
  matchGroupWatch,
  looksLikeClassDivision,
  classifyStreamRow,
  classifyGroupRow,
  buildMatrix,
  buildInventoryReport,
  inventoryPedagogicalReference,
  formatMatrixMarkdown,
  formatMarkdownReport,
  assertSelectOnlySql,
  assertInventorySqlIsSelectOnly,
  assertNoWriteFlags,
};
