function readBulletinDesignFromConfig(config = {}, className) {
  const designs = config.bulletinDesignByClass;
  if (!designs || typeof designs !== "object" || Array.isArray(designs)) {
    return null;
  }
  const row = designs[className];
  return row && typeof row === "object" && !Array.isArray(row) ? row : null;
}

function resolveBulletinDesignForStudent(state = {}, student = {}) {
  const schoolCode = String(student.schoolCode ?? student.school?.code ?? "").trim();
  const className = String(student.className ?? student.class?.name ?? "").trim();
  if (!schoolCode || !className) {
    return null;
  }
  const config = state.academicConfigs?.[schoolCode] ?? {};
  return readBulletinDesignFromConfig(config, className);
}

function applyBulletinDesignToReport(report = {}, design) {
  if (!design) {
    return report;
  }

  const enabled = Array.isArray(design.enabledSubjects)
    ? design.enabledSubjects.filter(Boolean)
    : [];
  let subjects = Array.isArray(report.subjects) ? report.subjects : [];

  if (enabled.length) {
    const allowed = new Set(enabled);
    subjects = subjects.filter((row) => allowed.has(row.subject));
  }

  return {
    ...report,
    design,
    subjects,
    period: design.periodLabel ?? report.period,
  };
}

module.exports = {
  applyBulletinDesignToReport,
  readBulletinDesignFromConfig,
  resolveBulletinDesignForStudent,
};
