class AuditTrailService {
  constructor(entries = []) {
    this.entries = entries;
  }

  create(action, actorId, entity, entityId, details = {}) {
    const entry = {
      id: `AUD-${Date.now()}`,
      action,
      actorId,
      entity,
      entityId,
      details,
      createdAt: new Date().toISOString(),
    };

    this.entries.push(entry);
    return entry;
  }

  list(entityId) {
    if (!entityId) {
      return this.entries;
    }

    return this.entries.filter((entry) => entry.entityId === entityId);
  }
}

class StudentLifecycleService {
  constructor({ students, classes }) {
    this.students = students;
    this.classes = classes;
  }

  validateClassAssignment(className) {
    if (!this.classes.some((schoolClass) => schoolClass.name === className)) {
      throw new Error("Classe inexistante");
    }
  }

  getAcademicHistory(studentId) {
    const student = this.students.find((item) => item.id === studentId);

    if (!student) {
      throw new Error("Élève introuvable");
    }

    return [
      {
        schoolCode: student.schoolCode,
        className: student.className,
        status: student.archived ? "Archivé" : "Actif",
        year: "2025-2026",
      },
    ];
  }

  prepareTransfer(studentId, targetSchoolCode, targetClassName) {
    const student = this.students.find((item) => item.id === studentId);

    if (!student) {
      throw new Error("Élève introuvable");
    }

    return {
      studentId,
      fromSchoolCode: student.schoolCode,
      fromClassName: student.className,
      targetSchoolCode,
      targetClassName,
      status: "En attente",
    };
  }
}

class ClassManagementService {
  constructor({ classes, students }) {
    this.classes = classes;
    this.students = students;
  }

  getClassSize(className) {
    return this.students.filter((student) => student.className === className && !student.archived).length;
  }

  getClassSummary() {
    return this.classes.map((schoolClass) => ({
      ...schoolClass,
      students: this.getClassSize(schoolClass.name),
      academicYear: "2025-2026",
    }));
  }
}

class SubjectManagementService {
  constructor({ courses, notes }) {
    this.courses = courses;
    this.notes = notes;
  }

  canDeleteSubject(subjectName, className) {
    const used = this.notes.some((note) => note.subject === subjectName);

    return {
      allowed: !used,
      reason: used ? "Matière déjà utilisée dans des notes" : "",
      subjectName,
      className,
    };
  }

  getSubjectsByClass(className) {
    return this.courses.filter((course) => course.className === className);
  }
}

class FinanceService {
  constructor({ payments, students }) {
    this.payments = payments;
    this.students = students;
  }

  getPaymentHistory(studentId) {
    return this.payments.filter((payment) => payment.studentId === studentId);
  }

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

  getStudentBalance(studentId) {
    const annualDue = 40000;
    const studentPayments = this.getPaymentHistory(studentId);
    const paidAmount = studentPayments
      .filter((payment) => payment.status === "PAYE")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return {
      studentId,
      dueAmount: annualDue,
      paidAmount,
      remainingAmount: Math.max(annualDue - paidAmount, 0),
      status: paidAmount >= annualDue ? "Payé" : paidAmount > 0 ? "Partiel" : "Impayé",
    };
  }

  getLatePayers() {
    return this.students
      .filter((student) => !student.archived)
      .map((student) => ({
        ...student,
        balance: this.getStudentBalance(student.id),
      }))
      .filter((student) => student.balance.remainingAmount > 0);
  }
}

class ParentPortalPolicy {
  constructor({ students }) {
    this.students = students;
  }

  getChildren(parentPhone) {
    return this.students.filter((student) => student.parentPhone === parentPhone);
  }

  canAccessChild(parentPhone, studentId) {
    return this.getChildren(parentPhone).some((student) => student.id === studentId);
  }
}

class AcademicYearService {
  getCurrentYear() {
    return {
      id: "YEAR-2025-2026",
      label: "2025-2026",
      status: "Ouverte",
      startDate: "01-09-2025",
      endDate: "31-08-2026",
    };
  }

  canPromoteNextYear() {
    return {
      allowed: true,
      nextYear: "2026-2027",
      requiredActions: ["Archiver les bulletins", "Clôturer les paiements", "Valider les passages"],
    };
  }
}

class DocumentService {
  getTemplates() {
    return [
      { type: "Certificat de scolarité", format: "PDF", status: "À générer" },
      { type: "Relevé de notes", format: "PDF", status: "À générer" },
      { type: "Bulletin", format: "PDF", status: "Structure prête" },
      { type: "Attestation", format: "PDF", status: "À générer" },
    ];
  }
}

class SecurityPolicyService {
  constructor(roleGovernance = null) {
    this.roleGovernance = roleGovernance;
  }

  getPolicy() {
    return {
      authentication: "Identifiant + mot de passe",
      passwordReset: "À formaliser",
      twoFactorAuthentication: "Prévu MVP+",
      sessionManagement: "Session applicative locale",
      rolePermissions: "Matrice Module:ACTION pilotée par RoleGovernanceService",
      countryScopeModules: this.roleGovernance?.countryScopeModules
        ? [...this.roleGovernance.countryScopeModules]
        : ["Pays", "Établissements", "Abonnements", "Utilisateurs"],
      transportEncryption: "HTTPS requis en production",
    };
  }
}

class MobileRolePolicyService {
  getCapabilities() {
    return {
      Enseignant: ["Saisie des notes", "Gestion des présences", "Consultation emploi du temps", "Communication parents"],
      Parent: ["Consultation résultats", "Consultation absences", "Consultation paiements", "Réception notifications"],
      "Élève / Étudiant": ["Consultation notes", "Consultation emploi du temps", "Consultation annonces"],
    };
  }
}

