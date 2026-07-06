/**
 * Jeu de données de test : bulletins, notes, planning, config académique.
 */
const { buildBulkPlatformSeed } = require("./bulkPlatformSeed");
const { enrichPlatformBulletinData } = require("./bulletinSeedData");
const { buildAcademicConfigsFromState, enrichPlatformPlanningData } = require("./planningSeedData");

const PEDAGOGY_ENTITIES = ["classes", "courses", "assignments", "notes", "bulletins", "courseSchedules"];

function collectSchoolCodes(state = {}) {
  return [
    ...new Set([
      ...(state.students ?? []).map((row) => row.schoolCode).filter(Boolean),
      ...(state.platformSchools ?? state.schools ?? [])
        .map((row) => row.code ?? row.schoolCode)
        .filter(Boolean),
    ]),
  ];
}

function mergeEntityRowsForSchools(existingRows = [], seedRows = [], schoolCodes = new Set()) {
  const preserved = existingRows.filter((row) => !schoolCodes.has(row.schoolCode));
  const seeded = seedRows.filter((row) => schoolCodes.has(row.schoolCode));
  return [...preserved, ...seeded];
}

function clearPedagogyDeletedRows(deletedRows = {}) {
  const next = { ...deletedRows };
  PEDAGOGY_ENTITIES.forEach((entity) => {
    delete next[entity];
  });
  return next;
}

function restorePedagogyEntitiesFromBulkSeed(state = {}) {
  const schoolCodes = collectSchoolCodes(state);
  if (!schoolCodes.length) return state;

  const schoolCodeSet = new Set(schoolCodes);
  const hasClasses = (state.classes ?? []).some((row) => schoolCodeSet.has(row.schoolCode));
  const hasCourses = (state.courses ?? []).some((row) => schoolCodeSet.has(row.schoolCode));
  const deletedClasses = (state.deletedRows?.classes ?? []).length;
  const deletedCourses = (state.deletedRows?.courses ?? []).length;

  if (hasClasses && hasCourses && !deletedClasses && !deletedCourses) {
    return state;
  }

  const seed = buildBulkPlatformSeed();

  return {
    ...state,
    classes: mergeEntityRowsForSchools(state.classes ?? [], seed.classes ?? [], schoolCodeSet),
    courses: mergeEntityRowsForSchools(state.courses ?? [], seed.courses ?? [], schoolCodeSet),
    assignments: mergeEntityRowsForSchools(state.assignments ?? [], seed.assignments ?? [], schoolCodeSet),
    deletedRows: clearPedagogyDeletedRows(state.deletedRows ?? {}),
  };
}

function enrichPlatformTestData(state = {}, options = {}) {
  const periods = options.periods ?? ["Trimestre 1"];
  const withBulletins = options.withBulletins !== false;
  const withPlanning = options.withPlanning !== false;
  const withAcademicConfig = options.withAcademicConfig !== false;

  let next = restorePedagogyEntitiesFromBulkSeed({ ...state });

  if (withBulletins) {
    next = enrichPlatformBulletinData(next, periods);
  }

  if (withPlanning) {
    next = enrichPlatformPlanningData(next, {
      weekStart: options.weekStart,
      maxClasses: options.maxClasses,
    });
  }

  if (withAcademicConfig) {
    next = {
      ...next,
      academicConfigs: {
        ...(next.academicConfigs ?? {}),
        ...buildAcademicConfigsFromState(next),
      },
    };
  }

  return {
    ...next,
    deletedRows: clearPedagogyDeletedRows(next.deletedRows ?? {}),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { enrichPlatformTestData, restorePedagogyEntitiesFromBulkSeed };
