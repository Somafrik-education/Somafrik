const seedData = require("../data");

const roleAliases = {
  super_admin: "Super Administrateur Somafrik",
  country_admin: "Admin Pays",
  school_admin: "Admin School",
  prefet: "Préfet des études",
  secretary: "Secrétaire",
  teacher: "Enseignant",
  student: "Élève / Étudiant",
  parent_student: "Parent",
};

const routePermissions = {
  "GET /api/users": ["Utilisateurs:READ", "Gérer utilisateurs", "Auditer utilisateurs pays", "ALL_PRIVILEGES"],
  "POST /api/users/:id/reset-password": [
    "Utilisateurs:UPDATE",
    "Gérer utilisateurs",
    "ALL_PRIVILEGES",
    "COUNTRY_PRIVILEGES",
  ],
  "GET /api/teachers": ["Enseignants:READ", "Voir enseignants", "Gérer enseignants", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/teachers/:teacherCode": [
    "Enseignants:READ",
    "Voir enseignants",
    "Gérer enseignants",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ],
  "POST /api/teachers": ["Enseignants:CREATE", "Gérer enseignants", "ALL_PRIVILEGES"],
  "GET /api/classes": ["Voir classes", "Gérer classes", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/classes": ["Gérer classes", "ALL_PRIVILEGES"],
  "PATCH /api/classes/:classCode": ["Gérer classes", "ALL_PRIVILEGES"],
  "GET /api/classes/:classCode/students": ["Élèves:READ", "Gérer élèves", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/classes/:classCode/students": ["Élèves:CREATE", "Gérer élèves", "ALL_PRIVILEGES"],
  "GET /api/students": ["Élèves:READ", "Gérer élèves", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/students/:id": ["Élèves:READ", "Gérer élèves", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "PATCH /api/students/:id": ["Élèves:UPDATE", "Gérer élèves", "ALL_PRIVILEGES"],
  "GET /api/assignments": [
    "Affectations:READ",
    "Matières:READ",
    "Gérer cours",
    "Gérer planning académique",
    "Voir classes",
    "Classes:READ",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ],
  "POST /api/assignments": [
    "Affectations:CREATE",
    "Matières:CREATE",
    "Gérer cours",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
  ],
  "PATCH /api/assignments/:assignmentId": [
    "Affectations:UPDATE",
    "Matières:UPDATE",
    "Gérer cours",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
  ],
  "DELETE /api/assignments/:assignmentId": [
    "Affectations:DELETE",
    "Matières:DELETE",
    "Gérer cours",
    "Gérer planning académique",
    "ALL_PRIVILEGES",
  ],
  "GET /api/payments": ["Paiements:READ", "Gérer paiements", "Voir paiements", "Voir rapports financiers", "Suivre abonnements pays", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/payments": ["Paiements:CREATE", "Paiements:UPDATE", "Gérer paiements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "GET /api/v2/subjects": ["Matières:READ", "Gérer cours", "Voir classes", "Modifier notes", "Organiser examens", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/v2/subjects": ["Matières:CREATE", "Gérer cours", "ALL_PRIVILEGES"],
  "DELETE /api/v2/subjects/:code": ["Matières:DELETE", "Gérer cours", "ALL_PRIVILEGES"],
  "GET /api/v2/academic-years": ["Années Académiques:READ", "Valider années académiques", "Gérer planning académique", "Gérer classes", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/v2/academic-years": ["Valider années académiques", "Gérer planning académique", "Gérer classes", "ALL_PRIVILEGES"],
  "GET /api/v2/exams": ["Examens:READ", "Valider examens", "Organiser examens", "Gérer cours", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/v2/documents": ["Documents:READ", "Valider bulletins", "Voir rapports", "Gérer élèves", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/v2/reports/advanced": ["Rapports:READ", "Voir rapports globaux", "Voir rapports pays", "Voir rapports", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/backoffice/countries": ["Contrôler tous les pays", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/backoffice/countries": ["Contrôler tous les pays", "ALL_PRIVILEGES"],
  "PATCH /api/backoffice/countries/:code": ["Contrôler tous les pays", "ALL_PRIVILEGES"],
  "GET /api/backoffice/subscriptions": ["Gérer abonnements", "Suivre abonnements pays", "ALL_PRIVILEGES"],
  "POST /api/backoffice/subscriptions": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "PATCH /api/backoffice/subscriptions/:subscriptionId": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "GET /api/backoffice/notifications": ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "POST /api/backoffice/notifications": ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "PATCH /api/backoffice/notifications/:notificationId": ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "GET /api/backoffice/role-permissions": ["ALL_PRIVILEGES"],
  "PUT /api/backoffice/role-permissions": ["ALL_PRIVILEGES"],
  "GET /api/backoffice/dashboard-chart-config": ["ALL_PRIVILEGES"],
  "PUT /api/backoffice/dashboard-chart-config": ["ALL_PRIVILEGES"],
  "POST /api/backoffice/subscription-offers": ["Gérer abonnements", "ALL_PRIVILEGES"],
  "PATCH /api/backoffice/subscription-offers/:offerId": ["Gérer abonnements", "ALL_PRIVILEGES"],
  "POST /api/backoffice/subscription-payments": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "PATCH /api/backoffice/subscription-payments/:paymentId": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "POST /api/backoffice/subscription-discounts": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "PATCH /api/backoffice/subscription-discounts/:discountId": ["Gérer abonnements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "GET /api/backoffice/establishments": ["Établissements:READ", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/backoffice/establishments/:code": ["Établissements:READ", "Paramètres Établissement:READ", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/backoffice/establishments": ["Établissements:CREATE", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "PATCH /api/backoffice/establishments/:code": ["Établissements:UPDATE", "Paramètres Établissement:UPDATE", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "DELETE /api/backoffice/establishments/:code": ["Établissements:DELETE", "ALL_PRIVILEGES"],
  "POST /api/backoffice/establishments/import": ["Établissements:CREATE", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "POST /api/backoffice/import/students/validate": ["Élèves:CREATE", "Gérer élèves", "Gérer établissements", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"],
  "GET /api/backoffice/subscription-access": ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "GET /api/backoffice/finance/unpaid": ["Impayés:READ", "Paiements:READ", "Frais & tarifs:READ", "Gérer paiements", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"],
  "POST /api/backoffice/finance/unpaid/reminders": ["Impayés:CREATE", "Paiements:UPDATE", "Gérer paiements", "ALL_PRIVILEGES"],
};

class RbacService {
  constructor(rolePermissions = seedData.rolePermissions) {
    this.rolePermissions = rolePermissions;
  }

  permissionsFor(role) {
    const label = roleAliases[role] ?? role;
    return this.rolePermissions[label] ?? ["Voir tableau de bord"];
  }

  canAccess(principal, routeKey) {
    const requiredPermissions = routePermissions[routeKey];

    if (
      !requiredPermissions ||
      process.env.SOMAFRIK_AUTH_OPTIONAL === "true"
    ) {
      return true;
    }

    if (!principal) {
      return false;
    }

    const permissions = new Set(principal.permissions ?? this.permissionsFor(principal.role));
    return requiredPermissions.some((permission) => permissions.has(permission));
  }
}

module.exports = { RbacService, routePermissions };
