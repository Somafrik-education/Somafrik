function buildDesignPreviewReport({ school, className, design = {} }) {
  const enabledSubjects = Array.isArray(design.enabledSubjects)
    ? design.enabledSubjects.filter(Boolean)
    : ["Mathématiques", "Français", "Sciences"];

  const subjects = enabledSubjects.map((subject, index) => ({
    subject,
    average: 11.5 + (index % 6),
    coefficient: (index % 3) + 1,
  }));

  const totalPoints = subjects.reduce((sum, row) => sum + row.average * row.coefficient, 0);
  const totalCoefficients = subjects.reduce((sum, row) => sum + row.coefficient, 0);
  const average = totalCoefficients ? totalPoints / totalCoefficients : 0;

  return {
    id: `PREVIEW-${school.code}-${String(className).replace(/\s+/g, "-")}`,
    period: design.periodLabel ?? "Trimestre 1",
    status: "Aperçu",
    student: {
      name: "Élève démonstration",
      matricule: "ELE-PREVIEW",
      className,
    },
    subjects,
    average,
    rankLabel: design.showRank === false ? null : "3e / 28",
    appreciation: design.showAppreciation === false ? null : "Bon travail — aperçu du modèle de bulletin.",
    generatedAt: new Date().toISOString(),
    design,
  };
}

module.exports = {
  buildDesignPreviewReport,
};
