import { HELP_CATEGORY, HELP_CATEGORY_LABELS, HELP_CATEGORY_ORDER } from "./constants.js";

const PREFIX_CATEGORY = Object.freeze([
  ["help/start/", HELP_CATEGORY.DEMARRAGE],
  ["help/dashboard/", HELP_CATEGORY.DEMARRAGE],
  ["help/parent/", HELP_CATEGORY.DEMARRAGE],
  ["help/student/", HELP_CATEGORY.DEMARRAGE],
  ["help/classes/", HELP_CATEGORY.SCOLARITE],
  ["help/students/", HELP_CATEGORY.SCOLARITE],
  ["help/teachers/", HELP_CATEGORY.ENSEIGNANTS],
  ["help/users/", HELP_CATEGORY.UTILISATEURS],
  ["help/rbac/", HELP_CATEGORY.UTILISATEURS],
  ["help/attendance/", HELP_CATEGORY.PRESENCES],
  ["help/grades/", HELP_CATEGORY.PEDAGOGIE],
  ["help/exams/", HELP_CATEGORY.PEDAGOGIE],
  ["help/planning/", HELP_CATEGORY.PEDAGOGIE],
  ["help/report-cards/", HELP_CATEGORY.PEDAGOGIE],
  ["help/platform/", HELP_CATEGORY.ETABLISSEMENT],
  ["help/payments/", HELP_CATEGORY.FINANCE],
  ["help/communication/", HELP_CATEGORY.COMMUNICATION],
  ["help/account/", HELP_CATEGORY.COMPTE],
  ["help/sync/", HELP_CATEGORY.COMPTE],
  ["help/assistance/", HELP_CATEGORY.ASSISTANCE],
]);

const CATEGORY_BY_ID = Object.freeze(
  Object.assign(Object.create(null), {
    "help/settings/overview": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/profile": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/profile-edit": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/academic-year": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/academic-year-create": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/academic-year-current": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/academic-periods": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/academic-periods-edit": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/grading-configuration": HELP_CATEGORY.PEDAGOGIE,
    "help/settings/grading-configuration-edit": HELP_CATEGORY.PEDAGOGIE,
    "help/settings/pedagogical-structure": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/pedagogical-structure-activate": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/school-courses-create": HELP_CATEGORY.PEDAGOGIE,
    "help/settings/school-courses-edit": HELP_CATEGORY.PEDAGOGIE,
    "help/settings/roles-permissions": HELP_CATEGORY.UTILISATEURS,
    "help/settings/finance": HELP_CATEGORY.FINANCE,
    "help/settings/finance-fee-grid-create": HELP_CATEGORY.FINANCE,
    "help/settings/finance-fee-grid-update": HELP_CATEGORY.FINANCE,
    "help/settings/data-export": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/subscription": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/security": HELP_CATEGORY.COMPTE,
    "help/settings/coming-soon": HELP_CATEGORY.ETABLISSEMENT,
    "help/settings/notifications": HELP_CATEGORY.COMMUNICATION,
    "help/settings/notifications-edit": HELP_CATEGORY.COMMUNICATION,
    "help/start/school-setup": HELP_CATEGORY.DEMARRAGE,
    "help/start/quick-config": HELP_CATEGORY.DEMARRAGE,
  }),
);

export function resolveHelpCategory(article) {
  if (article && typeof article.category === "string" && Object.values(HELP_CATEGORY).includes(article.category)) {
    return article.category;
  }
  const id = article && typeof article.id === "string" ? article.id : "";
  if (Object.hasOwn(CATEGORY_BY_ID, id)) return Reflect.get(CATEGORY_BY_ID, id);
  for (const entry of PREFIX_CATEGORY) {
    const prefix = entry[0];
    const category = entry[1];
    if (id.startsWith(prefix)) return category;
  }
  return HELP_CATEGORY.ASSISTANCE;
}

export function helpCategoryLabel(category) {
  return Object.hasOwn(HELP_CATEGORY_LABELS, category) ? Reflect.get(HELP_CATEGORY_LABELS, category) : category;
}

export { HELP_CATEGORY, HELP_CATEGORY_LABELS, HELP_CATEGORY_ORDER };
