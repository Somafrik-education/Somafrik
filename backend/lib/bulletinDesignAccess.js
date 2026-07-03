const BULLETIN_DESIGN_KEYS = ["bulletinDesignByClass", "reportCardMode", "allowCustomReportCards"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripBulletinDesignFields(config = {}) {
  const next = { ...config };
  for (const key of BULLETIN_DESIGN_KEYS) {
    delete next[key];
  }
  return next;
}

function mergeSchoolAcademicConfig(currentConfig = {}, requestedConfig = {}, allowBulletinDesign) {
  if (allowBulletinDesign) {
    return {
      ...currentConfig,
      ...requestedConfig,
    };
  }

  const safeRequested = stripBulletinDesignFields(requestedConfig);
  const merged = {
    ...currentConfig,
    ...safeRequested,
  };

  if (Object.prototype.hasOwnProperty.call(currentConfig, "bulletinDesignByClass")) {
    merged.bulletinDesignByClass = currentConfig.bulletinDesignByClass;
  } else {
    delete merged.bulletinDesignByClass;
  }

  if (Object.prototype.hasOwnProperty.call(currentConfig, "reportCardMode")) {
    merged.reportCardMode = currentConfig.reportCardMode;
  } else {
    delete merged.reportCardMode;
  }

  if (Object.prototype.hasOwnProperty.call(currentConfig, "allowCustomReportCards")) {
    merged.allowCustomReportCards = currentConfig.allowCustomReportCards;
  } else {
    delete merged.allowCustomReportCards;
  }

  return merged;
}

function mergeAcademicConfigs(currentConfigs = {}, requestedConfigs = {}, allowBulletinDesign) {
  const next = { ...currentConfigs };

  for (const [schoolCode, requestedConfig] of Object.entries(requestedConfigs)) {
    if (!isPlainObject(requestedConfig)) continue;
    next[schoolCode] = mergeSchoolAcademicConfig(
      currentConfigs[schoolCode] ?? {},
      requestedConfig,
      allowBulletinDesign,
    );
  }

  return next;
}

module.exports = {
  mergeAcademicConfigs,
  stripBulletinDesignFields,
};