class MvpBusinessService {
  constructor({ school, students, classes, courses, notes, payments }) {
    this.school = school ?? null;
    this.rawStudents = students ?? [];
    this.rawClasses = classes ?? [];
    this.rawCourses = courses ?? [];
    this.rawNotes = notes ?? [];
    this.rawPayments = payments ?? [];
    this.auditTrail = new AuditTrailService([
      {
        id: "AUD-SEED-001",
        action: "Création données MVP",
        actorId: "SYSTEM",
        entity: "School",
        entityId: school?.code ?? "PLATFORM",
        details: { modules: "Socle Somafrik MVP" },
        createdAt: "2026-06-01T08:00:00.000Z",
      },
    ]);
    this.students = new StudentLifecycleService({ students, classes });
    this.classes = new ClassManagementService({ classes, students });
    this.subjects = new SubjectManagementService({ courses, notes });
    this.finance = new FinanceService({ payments, students });
    this.parents = new ParentPortalPolicy({ students });
    this.academicYears = new AcademicYearService();
    this.documents = new DocumentService();
    this.security = new SecurityPolicyService();
    this.mobileRoles = new MobileRolePolicyService();
  }

  attachRoleGovernance(roleGovernance) {
    this.security = new SecurityPolicyService(roleGovernance);
  }

  getReadiness() {
    return {
      schoolCode: this.school?.code ?? "",
      status: "MVP opérationnel démo",
      modules: [
        this.module("Authentification", "Couvert", ["Code établissement", "Détection rôle", "Blocage comptes suspendus", "Redirection par rôle"]),
        this.module("Établissements", "Couvert", ["Création plateforme", "Modification", "Suspension", "Logo", "Paramètres SaaS"]),
        this.module("Utilisateurs", "Couvert", ["Rôles MVP", "Permissions automatiques", "Statuts", "Réinitialisation mot de passe"]),
        this.module("Élèves", "Couvert", ["Matricule", "Parent associé", "Archivage", "Dossier élève"]),
        this.module("Classes", "Couvert", ["Identifiant classe", "Affectations", "Effectifs calculés"]),
        this.module("Enseignants", "Couvert", ["Identifiant", "Matière principale", "Classes affectées", "Filtre par enseignant"]),
        this.module("Présences", "Couvert", ["Appel rapide", "Présent par défaut", "Absent/Retard/Justifié", "Historique", "Rapports"]),
        this.module("Notes simples", "Couvert", ["Évaluations", "Contrôle barème", "Moyennes", "Classement", "Publication"]),
        this.module("Paiements", "Couvert", ["Frais scolaires", "Encaissements", "Restes à payer", "Impayés", "Notifications"]),
        this.module("Notifications", "Couvert", ["Création", "Ciblage MVP", "Historique", "Automatiques"]),
        this.module("Dashboards", "Couvert", ["KPIs établissement", "KPIs pays", "KPIs super admin", "Filtre établissement"]),
        this.module("Super Admin / Admin Pays", "Couvert", ["Pays", "Admin pays", "Établissements", "Suspension", "Statistiques"]),
        this.module("Séparation SaaS", "Couvert", ["Établissement", "Parent-enfant", "Classes enseignant", "Dossier élève", "Pays"]),
        this.module("Mobile / tablette", "Couvert", ["Admin", "Enseignant", "Parent", "Élève", "Menus par rôle"]),
        this.module("Audit simple", "Couvert", ["Connexions", "Modifications d'appel", "Modifications notes", "Actions plateforme"]),
      ],
    };
  }

  getSnapshot() {
    return {
      academicYear: this.academicYears.getCurrentYear(),
      classSummary: this.classes.getClassSummary(),
      financialReport: this.finance.getFinancialReport(),
      documentTemplates: this.documents.getTemplates(),
      mobileCapabilities: this.mobileRoles.getCapabilities(),
      securityPolicy: this.security.getPolicy(),
      establishmentDashboard: this.getEstablishmentDashboard(),
      latePayers: this.finance.getLatePayers(),
      auditLog: this.auditTrail.list(),
    };
  }

  getEstablishmentDashboard() {
    const today = "2026-05-27";
    const activeStudents = this.rawStudents.filter((student) => !student.archived);
    const todaysPresences = [
      { studentId: "1", status: "Présent" },
      { studentId: "2", status: "Présent" },
      { studentId: "3", status: "Retard" },
      { studentId: "4", status: "Absent" },
    ];
    const paidThisMonth = this.rawPayments
      .filter((payment) => payment.date.startsWith("2026-05") && payment.status === "PAYE")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return {
      schoolCode: this.school?.code ?? "",
      schoolName: this.school?.name ?? "",
      date: today,
      students: activeStudents.length,
      teachers: new Set(this.rawClasses.map((schoolClass) => schoolClass.teacherId)).size,
      classes: this.rawClasses.length,
      presentToday: todaysPresences.filter((presence) => presence.status === "Présent").length,
      absentToday: todaysPresences.filter((presence) => presence.status === "Absent").length,
      lateToday: todaysPresences.filter((presence) => presence.status === "Retard").length,
      paymentsThisMonth: paidThisMonth,
      unpaidStudents: this.finance.getLatePayers().length,
      recentNotifications: [
        "Absence signalée à un parent",
        "Paiement validé",
        "Notes publiées pour 6ème A",
      ],
    };
  }

  module(name, status, rules) {
    return { name, status, rules };
  }
}

module.exports = { MvpBusinessService };
