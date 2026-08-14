function readBulletinDesignFromConfig(_config = {}, _className) {
  // LOT 5 : academicConfigs.bulletinDesignByClass n'est plus une source de vérité.
  // Le layout canonique vit dans report_card_templates (PostgreSQL).
  void _config;
  void _className;
  return null;
}

function resolveBulletinDesignForStudent(_state = {}, _student = {}) {
  void _state;
  void _student;
  return null;
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
