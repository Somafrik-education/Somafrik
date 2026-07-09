/**
 * Contrat UI/UX — parcours Classes → Élèves → Détail élève (admin établissement).
 */

export const CLASSES_STUDENT_COPY = {
  classesTitle: "Classes",
  studentsSectionTitle: "Liste des élèves",
  studentsEmptyClass: "Aucun élève disponible",
  studentsEmptySearch: "Aucun élève trouvé",
  addStudentAction: "Ajouter un élève",
  notesAction: "Notes",
  presencesAction: "Présences",
  paymentsAction: "Paiements",
} as const;

export const CLASSES_STUDENT_TEST_IDS = {
  classesScreen: "classes-screen",
  classesTitle: "classes-title",
  classCardPrefix: "class-card-",
  studentsScreen: "students-screen",
  studentsBackButton: "students-back-button",
  studentsTitle: "students-title",
  studentsSectionTitle: "students-section-title",
  studentsList: "students-list",
  studentsCount: "students-count",
  studentsEmpty: "students-empty",
  studentsAddButton: "students-add-button",
  studentRowPrefix: "student-row-",
  studentDetailScreen: "student-detail-screen",
  studentDetailBackButton: "student-detail-back-button",
  studentDetailName: "student-detail-name",
  studentDetailClass: "student-detail-class",
  studentDetailNotesButton: "student-detail-notes-button",
  studentDetailPresencesButton: "student-detail-presences-button",
  studentDetailPaymentsButton: "student-detail-payments-button",
  tabClasses: "tab-classes",
} as const;

export const CLASS_CARD_TEST_ID = (className: string) =>
  `${CLASSES_STUDENT_TEST_IDS.classCardPrefix}${slugify(className)}`;

export const STUDENT_ROW_TEST_ID = (studentId: string) =>
  `${CLASSES_STUDENT_TEST_IDS.studentRowPrefix}${studentId}`;

/** Seuil métier — liste longue d'élèves. */
export const LONG_STUDENTS_LIST_MIN_COUNT = 50;

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
