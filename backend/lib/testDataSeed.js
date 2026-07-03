/**
 * Jeu de données de test : bulletins, notes, planning, config académique.
 */
const { enrichPlatformBulletinData } = require("./bulletinSeedData");
const { buildAcademicConfigsFromState, enrichPlatformPlanningData } = require("./planningSeedData");

function enrichPlatformTestData(state = {}, options = {}) {
  const periods = options.periods ?? ["Trimestre 1"];
  const withBulletins = options.withBulletins !== false;
  const withPlanning = options.withPlanning !== false;
  const withAcademicConfig = options.withAcademicConfig !== false;

  let next = { ...state };

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
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { enrichPlatformTestData };
