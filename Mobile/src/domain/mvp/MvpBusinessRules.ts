import type { Course, NoteItem, PaymentItem, SchoolClass, SchoolProfile, Student } from "../../data/catalog";

export type MvpModuleStatus = "Formalisé" | "Partiel" | "À formaliser";

export type MvpModule = {
  name: string;
  status: MvpModuleStatus;
  rules: string[];
};

export class StudentLifecycleRules {
  constructor(private readonly students: Student[], private readonly classes: SchoolClass[]) {}

  validateClassAssignment(className: string) {
    if (!this.classes.some((schoolClass) => schoolClass.name === className)) {
      throw new Error("Classe inexistante");
    }
  }

  getAcademicHistory(studentId: string) {
    const student = this.students.find((item) => item.id === studentId);

    if (!student) {
      throw new Error("Élève introuvable");
    }

    return [{
      schoolCode: student.schoolCode,
      className: student.className,
      status: student.archived ? "Archivé" : "Actif",
      year: "2025-2026",
    }];
  }
}

export class SubjectRules {
  constructor(private readonly courses: Course[], private readonly notes: NoteItem[]) {}

  canDeleteSubject(subjectName: string) {
    const used = this.notes.some((note) => note.subject === subjectName);
    return { allowed: !used, reason: used ? "Cours déjà utilisé dans des notes" : "" };
  }

  getSubjectsByClass(className: string) {
    return this.courses.filter((course) => course.className === className);
  }
}

export class FinanceRules {
  constructor(private readonly payments: PaymentItem[]) {}

  getFinancialReport() {
    const paid = this.payments.filter((payment) => payment.status === "PAYE");
    const pending = this.payments.filter((payment) => payment.status !== "PAYE");

    return {
      paidAmount: paid.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      pendingAmount: pending.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      paidCount: paid.length,
      pendingCount: pending.length,
    };
  }
}

export class MvpBusinessRules {
  readonly students: StudentLifecycleRules;
  readonly subjects: SubjectRules;
  readonly finance: FinanceRules;

  constructor(input: {
    school: SchoolProfile;
    students: Student[];
    classes: SchoolClass[];
    courses: Course[];
    notes: NoteItem[];
    payments: PaymentItem[];
  }) {
    this.students = new StudentLifecycleRules(input.students, input.classes);
    this.subjects = new SubjectRules(input.courses, input.notes);
    this.finance = new FinanceRules(input.payments);
  }

  getReadiness(): MvpModule[] {
    return [
      this.module("Élèves / étudiants", "Partiel", ["CRUD", "Affectation classe", "Historique", "Transfert", "Archivage"]),
      this.module("Classes", "Partiel", ["Paramétrage", "Niveaux", "Effectifs", "Année scolaire"]),
      this.module("Cours", "Partiel", ["Création", "Coefficients", "Affectation", "Protection suppression"]),
      this.module("Emplois du temps", "À formaliser", ["Salles", "Conflits horaires", "Consultation par rôle"]),
      this.module("Finances", "Partiel", ["Échéances", "Encaissements", "Historique", "Rapports"]),
      this.module("Parents / tuteurs", "Partiel", ["Liaison enfant", "Résultats", "Présences", "Paiements", "Messages"]),
      this.module("Documents", "Partiel", ["Certificats", "Relevés", "Bulletins PDF", "Attestations"]),
      this.module("Communication", "Partiel", ["Annonces", "Ciblage", "Notifications", "Historique"]),
      this.module("Années académiques", "Formalisé", ["Ouverture", "Fermeture", "Passage", "Archivage"]),
      this.module("Examens", "Partiel", ["Évaluations", "Calendrier", "Résultats", "Publication"]),
      this.module("Bibliothèque", "À formaliser", ["Catalogue", "Emprunts", "Retours", "Retards"]),
      this.module("Transport", "À formaliser", ["Bus", "Circuits", "Affectations", "Paiements"]),
      this.module("Internat", "À formaliser", ["Chambres", "Occupation", "Paiements"]),
      this.module("Rapports", "Partiel", ["Académique", "Financier", "Présence", "Export"]),
      this.module("Rôles mobiles", "Formalisé", ["Enseignant", "Parent", "Élève / Étudiant"]),
      this.module("Synchronisation API", "Formalisé", ["Lecture backend", "Écriture backend", "Rafraîchissement périodique"]),
      this.module("Audit", "Formalisé", ["Journal actions", "Historique modifications", "Connexions"]),
      this.module("Paramètres établissement", "Partiel", ["Logo", "Devise", "Langue", "Fuseau", "Académique", "Financier"]),
      this.module("Sécurité", "Partiel", ["Authentification", "Mot de passe", "Sessions", "Permissions"]),
    ];
  }

  private module(name: string, status: MvpModuleStatus, rules: string[]) {
    return { name, status, rules };
  }
}
