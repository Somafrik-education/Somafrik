const API_BASE_URL = "/api";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  session: null,
  schools: [],
  users: [],
  countries: [],
  subscriptions: [],
  notifications: [],
  students: [],
  teachers: [],
  classes: [],
  courses: [],
  assignments: [],
  payments: [],
  presences: [],
  notes: [],
  announcements: [],
  messages: [],
  paymentStatuses: [],
  auditLog: [],
  rolePermissions: {},
  academicConfigs: {},
  selectedPermissionRole: "",
  selectedSchoolPilotageRole: "",
  selectedSchoolPilotageFeature: "",
  syncTimeoutId: null,
  schoolPage: 1,
  pageSize: 10,
  realtimeIntervalId: null,
};

const loginPanel = document.querySelector("#loginPanel");
const appPanel = document.querySelector("#appPanel");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const identifierInput = document.querySelector("#identifierInput");
const passwordInput = document.querySelector("#passwordInput");
const loginSchoolCodeField = document.querySelector("#loginSchoolCodeField");
const loginSchoolCodeInput = document.querySelector("#loginSchoolCodeInput");
const openLoginButton = document.querySelector("#openLoginButton");
const heroLoginButton = document.querySelector("#heroLoginButton");
const logoutButton = document.querySelector("#logoutButton");
const pageTitle = document.querySelector("#pageTitle");
const scopeLabel = document.querySelector("#scopeLabel");
const userName = document.querySelector("#userName");
const userRole = document.querySelector("#userRole");
const userInitials = document.querySelector("#userInitials");
const kpiGrid = document.querySelector("#kpiGrid");
const roleDashboard = document.querySelector("#roleDashboard");
const controlGrid = document.querySelector("#controlGrid");
const controlHint = document.querySelector("#controlHint");
const schoolsTable = document.querySelector("#schoolsTable");
const usersTable = document.querySelector("#usersTable");
const countriesTable = document.querySelector("#countriesTable");
const subscriptionsTable = document.querySelector("#subscriptionsTable");
const notificationsList = document.querySelector("#notificationsList");
const establishmentScopeLabel = document.querySelector("#establishmentScopeLabel");
const establishmentSummary = document.querySelector("#establishmentSummary");
const schoolRolePilotage = document.querySelector("#schoolRolePilotage");
const schoolConfigPanel = document.querySelector("#schoolConfigPanel");
const schoolConfigPeriodMode = document.querySelector("#schoolConfigPeriodMode");
const schoolConfigDefaultScale = document.querySelector("#schoolConfigDefaultScale");
const schoolConfigReportMode = document.querySelector("#schoolConfigReportMode");
const schoolConfigEvaluationTypes = document.querySelector("#schoolConfigEvaluationTypes");
const countryCount = document.querySelector("#countryCount");
const subscriptionCount = document.querySelector("#subscriptionCount");
const notificationCount = document.querySelector("#notificationCount");
const coverageSummary = document.querySelector("#coverageSummary");
const coverageGrid = document.querySelector("#coverageGrid");
const roadmapList = document.querySelector("#roadmapList");
const permissionCount = document.querySelector("#permissionCount");
const rolePermissionSelect = document.querySelector("#rolePermissionSelect");
const rolePermissionGrid = document.querySelector("#rolePermissionGrid");
const rolePermissionNotice = document.querySelector("#rolePermissionNotice");
const schoolSearch = document.querySelector("#schoolSearch");
const schoolCountryFilter = document.querySelector("#schoolCountryFilter");
const schoolTypeFilter = document.querySelector("#schoolTypeFilter");
const schoolStatusFilter = document.querySelector("#schoolStatusFilter");
const schoolsPager = document.querySelector("#schoolsPager");
const userSearch = document.querySelector("#userSearch");
const toastMessage = document.querySelector("#toastMessage");
const detailDrawer = document.querySelector("#detailDrawer");
const detailEyebrow = document.querySelector("#detailEyebrow");
const detailTitle = document.querySelector("#detailTitle");
const detailBody = document.querySelector("#detailBody");
const schoolModal = document.querySelector("#schoolModal");
const schoolForm = document.querySelector("#schoolForm");
const schoolFormMode = document.querySelector("#schoolFormMode");
const schoolFormTitle = document.querySelector("#schoolFormTitle");
const schoolFormError = document.querySelector("#schoolFormError");
const schoolOriginalCode = document.querySelector("#schoolOriginalCode");
const schoolNameInput = document.querySelector("#schoolNameInput");
const schoolCodeInput = document.querySelector("#schoolCodeInput");
const schoolTypeInput = document.querySelector("#schoolTypeInput");
const schoolCountryInput = document.querySelector("#schoolCountryInput");
const schoolCityInput = document.querySelector("#schoolCityInput");
const schoolStatusInput = document.querySelector("#schoolStatusInput");
const schoolPhoneInput = document.querySelector("#schoolPhoneInput");
const schoolEmailInput = document.querySelector("#schoolEmailInput");
const schoolPlanInput = document.querySelector("#schoolPlanInput");
const schoolEndDateInput = document.querySelector("#schoolEndDateInput");
const schoolMaxStudentsInput = document.querySelector("#schoolMaxStudentsInput");
const schoolMaxTeachersInput = document.querySelector("#schoolMaxTeachersInput");
const schoolAddressInput = document.querySelector("#schoolAddressInput");
const schoolLogoInput = document.querySelector("#schoolLogoInput");
const roleModal = document.querySelector("#roleModal");
const roleForm = document.querySelector("#roleForm");
const roleFormMode = document.querySelector("#roleFormMode");
const roleFormTitle = document.querySelector("#roleFormTitle");
const roleOriginalName = document.querySelector("#roleOriginalName");
const roleNameInput = document.querySelector("#roleNameInput");
const roleNameLabel = document.querySelector("#roleNameLabel");
const roleDeleteWarning = document.querySelector("#roleDeleteWarning");
const roleFormError = document.querySelector("#roleFormError");
const roleSubmitButton = document.querySelector("#roleSubmitButton");
const academicSettingsForm = document.querySelector("#academicSettingsForm");
const academicSettingsStatus = document.querySelector("#academicSettingsStatus");
const academicSchoolSelect = document.querySelector("#academicSchoolSelect");
const academicPeriodModeInput = document.querySelector("#academicPeriodModeInput");
const academicDefaultScaleInput = document.querySelector("#academicDefaultScaleInput");
const academicReportCardModeInput = document.querySelector("#academicReportCardModeInput");
const academicPeriodsInput = document.querySelector("#academicPeriodsInput");
const academicEvaluationTypesInput = document.querySelector("#academicEvaluationTypesInput");
const academicAllowClassesInput = document.querySelector("#academicAllowClassesInput");
const academicAllowCoursesInput = document.querySelector("#academicAllowCoursesInput");
const academicAllowBulletinsInput = document.querySelector("#academicAllowBulletinsInput");
let selectedLoginProfile = "superadmin";

const mvpCoverage = [
  ["Authentification par établissement", "Web / Mobile", "Couvert", "P0", "Code unique, logo/nom école, rôle détecté, mot de passe et blocage comptes suspendus."],
  ["Établissements SaaS", "Plateforme", "Couvert", "P0", "Création, fiche, modification, suspension, paramètres, abonnement et code unique."],
  ["Utilisateurs et permissions", "Plateforme / Mobile", "Couvert", "P0", "Rôles MVP, statuts, permissions automatiques et réinitialisation mot de passe."],
  ["Élèves", "Web / Mobile", "Couvert", "P0", "Matricule, parent associé, dossier élève, statut actif/archivé et séparation des dossiers."],
  ["Classes et enseignants", "Web / Mobile", "Couvert", "P0", "Effectifs calculés, affectation élèves/enseignants et vue limitée aux classes de l'enseignant."],
  ["Présences et appels", "Web / Mobile", "Couvert", "P0", "Présent par défaut, absent/retard/justifié, sauvegarde en une action, audit et notification parent."],
  ["Notes simples", "Web / Mobile", "Couvert", "P0", "Évaluations, saisie par classe, contrôle barème, moyennes, classement et publication."],
  ["Paiements scolaires", "Web / Mobile", "Couvert", "P0", "Frais, encaissements, reste à payer, impayés, historique et notification paiement."],
  ["Notifications", "Web / Mobile", "Couvert", "P1", "Création, ciblage MVP, historique et notifications automatiques absence/paiement/note."],
  ["Dashboards", "Web / Mobile", "Couvert", "P1", "KPIs école, pays et plateforme avec filtrage par périmètre."],
  ["Super Admin / Admin Pays", "Plateforme", "Couvert", "P1", "Pays, administrateurs pays, validation écoles, suspension et statistiques."],
  ["Séparation de données", "SaaS", "Couvert", "P0", "École, pays, parent, enseignant et élève restent dans leur périmètre."],
].map(([module, scope, status, priority, detail]) => ({ module, scope, status, priority, detail }));

const crudActions = [
  { key: "READ", label: "Lire" },
  { key: "CREATE", label: "Créer" },
  { key: "UPDATE", label: "Modifier" },
  { key: "DELETE", label: "Supprimer" },
  { key: "SUSPEND", label: "Suspendre" },
];

const crudPermissionModules = [
  "Pays",
  "Établissements",
  "Abonnements",
  "Utilisateurs",
  "Classes",
  "Élèves",
  "Enseignants",
  "Affectations",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Notifications",
  "Messages",
  "Documents",
  "Rapports",
  "Paramètres Établissement",
  "Années Académiques",
  "Matières",
  "Examens",
];

const schoolAdminForbiddenFeatures = new Set(["Établissements", "Abonnements"]);
const schoolAdminForbiddenPermissionKeywords = ["abonnement", "etablissement", "établissement", "inscription", "tarif"];

const defaultAcademicConfig = {
  schoolCode: "CD-2026-0001",
  periodMode: "trimestre",
  periods: [
    { id: "trimestre-1", name: "Trimestre 1", order: 1, active: true },
    { id: "trimestre-2", name: "Trimestre 2", order: 2, active: false },
    { id: "trimestre-3", name: "Trimestre 3", order: 3, active: false },
  ],
  evaluationTypes: ["Interrogation", "Devoir", "Examen", "Travail pratique", "Projet"],
  defaultScale: 20,
  reportCardMode: "period",
  allowCustomClasses: true,
  allowCustomCourses: true,
  allowCustomReportCards: true,
};

const countryAdminSchoolAdminPermissions = [
  "COUNTRY_PRIVILEGES",
  "Gérer établissements du pays",
  "Créer un établissement",
  "Modifier un établissement",
  "Suspendre un établissement",
  "Réactiver un établissement",
  "Valider une inscription",
  "Gérer admins écoles du pays",
  "Gérer administrateurs écoles",
  "Gérer utilisateurs",
  "Auditer utilisateurs pays",
  "Établissements:READ",
  "Établissements:CREATE",
  "Établissements:UPDATE",
  "Établissements:DELETE",
  "Établissements:SUSPEND",
  "Utilisateurs:READ",
  "Utilisateurs:CREATE",
  "Utilisateurs:UPDATE",
  "Utilisateurs:DELETE",
  "Utilisateurs:SUSPEND",
  "Pays:READ",
  "Abonnements:READ",
  "Abonnements:CREATE",
  "Abonnements:UPDATE",
  "Abonnements:DELETE",
];

const internalRoleDefaultPermissions = {
  "Admin School": [
    "Utilisateurs:READ",
    "Utilisateurs:CREATE",
    "Utilisateurs:UPDATE",
    "Utilisateurs:DELETE",
    "Utilisateurs:SUSPEND",
    "Classes:READ",
    "Classes:CREATE",
    "Classes:UPDATE",
    "Classes:DELETE",
    "Élèves:READ",
    "Élèves:CREATE",
    "Élèves:UPDATE",
    "Élèves:DELETE",
    "Élèves:SUSPEND",
    "Enseignants:READ",
    "Enseignants:CREATE",
    "Affectations:READ",
    "Affectations:CREATE",
    "Affectations:UPDATE",
    "Présences:READ",
    "Notes:READ",
    "Bulletins:READ",
    "Paiements:READ",
    "Notifications:READ",
    "Notifications:CREATE",
    "Notifications:UPDATE",
    "Messages:READ",
    "Messages:CREATE",
    "Messages:UPDATE",
    "Documents:READ",
    "Documents:CREATE",
    "Documents:UPDATE",
    "Rapports:READ",
    "Paramètres Établissement:READ",
    "Paramètres Établissement:UPDATE",
    "Années Académiques:READ",
    "Années Académiques:CREATE",
    "Années Académiques:UPDATE",
    "Matières:READ",
    "Matières:CREATE",
    "Matières:UPDATE",
    "Examens:READ",
    "Examens:CREATE",
    "Examens:UPDATE",
  ],
  "Secrétaire": [
    "Utilisateurs:READ",
    "Classes:READ",
    "Élèves:READ",
    "Élèves:CREATE",
    "Élèves:UPDATE",
    "Enseignants:READ",
    "Affectations:READ",
    "Présences:READ",
    "Présences:CREATE",
    "Présences:UPDATE",
    "Paiements:READ",
    "Paiements:CREATE",
    "Paiements:UPDATE",
    "Notifications:READ",
    "Notifications:CREATE",
    "Messages:READ",
    "Messages:CREATE",
    "Messages:UPDATE",
    "Documents:READ",
    "Documents:CREATE",
    "Documents:UPDATE",
    "Rapports:READ",
  ],
  "Sécretaire": [
    "Utilisateurs:READ",
    "Classes:READ",
    "Élèves:READ",
    "Élèves:CREATE",
    "Élèves:UPDATE",
    "Enseignants:READ",
    "Affectations:READ",
    "Présences:READ",
    "Présences:CREATE",
    "Présences:UPDATE",
    "Paiements:READ",
    "Paiements:CREATE",
    "Paiements:UPDATE",
    "Notifications:READ",
    "Notifications:CREATE",
    "Messages:READ",
    "Messages:CREATE",
    "Messages:UPDATE",
    "Documents:READ",
    "Documents:CREATE",
    "Documents:UPDATE",
    "Rapports:READ",
  ],
  "Préfet des études": [
    "Utilisateurs:READ",
    "Classes:READ",
    "Classes:CREATE",
    "Classes:UPDATE",
    "Élèves:READ",
    "Élèves:UPDATE",
    "Enseignants:READ",
    "Affectations:READ",
    "Affectations:CREATE",
    "Affectations:UPDATE",
    "Présences:READ",
    "Présences:CREATE",
    "Présences:UPDATE",
    "Notes:READ",
    "Notes:CREATE",
    "Notes:UPDATE",
    "Bulletins:READ",
    "Bulletins:CREATE",
    "Bulletins:UPDATE",
    "Notifications:READ",
    "Notifications:CREATE",
    "Messages:READ",
    "Messages:CREATE",
    "Documents:READ",
    "Rapports:READ",
    "Années Académiques:READ",
    "Matières:READ",
    "Matières:CREATE",
    "Matières:UPDATE",
    "Examens:READ",
    "Examens:CREATE",
    "Examens:UPDATE",
  ],
};

const viewPermissionFeatures = {
  overview: null,
  countries: "Pays",
  schools: "Établissements",
  subscriptions: "Abonnements",
  notifications: "Notifications",
  users: "Utilisateurs",
  reports: "Rapports",
  permissions: "Droits par rôle",
  academicSettings: "Paramètres Établissement",
};

const actionPermissions = {
  "add-country": ["Pays", "CREATE"],
  "save-country-form": ["Pays", "CREATE"],
  "assign-country-admin": ["Pays", "UPDATE"],
  "toggle-country": ["Pays", "SUSPEND"],
  "add-school": ["Établissements", "CREATE"],
  "edit-school": ["Établissements", "UPDATE"],
  "validate-schools": ["Établissements", "UPDATE"],
  "validate-school": ["Établissements", "UPDATE"],
  "toggle-school": ["Établissements", "SUSPEND"],
  "renew-subscriptions": ["Abonnements", "UPDATE"],
  "renew-subscription": ["Abonnements", "UPDATE"],
  "remind-subscriptions": ["Abonnements", "UPDATE"],
  "remind-subscription": ["Abonnements", "UPDATE"],
  "add-notification": ["Notifications", "CREATE"],
  "save-notification-form": ["Notifications", "CREATE"],
  "read-all-notifications": ["Notifications", "UPDATE"],
  "read-notification": ["Notifications", "UPDATE"],
  "archive-notification": ["Notifications", "DELETE"],
  "add-user": ["Utilisateurs", "CREATE"],
  "save-user-form": ["Utilisateurs", "CREATE"],
  "reset-passwords": ["Utilisateurs", "UPDATE"],
  "reset-user-password": ["Utilisateurs", "UPDATE"],
  "toggle-user": ["Utilisateurs", "SUSPEND"],
  "create-role": ["Droits par rôle", "CREATE"],
  "rename-role": ["Droits par rôle", "UPDATE"],
  "delete-role": ["Droits par rôle", "DELETE"],
  "save-role-permissions": ["Droits par rôle", "UPDATE"],
  "reset-role-permissions": ["Droits par rôle", "UPDATE"],
  "export-permissions": ["Droits par rôle", "READ"],
  "export-mvp-report": ["Rapports", "READ"],
  "save-school-user-settings": ["Paramètres Établissement", "UPDATE"],
};

const unrestrictedActions = new Set([
  "refresh-dashboard",
  "close-detail",
  "close-school-form",
  "close-role-form",
  "previous-school-page",
  "next-school-page",
]);

function revealLoginForm() {
  loginForm.classList.remove("hidden");
  loginForm.scrollIntoView({ behavior: "smooth", block: "center" });
  identifierInput.focus();
}

function setLoginProfile(profile) {
  selectedLoginProfile = profile || "school";
  const requiresSchoolCode = selectedLoginProfile === "school";
  loginSchoolCodeField?.classList.toggle("hidden", !requiresSchoolCode);
  if (loginSchoolCodeInput) {
    loginSchoolCodeInput.required = requiresSchoolCode;
    if (requiresSchoolCode && !loginSchoolCodeInput.value.trim()) {
      loginSchoolCodeInput.value = "CD-2026-0001";
    }
    if (!requiresSchoolCode) {
      loginSchoolCodeInput.value = "";
    }
  }
  document.querySelectorAll("[data-login-profile]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.loginProfile === selectedLoginProfile);
  });
}

[openLoginButton, heroLoginButton].filter(Boolean).forEach((button) => {
  button.addEventListener("click", () => {
    revealLoginForm();
    setLoginProfile(selectedLoginProfile);
  });
});

document.querySelectorAll("[data-demo]").forEach((button) => {
  button.addEventListener("click", () => {
    revealLoginForm();
    setLoginProfile(button.dataset.loginProfile);
    identifierInput.value = button.dataset.demo;
    passwordInput.value = "1234";
    if (!button.dataset.loginProfile) {
      loginForm.requestSubmit();
    }
  });
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  try {
    const schoolCode = loginSchoolCodeInput?.value.trim().toUpperCase() ?? "";
    if (selectedLoginProfile === "school" && !schoolCode) {
      throw new Error("Le code établissement est obligatoire pour un compte établissement.");
    }

    const payload = {
      identifier: identifierInput.value.trim(),
      password: passwordInput.value.trim(),
      ...(schoolCode ? { schoolCode } : {}),
    };
    const response = await request("/backoffice/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.session = response;
    if (response.user?.mustChangePassword) {
      await requirePasswordChange();
    }
    state.schools = response.schools;
    state.users = response.users;
    state.countries = response.countries ?? [];
    state.subscriptions = response.subscriptions ?? [];
    state.notifications = response.notifications ?? [];
    state.students = response.students ?? [];
    state.teachers = response.teachers ?? [];
    state.classes = response.classes ?? [];
    state.courses = response.courses ?? [];
    state.assignments = response.assignments ?? [];
    state.payments = response.payments ?? [];
    state.presences = response.presences ?? [];
    state.notes = response.notes ?? [];
    state.announcements = response.announcements ?? [];
    state.messages = response.messages ?? [];
    state.paymentStatuses = response.paymentStatuses ?? [];
    state.auditLog = response.auditLog ?? [];
    state.rolePermissions = response.rolePermissions ?? {};
    state.academicConfigs = response.academicConfigs ?? {};
    await refreshBackOfficeStateFromBackend();
    persistSession({ sync: false });
    renderApp();
    startRealtimeSync();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

async function requirePasswordChange() {
  const newPassword = window.prompt("Mot de passe temporaire accepté. Saisissez votre nouveau mot de passe (minimum 6 caractères).");
  if (!newPassword || newPassword.trim().length < 6) {
    state.session = null;
    throw new Error("Vous devez définir un nouveau mot de passe pour continuer.");
  }

  const confirmation = window.prompt("Confirmez le nouveau mot de passe.");
  if (newPassword.trim() !== String(confirmation ?? "").trim()) {
    state.session = null;
    throw new Error("Les mots de passe ne correspondent pas.");
  }

  const response = await request("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ newPassword: newPassword.trim() }),
  });
  state.session.user = {
    ...state.session.user,
    ...response.user,
    mustChangePassword: false,
  };
}

logoutButton.addEventListener("click", () => {
  stopRealtimeSync();
  state.session = null;
  state.schools = [];
  state.users = [];
  state.countries = [];
  state.subscriptions = [];
  state.notifications = [];
  state.students = [];
  state.teachers = [];
  state.classes = [];
  state.courses = [];
  state.assignments = [];
  state.payments = [];
  state.presences = [];
  state.notes = [];
  state.announcements = [];
  state.messages = [];
  state.paymentStatuses = [];
  state.auditLog = [];
  state.rolePermissions = {};
  state.academicConfigs = {};
  state.selectedPermissionRole = "";
  loginPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
});

schoolSearch.addEventListener("input", () => {
  state.schoolPage = 1;
  renderSchools();
});

schoolCountryFilter.addEventListener("change", () => {
  state.schoolPage = 1;
  renderSchools();
});
schoolTypeFilter.addEventListener("change", () => {
  state.schoolPage = 1;
  renderSchools();
});
schoolStatusFilter.addEventListener("change", () => {
  state.schoolPage = 1;
  renderSchools();
});
schoolForm.addEventListener("submit", handleSchoolFormSubmit);
roleForm.addEventListener("submit", handleRoleFormSubmit);
academicSettingsForm.addEventListener("submit", handleAcademicSettingsSubmit);
academicSchoolSelect.addEventListener("change", () => renderAcademicSettingsForm());
userSearch.addEventListener("input", () => renderUsers());
rolePermissionSelect.addEventListener("change", () => {
  state.selectedPermissionRole = rolePermissionSelect.value;
  renderPermissions();
});
document.addEventListener("click", handleActionClick);
document.addEventListener("change", handlePermissionToggle);

boot();

async function boot() {
  stopRealtimeSync();
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(state.session?.accessToken ? { Authorization: `Bearer ${state.session.accessToken}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Erreur plateforme");
  }

  return data;
}

function renderApp() {
  const { user, scope } = state.session;
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  userName.textContent = `${user.firstName} ${user.lastName}`;
  userRole.textContent = displayRoleName(user.role);
  userInitials.textContent = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
  scopeLabel.textContent = scope.label;
  controlHint.textContent = scope.hint;

  renderKpis();
  renderMenus();
  renderControls();
  renderCountries();
  renderSchools();
  renderSubscriptions();
  renderNotifications();
  renderEstablishmentDashboard();
  renderUsers();
  renderReports();
  renderAcademicSettings();
  initializeRolePermissions();
  renderPermissions();
  showView("overview");
  refreshActionVisibility();
}

function renderKpis() {
  if (kpiGrid) {
    kpiGrid.innerHTML = "";
    kpiGrid.hidden = true;
  }
  renderRoleDashboard();
}

function renderRoleDashboard() {
  if (!roleDashboard) return;
  roleDashboard.innerHTML = "";
  roleDashboard.hidden = true;
}

function renderMenus() {
  const allowedMenus = state.session.menus ?? [];
  const menuToView = {
    Dashboard: "overview",
    Pays: "countries",
    "Administrateurs Pays": "users",
    Établissements: "schools",
    Validations: "schools",
    Abonnements: "subscriptions",
    Paiements: "subscriptions",
    Support: "notifications",
    "Pilotage Établissement": "users",
    "Établissement": "users",
    Rapports: "overview",
    "Conformité MVP": "reports",
    Paramètres: "permissions",
    "Paramètres Établissement": "academicSettings",
    "Années Académiques": "academicSettings",
  };
  const allowedViews = new Set(["overview"]);

  allowedMenus.forEach((menu) => {
    if (menuToView[menu] && canReadView(menuToView[menu])) {
      allowedViews.add(menuToView[menu]);
    }
  });

  Object.keys(viewPermissionFeatures).forEach((viewName) => {
    if (isInternalSchoolRole(state.session?.user?.role) && viewName === "academicSettings") {
      return;
    }
    if (canReadView(viewName)) {
      allowedViews.add(viewName);
    }
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("hidden", !allowedViews.has(button.dataset.view));
  });
}

function renderControls() {
  const controls = getBusinessControls();
  controlGrid.innerHTML = controls
    .map(
      (control) => `
        <button class="control-card control-action" type="button" data-action="open-business-control" data-view="${escapeHtml(control.view)}" data-id="${escapeHtml(control.id)}" data-label="${escapeHtml(control.title)}">
          <strong>${escapeHtml(control.title)}</strong>
          <p>${escapeHtml(control.description)}</p>
          <span>${escapeHtml(control.cta)}</span>
        </button>
      `
    )
    .join("");
  refreshActionVisibility();
}

function getBusinessControls() {
  const permissions = new Set(getCurrentRolePermissions());
  const hasAny = (...items) => items.some((permission) => permissions.has(permission));
  const hasMatch = (pattern) => [...permissions].some((permission) => normalize(permission).includes(pattern));
  const controls = [];

  if (hasSchoolUserPilotageAccess()) {
    controls.push({
      id: "establishment",
      title: "Pilotage établissement",
      description: "Voir les écrans métier de l'établissement selon les droits accordés.",
      view: "users",
      cta: "Ouvrir l'établissement",
    });
  }

  if (hasAny("ALL_PRIVILEGES", "COUNTRY_PRIVILEGES") || hasMatch("pays")) {
    controls.push({
      id: "countries",
      title: "Pays",
      description: "Créer, suspendre, réactiver et affecter les administrateurs pays.",
      view: "countries",
      cta: "Ouvrir les pays",
    });
  }

  if (hasAny("Établissements:READ", "Établissements:CREATE", "Établissements:UPDATE", "Établissements:DELETE") || hasMatch("établissement") || hasMatch("inscription")) {
    controls.push({
      id: "schools",
      title: "Établissements",
      description: "Valider les inscriptions, modifier les fiches et contrôler les statuts.",
      view: "schools",
      cta: "Ouvrir les établissements",
    });
  }

  if (hasAny("Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE", "Utilisateurs:DELETE") || hasMatch("utilisateur") || hasMatch("admin")) {
    controls.push({
      id: "users",
      title: "Utilisateurs et admins",
      description: "Créer, suspendre, réactiver et réinitialiser les comptes.",
      view: "users",
      cta: "Ouvrir les utilisateurs",
    });
  }

  if (hasAny("Abonnements:READ", "Abonnements:CREATE", "Abonnements:UPDATE", "Abonnements:DELETE") || hasMatch("abonnement") || hasMatch("tarif")) {
    controls.push({
      id: "subscriptions",
      title: "Abonnements",
      description: "Renouveler, suivre les échéances et relancer les établissements.",
      view: "subscriptions",
      cta: "Ouvrir les abonnements",
    });
  }

  if (hasAny("Notifications:READ", "Notifications:CREATE", "Notifications:UPDATE", "Notifications:DELETE") || hasMatch("annonce") || hasMatch("communication") || hasMatch("message")) {
    controls.push({
      id: "notifications",
      title: "Notifications",
      description: "Publier, lire et archiver les notifications plateforme.",
      view: "notifications",
      cta: "Ouvrir les notifications",
    });
  }

  if (hasAny("Rapports:READ", "Rapports:CREATE", "Rapports:UPDATE", "Rapports:DELETE") || hasMatch("rapport") || hasMatch("audit")) {
    controls.push({
      id: "reports",
      title: "Rapports MVP",
      description: "Contrôler la couverture MVP et exporter le rapport.",
      view: "reports",
      cta: "Ouvrir les rapports",
    });
  }

  if (canManageRolePermissions()) {
    controls.push({
      id: "permissions",
      title: "Droits par rôle",
      description: "Attribuer les droits CRUD par rôle avec la matrice de permissions.",
      view: "permissions",
      cta: "Ouvrir les permissions",
    });
  }

  if (!isInternalSchoolRole(state.session?.user?.role) && (hasAny("Paramètres Établissement:READ", "Paramètres Établissement:CREATE", "Paramètres Établissement:UPDATE", "ALL_PRIVILEGES", "COUNTRY_PRIVILEGES") || hasMatch("paramètres"))) {
    controls.push({
      id: "academicSettings",
      title: "Configuration établissement",
      description: "Adapter classes, cours, périodes, notes et bulletins à la gestion interne.",
      view: "academicSettings",
      cta: "Configurer l'école",
    });
  }

  return controls.slice(0, 8);
}

function hasSchoolUserPilotageAccess() {
  const schoolFeatures = ["Utilisateurs", "Classes", "Élèves", "Enseignants", "Affectations", "Présences", "Notes", "Bulletins", "Paiements", "Messages", "Documents", "Rapports"];
  return isInternalSchoolRole(state.session?.user?.role) && schoolFeatures.some((feature) => hasBackOfficePermission(feature, "READ"));
}

function getLiveKpis() {
  const role = state.session?.user?.role;
  const scopedSchools = getScopedSchoolsForCurrentUser();
  const scopedUsers = getScopedUsersForCurrentUser();
  const scopedSubscriptions = getScopedSubscriptionsForCurrentUser();
  const scopedNotifications = getScopedNotificationsForCurrentUser();
  const activeSchools = scopedSchools.filter((school) => school.status !== "Suspendu");
  const activeUsers = scopedUsers.filter(isActiveUserAccount);
  const suspendedSchools = scopedSchools.filter((school) => school.status === "Suspendu").length;
  const expiredSubscriptions = scopedSubscriptions.filter((subscription) =>
    subscription.paymentStatus === "En retard" || isPastDate(subscription.endDate)
  ).length;
  const monthlyRevenue = scopedSubscriptions
    .filter((subscription) => subscription.status === "Actif" && subscription.paymentStatus === "À jour")
    .reduce((total, subscription) => total + Number(subscription.monthlyPrice ?? 0), 0);

  if (isInternalSchoolRole(role)) {
    return [
      { label: "Utilisateurs actifs", value: activeUsers.length },
      { label: "Élèves suivis", value: countUsersByRole(scopedUsers, ["Élève / Étudiant", "Élève", "Étudiant"]) },
      { label: "Enseignants", value: countUsersByRole(scopedUsers, ["Enseignant"]) },
      { label: "Alertes à traiter", value: scopedUsers.filter((user) => !isActiveUserAccount(user)).length + scopedNotifications.filter((notification) => notification.status === "Non lu").length },
    ];
  }

  return [
    { label: "Pays", value: getScopedCountriesForCurrentUser().length },
    { label: "Établissements", value: scopedSchools.length },
    { label: "Utilisateurs actifs", value: activeUsers.length },
    { label: "Revenus mensuels", value: monthlyRevenue, suffix: "USD" },
    { label: "Alertes plateforme", value: suspendedSchools + expiredSubscriptions },
  ];
}

function getRoleDashboard() {
  const user = state.session?.user ?? {};
  const role = normalizeRoleKey(user.role);
  const schoolLabel = user.schoolCode && user.schoolCode !== "*" ? user.schoolCode : "Périmètre courant";

  const base = {
    scope: schoolLabel,
    cards: [],
  };

  if (role === "admin school") {
    return {
      ...base,
      eyebrow: "Application web interne",
      title: "Tableau de bord Admin établissement",
      description: "Pilotage de l'établissement : comptes, classes, enseignants, affectations, communications et rapports.",
      priorities: [
        { title: "Gérer les comptes de l'école", detail: "Créer, modifier, suspendre et réinitialiser les comptes internes." },
        { title: "Piloter les affectations", detail: "Suivre les enseignants, classes et matières selon l'organisation de l'établissement." },
        { title: "Lire les indicateurs école", detail: "Contrôler utilisateurs actifs, alertes et modules disponibles sans données d'autres établissements." },
      ],
    };
  }

  if (role === "secretaire") {
    return {
      ...base,
      eyebrow: "Application web interne",
      title: "Tableau de bord Secrétaire",
      description: "Accueil administratif : dossiers élèves, présences, paiements, documents et communications parents.",
      priorities: [
        { title: "Tenir les dossiers élèves", detail: "Créer et mettre à jour les fiches élèves dans le périmètre de l'école." },
        { title: "Suivre paiements et documents", detail: "Enregistrer les opérations autorisées et préparer les justificatifs." },
        { title: "Communiquer avec les parents", detail: "Traiter les messages, annonces et notifications administratives." },
      ],
    };
  }

  if (role === "prefet des etudes") {
    return {
      ...base,
      eyebrow: "Application web interne",
      title: "Tableau de bord Préfet des études",
      description: "Pilotage pédagogique : classes, affectations, présences, notes, examens et bulletins.",
      priorities: [
        { title: "Suivre les classes", detail: "Contrôler affectations, enseignants et matières disponibles." },
        { title: "Contrôler notes et bulletins", detail: "Vérifier les sessions, périodes, examens et publication des résultats." },
        { title: "Surveiller les présences", detail: "Lire et corriger les appels selon les droits accordés." },
      ],
    };
  }

  return {
    ...base,
    eyebrow: "Plateforme Somafrik",
    title: user.role === "Admin Pays" ? "Tableau de bord Admin Pays" : "Tableau de bord plateforme",
    description: user.role === "Admin Pays"
      ? "Pilotage pays : établissements, validations, admins écoles, abonnements et support."
      : "Pilotage global Somafrik : pays, établissements, rôles, abonnements et conformité MVP.",
    priorities: [
      { title: "Contrôler le périmètre", detail: "Les indicateurs suivent uniquement les données accessibles par ce rôle." },
      { title: "Gérer les accès", detail: "Les permissions CRUD déterminent les actions visibles et exécutables." },
      { title: "Synchroniser les actions", detail: "Chaque modification est envoyée au backend et reprise par les autres interfaces." },
    ],
  };
}

function getScopedSchoolsForCurrentUser() {
  const user = state.session?.user ?? {};

  if (isSuperAdminRole(user.role)) return state.schools;
  if (user.role === "Admin Pays") {
    return state.schools.filter((school) =>
      normalize(school.country) === normalize(user.countryScope) ||
      normalize(school.countryCode) === normalize(user.countryScope)
    );
  }

  return state.schools.filter((school) => normalize(school.code) === normalize(user.schoolCode));
}

function getScopedCountriesForCurrentUser() {
  const user = state.session?.user ?? {};

  if (isSuperAdminRole(user.role)) return state.countries;
  return state.countries.filter((country) =>
    normalize(country.name) === normalize(user.countryScope) ||
    normalize(country.code) === normalize(user.countryScope) ||
    getCountryCodeFromScope(user.countryScope) === country.code
  );
}

function getScopedSubscriptionsForCurrentUser() {
  const user = state.session?.user ?? {};

  if (isSuperAdminRole(user.role)) return state.subscriptions;
  if (user.role === "Admin Pays") {
    const countryCode = getCountryCodeFromScope(user.countryScope);
    return state.subscriptions.filter((subscription) =>
      normalize(subscription.country) === normalize(user.countryScope) ||
      normalize(subscription.countryCode) === normalize(countryCode)
    );
  }

  return state.subscriptions.filter((subscription) => normalize(subscription.schoolCode) === normalize(user.schoolCode));
}

function getScopedNotificationsForCurrentUser() {
  const user = state.session?.user ?? {};

  if (isSuperAdminRole(user.role)) return state.notifications;
  if (user.role === "Admin Pays") {
    const countryCode = getCountryCodeFromScope(user.countryScope);
    return state.notifications.filter((notification) =>
      normalize(notification.countryCode) === normalize(countryCode) ||
      normalize(notification.audience).includes("admin pays")
    );
  }

  return state.notifications.filter((notification) =>
    normalize(notification.schoolCode) === normalize(user.schoolCode) ||
    normalize(notification.audience).includes(normalize(user.role)) ||
    normalize(notification.audience).includes("établissement") ||
    normalize(notification.audience).includes("etablissement")
  );
}

function getScopedUsersForCurrentUser() {
  const user = state.session?.user ?? {};

  if (isSuperAdminRole(user.role)) return state.users;
  if (user.role === "Admin Pays") return getVisibleUsers();
  return state.users.filter((account) => normalize(account.schoolCode) === normalize(user.schoolCode));
}

function getCurrentSchool() {
  const schoolCode = state.session?.user?.schoolCode;
  if (!schoolCode || schoolCode === "*") return state.schools[0] ?? null;
  return state.schools.find((school) => normalize(school.code) === normalize(schoolCode)) ?? null;
}

function getScopedStudentsForCurrentUser() {
  const schoolCode = state.session?.user?.schoolCode;
  if (!schoolCode || schoolCode === "*") return state.students;
  return state.students.filter((student) => normalize(student.schoolCode) === normalize(schoolCode));
}

function getScopedTeachersForCurrentUser() {
  const schoolCode = state.session?.user?.schoolCode;
  const students = getScopedStudentsForCurrentUser();
  const classNames = new Set(students.map((student) => student.className).filter(Boolean));
  if (!schoolCode || schoolCode === "*") return state.teachers;
  return state.teachers.filter((teacher) =>
    normalize(teacher.schoolCode) === normalize(schoolCode) ||
    (teacher.assignedClasses ?? []).some((className) => classNames.has(className)) ||
    (teacher.assignments ?? []).some((assignment) => classNames.has(assignment.className))
  );
}

function getScopedClassesForCurrentUser(students = getScopedStudentsForCurrentUser()) {
  const schoolCode = state.session?.user?.schoolCode;
  const classNames = new Set(students.map((student) => student.className).filter(Boolean));
  const rows = (!schoolCode || schoolCode === "*")
    ? state.classes
    : state.classes.filter((classItem) =>
        normalize(classItem.schoolCode) === normalize(schoolCode) ||
        classNames.has(classItem.name)
      );

  classNames.forEach((className) => {
    if (!rows.some((classItem) => classItem.name === className || classItem.className === className)) {
      rows.push({ id: `CLASS-${className}`, name: className, schoolCode });
    }
  });
  return rows;
}

function getScopedPaymentsForCurrentUser(students = getScopedStudentsForCurrentUser()) {
  const schoolCode = state.session?.user?.schoolCode;
  const studentIds = new Set(students.map((student) => student.id));
  if (!schoolCode || schoolCode === "*") return state.payments;
  return state.payments.filter((payment) =>
    normalize(payment.schoolCode) === normalize(schoolCode) ||
    studentIds.has(payment.studentId)
  );
}

function getScopedPresencesForCurrentUser(students = getScopedStudentsForCurrentUser()) {
  const schoolCode = state.session?.user?.schoolCode;
  const studentIds = new Set(students.map((student) => student.id));
  if (!schoolCode || schoolCode === "*") return state.presences;
  return state.presences.filter((presence) =>
    normalize(presence.schoolCode) === normalize(schoolCode) ||
    studentIds.has(presence.studentId)
  );
}

function getScopedNotesForCurrentUser(students = getScopedStudentsForCurrentUser()) {
  const schoolCode = state.session?.user?.schoolCode;
  const studentIds = new Set(students.map((student) => student.id));
  if (!schoolCode || schoolCode === "*") return state.notes;
  return state.notes.filter((note) =>
    normalize(note.schoolCode) === normalize(schoolCode) ||
    studentIds.has(note.studentId)
  );
}

function getScopedMessagesForCurrentUser(students = getScopedStudentsForCurrentUser()) {
  const schoolCode = state.session?.user?.schoolCode;
  const studentIds = new Set(students.map((student) => student.id));
  if (!schoolCode || schoolCode === "*") return state.messages;
  return state.messages.filter((message) =>
    normalize(message.schoolCode) === normalize(schoolCode) ||
    !message.studentId ||
    studentIds.has(message.studentId)
  );
}

function countUsersByRole(users, roles) {
  const normalizedRoles = roles.map((role) => normalize(role));
  return users.filter((user) => normalizedRoles.includes(normalize(user.role))).length;
}

function getAccessibleViewNames() {
  return Object.keys(viewPermissionFeatures).filter((viewName) => canReadView(viewName));
}

function isInternalSchoolRole(role) {
  return [
    "admin school",
    "administrateur ecole",
    "administrateur etablissement",
    "school_admin",
    "secretaire",
    "secretary",
    "prefet des etudes",
    "prefet des etude",
    "prefet",
    "proviseur / directeur",
    "proviseur",
    "directeur",
    "directeur adjoint",
    "comptable",
    "principal",
  ].includes(normalizeRoleKey(role));
}

function normalizeRoleKey(role) {
  return normalize(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCountryCodeFromScope(countryScope) {
  const normalized = String(countryScope ?? "").trim().toUpperCase();
  const codes = {
    RDC: "CD",
    "RÉPUBLIQUE DÉMOCRATIQUE DU CONGO": "CD",
    "REPUBLIQUE DEMOCRATIQUE DU CONGO": "CD",
    BURUNDI: "BI",
    BI: "BI",
    CONGO: "CG",
    CG: "CG",
    SENEGAL: "SN",
    "SÉNÉGAL": "SN",
    SN: "SN",
  };
  return codes[normalized] ?? (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
}

function renderSchools() {
  const query = normalize(schoolSearch.value);
  const country = schoolCountryFilter.value;
  const type = schoolTypeFilter.value;
  const status = schoolStatusFilter.value;
  const rows = getFilteredSchools({ query, country, type, status });
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.schoolPage = Math.min(state.schoolPage, totalPages);
  const start = (state.schoolPage - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  renderSchoolFilters();
  schoolsTable.innerHTML = pageRows
    .map(
      (school) => `
        <tr>
          <td><strong>${school.name}</strong><br><small>${school.type}</small></td>
          <td>${school.code}</td>
          <td>${school.country}</td>
          <td>${school.city}</td>
          <td><span class="status">${school.status}</span></td>
          <td>${school.subscriptionPlan}<br><small>${school.subscriptionEndDate}</small></td>
          <td>
            <div class="row-actions">
              ${
                school.validationStatus === "En attente"
                  ? `<button class="icon-action" type="button" data-action="validate-school" data-id="${school.code}">Valider</button>`
                  : `<button class="icon-action" type="button" data-action="inspect-school" data-id="${school.code}">Voir</button>`
              }
              <button class="icon-action" type="button" data-action="edit-school" data-id="${school.code}">Modifier</button>
              <button class="icon-action ${school.status === "Suspendu" ? "" : "danger"}" type="button" data-action="toggle-school" data-id="${school.code}">
                ${school.status === "Suspendu" ? "Réactiver" : "Suspendre"}
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
  renderSchoolsPager(rows.length, totalPages);
  refreshActionVisibility();
}

function getFilteredSchools({ query, country, type, status }) {
  return state.schools.filter((school) => {
    const matchesSearch =
      !query ||
      [school.name, school.code, school.country, school.city].some((value) => normalize(value).includes(query));
    const matchesCountry = !country || school.country === country;
    const matchesType = !type || school.type === type;
    const matchesStatus = !status || school.status === status;

    return matchesSearch && matchesCountry && matchesType && matchesStatus;
  });
}

function renderSchoolFilters() {
  renderSelectOptions(schoolCountryFilter, state.schools.map((school) => school.country), "Tous les pays");
  renderSelectOptions(schoolTypeFilter, state.schools.map((school) => school.type), "Tous les types");
  renderSelectOptions(schoolStatusFilter, state.schools.map((school) => school.status), "Tous les statuts");
}

function renderSelectOptions(select, values, emptyLabel) {
  const current = select.value;
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  select.innerHTML = [`<option value="">${emptyLabel}</option>`, ...options.map((value) => `<option value="${value}">${value}</option>`)].join("");
  select.value = options.includes(current) ? current : "";
}

function renderSchoolsPager(totalRows, totalPages) {
  const from = totalRows === 0 ? 0 : (state.schoolPage - 1) * state.pageSize + 1;
  const to = Math.min(totalRows, state.schoolPage * state.pageSize);
  schoolsPager.innerHTML = `
    <span>${from}-${to} sur ${totalRows} établissement(s)</span>
    <div class="row-actions">
      <button class="icon-action" type="button" data-action="previous-school-page" ${state.schoolPage === 1 ? "disabled" : ""}>Précédent</button>
      <span class="priority">Page ${state.schoolPage}/${totalPages}</span>
      <button class="icon-action" type="button" data-action="next-school-page" ${state.schoolPage === totalPages ? "disabled" : ""}>Suivant</button>
    </div>
  `;
}

function renderCountries() {
  countryCount.textContent = `${state.countries.length} pays`;
  countriesTable.innerHTML = state.countries
    .map(
      (country) => `
        <tr>
          <td><strong>${country.name}</strong><br><small>Admin : ${country.administratorId || "À affecter"}</small></td>
          <td>${country.code}</td>
          <td>${country.phonePrefix}</td>
          <td>${country.currency}</td>
          <td>${country.timezone}</td>
          <td><span class="status ${getStatusClass(country.status)}">${country.status}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-action" type="button" data-action="assign-country-admin" data-id="${country.id}">Admin</button>
              <button class="icon-action ${country.status === "Suspendu" ? "" : "danger"}" type="button" data-action="toggle-country" data-id="${country.id}">
                ${country.status === "Suspendu" ? "Réactiver" : "Suspendre"}
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
  refreshActionVisibility();
}

function renderSubscriptions() {
  subscriptionCount.textContent = `${state.subscriptions.length} abonnement(s)`;
  subscriptionsTable.innerHTML = state.subscriptions
    .map(
      (subscription) => `
        <tr>
          <td><strong>${subscription.schoolCode}</strong><br><small>${subscription.status}</small></td>
          <td>${subscription.country}</td>
          <td>${subscription.plan}</td>
          <td>${subscription.monthlyPrice} ${subscription.currency}</td>
          <td>${subscription.endDate}</td>
          <td><span class="status ${getPaymentClass(subscription.paymentStatus)}">${subscription.paymentStatus}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-action" type="button" data-action="renew-subscription" data-id="${subscription.id}">Renouveler</button>
              <button class="icon-action" type="button" data-action="remind-subscription" data-id="${subscription.id}">Relancer</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
  refreshActionVisibility();
}

function renderNotifications() {
  const unread = state.notifications.filter((notification) => notification.status === "Non lu").length;
  notificationCount.textContent = `${unread} non lue(s)`;
  notificationsList.innerHTML = state.notifications
    .map(
      (notification) => `
        <article class="notification-item">
          <div>
            <strong>${notification.title}</strong>
            <p>${notification.type} • ${notification.priority} • ${(notification.channels ?? []).join(", ")}</p>
            <p>${notification.message}</p>
          </div>
          <div class="row-actions">
            <span class="status ${notification.status === "Non lu" ? "status-warning" : ""}">${notification.status}</span>
            <button class="icon-action" type="button" data-action="read-notification" data-id="${notification.id}">Lu</button>
            <button class="icon-action danger" type="button" data-action="archive-notification" data-id="${notification.id}">Archiver</button>
          </div>
        </article>
      `
    )
    .join("");
  refreshActionVisibility();
}

function renderEstablishmentDashboard() {
  if (!establishmentSummary) return;
  if (!isInternalSchoolRole(state.session?.user?.role)) {
    establishmentScopeLabel.textContent = "";
    establishmentSummary.innerHTML = "";
    schoolRolePilotage.innerHTML = "";
    schoolConfigPanel?.classList.add("hidden");
    return;
  }

  const school = getCurrentSchool();
  const scopedUsers = getScopedUsersForCurrentUser();
  const activeUsers = scopedUsers.filter(isActiveUserAccount);
  const students = getScopedStudentsForCurrentUser();
  const teachers = getScopedTeachersForCurrentUser();
  const classes = getScopedClassesForCurrentUser(students);
  const payments = getScopedPaymentsForCurrentUser(students);
  const presences = getScopedPresencesForCurrentUser(students);
  const notes = getScopedNotesForCurrentUser(students);
  const unreadMessages = getScopedMessagesForCurrentUser(students).filter((message) => normalize(message.status) === "non lu").length;

  establishmentScopeLabel.textContent = school
    ? `${school.name} • ${school.code} • ${school.city ?? "Ville non renseignée"}`
    : "Établissement non chargé";

  establishmentSummary.innerHTML = [
    { label: "Utilisateurs actifs", value: activeUsers.length, hint: "Comptes actifs de l'établissement" },
    { label: "Élèves", value: students.length, hint: "Effectif rattaché au code établissement" },
    { label: "Enseignants", value: teachers.length, hint: "Équipe pédagogique" },
    { label: "Classes", value: classes.length, hint: "Classes configurées ou détectées" },
    { label: "Présences", value: presences.length, hint: "Appels enregistrés" },
    { label: "Notes", value: notes.length, hint: "Notes et évaluations saisies" },
    { label: "Paiements", value: payments.length, hint: "Mouvements financiers visibles" },
    { label: "Messages non lus", value: unreadMessages, hint: "Communications à traiter" },
  ]
    .map(
      (item) => `
        <article>
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatMetric(item.value)}</strong>
          <p>${escapeHtml(item.hint)}</p>
        </article>
      `
    )
    .join("");

  renderSchoolRolePilotage();
  renderSchoolConfigPanel();
  refreshActionVisibility();
}

function renderSchoolRolePilotage() {
  if (!schoolRolePilotage) return;
  if (state.session?.user?.role !== "Admin School") {
    schoolRolePilotage.innerHTML = "";
    return;
  }

  const roles = getSchoolPilotageRoles();
  const features = getDelegableSchoolFeatures();
  if (!state.selectedSchoolPilotageRole || !roles.includes(state.selectedSchoolPilotageRole)) {
    state.selectedSchoolPilotageRole = roles[0] ?? "";
  }
  if (!state.selectedSchoolPilotageFeature || !features.includes(state.selectedSchoolPilotageFeature)) {
    state.selectedSchoolPilotageFeature = features[0] ?? "";
  }

  schoolRolePilotage.innerHTML = `
    <div class="section-head compact-head">
      <div>
        <h3>Pilotage des rôles de l'établissement</h3>
        <p class="section-subtitle">Sélectionnez un rôle et une fonctionnalité, puis activez ou désactivez les droits disponibles dans votre périmètre.</p>
      </div>
    </div>
    ${renderSchoolRoleQuickEditor(roles, features)}
  `;
}

function renderSchoolRoleQuickEditor(roles, features) {
  if (!roles.length || !features.length) {
    return `
      <div class="school-role-editor empty-editor">
        Aucun droit délégable pour ce compte. Les accès doivent d'abord être accordés par l'Admin Pays ou le Superadmin.
      </div>
    `;
  }

  const role = state.selectedSchoolPilotageRole;
  const feature = state.selectedSchoolPilotageFeature;
  return `
    <div class="school-role-editor">
      <label>Rôle
        <select data-school-role-select>
          ${roles.map((item) => `<option value="${escapeHtml(item)}" ${item === role ? "selected" : ""}>${escapeHtml(displayRoleName(item))}</option>`).join("")}
        </select>
      </label>
      <label>Fonctionnalité
        <select data-school-feature-select>
          ${features.map((item) => `<option value="${escapeHtml(item)}" ${item === feature ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
        </select>
      </label>
    </div>
    ${renderSelectedSchoolFeatureRights()}
  `;
}

function renderSelectedSchoolFeatureRights() {
  const role = state.selectedSchoolPilotageRole;
  const feature = state.selectedSchoolPilotageFeature;
  const actions = getDelegableActionsForFeature(feature);
  const permissions = new Set(state.rolePermissions[role] ?? []);

  if (!role || !feature || !actions.length) {
    return `
      <article class="school-role-card">
        <strong>Aucun droit disponible</strong>
        <p>Les accès doivent d'abord être accordés par l'Admin Pays ou le Superadmin.</p>
      </article>
    `;
  }

  return `
    <article class="school-role-card single-feature-rights">
      <div>
        <strong>${escapeHtml(feature)}</strong>
        <p>${escapeHtml(displayRoleName(role))} • ${getVisibleUsers().filter((user) => user.role === role && isActiveUserAccount(user)).length} compte(s) actif(s)</p>
      </div>
      <div class="school-right-column">
        ${actions.map((crudAction) => {
          const permission = `${feature}:${crudAction.key}`;
          const checked = permissions.has(permission);
          return `
            <label class="permission-switch ${checked ? "granted" : "denied"}">
              <input
                type="checkbox"
                data-school-role-toggle
                data-role="${escapeHtml(role)}"
                data-permission="${escapeHtml(permission)}"
                ${checked ? "checked" : ""}
              />
              <span class="switch-track" aria-hidden="true"></span>
              <strong>${crudAction.label}</strong>
              <small>${checked ? "Accordé" : "Refusé"}</small>
            </label>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function renderSchoolConfigPanel() {
  if (!schoolConfigPanel) return;
  const canConfigure = state.session?.user?.role === "Admin School" && hasBackOfficePermission("Paramètres Établissement", "UPDATE");
  schoolConfigPanel.classList.toggle("hidden", !canConfigure);
  if (!canConfigure) return;

  const schoolCode = state.session?.user?.schoolCode;
  const config = getAcademicConfigForSchool(schoolCode);
  schoolConfigPeriodMode.value = config.periodMode ?? "trimestre";
  schoolConfigDefaultScale.value = config.defaultScale ?? 20;
  schoolConfigReportMode.value = config.reportCardMode ?? "period";
  schoolConfigEvaluationTypes.value = (config.evaluationTypes ?? defaultAcademicConfig.evaluationTypes).join("\n");
}


function renderUsers() {
  renderEstablishmentDashboard();
  const query = normalize(userSearch.value);
  const rows = getVisibleUsers().filter((user) =>
    [user.firstName, user.lastName, user.identifier, user.role, user.countryScope, user.schoolCode].some((value) =>
      normalize(value).includes(query)
    )
  );

  usersTable.innerHTML = rows.length
    ? rows.map(renderUserListItem).join("")
    : `
      <div class="empty-list-state">
        Aucun utilisateur ne correspond à cette sélection.
      </div>
    `;
}

function renderUserListItem(user) {
  const active = isActiveUserAccount(user);
  return `
    <article class="user-list-item">
      <div class="user-avatar">${escapeHtml(getUserInitials(user))}</div>
      <div class="user-list-main">
        <div class="user-list-head">
          <div>
            <strong>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</strong>
            <span>${escapeHtml(displayRoleName(user.role))}</span>
          </div>
          <span class="status ${active ? "" : "status-danger"}">${escapeHtml(user.status || "Actif")}</span>
        </div>
        <div class="user-list-meta">
          <span>Identifiant : ${escapeHtml(user.identifier || "Non renseigné")}</span>
          <span>${escapeHtml(user.accessChannel || "Application")}</span>
          <span>${escapeHtml(user.scopeLevel || "Établissement")}${user.countryScope ? ` • ${escapeHtml(user.countryScope)}` : ""}</span>
          ${user.schoolCode && user.schoolCode !== "*" ? `<span>${escapeHtml(user.schoolCode)}</span>` : ""}
        </div>
        ${user.temporaryPassword ? `<p class="user-temp-password">Mot de passe temporaire : ${escapeHtml(user.temporaryPassword)}</p>` : ""}
        <div class="user-list-actions">
          ${
            canManageUserRow(user, "UPDATE")
              ? `<button class="icon-action" type="button" data-action="reset-user-password" data-id="${escapeHtml(user.id)}">Mot de passe</button>`
              : ""
          }
          ${
            canManageUserRow(user, "SUSPEND")
              ? `<button class="icon-action ${user.status === "Suspendu" ? "" : "danger"}" type="button" data-action="toggle-user" data-id="${escapeHtml(user.id)}">
                  ${user.status === "Suspendu" ? "Réactiver" : "Suspendre"}
                </button>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

function getUserInitials(user = {}) {
  const firstName = String(user.firstName ?? "").trim();
  const lastName = String(user.lastName ?? "").trim();
  const fallback = String(user.identifier ?? user.role ?? "U").trim();
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.trim().toUpperCase() || fallback.slice(0, 2).toUpperCase();
}

function renderPermissions() {
  initializeRolePermissions();
  enforceCountryAdminSchoolAdminCrud();
  renderRolePermissionSelector();
  renderRolePermissionMatrix();
}

function renderRolePermissionSelector() {
  const roles = getPermissionRoles();
  const currentRole = state.selectedPermissionRole && roles.includes(state.selectedPermissionRole)
    ? state.selectedPermissionRole
    : state.session.user.role;
  state.selectedPermissionRole = roles.includes(currentRole) ? currentRole : roles[0] ?? "";

  rolePermissionSelect.innerHTML = roles
    .map((role) => `<option value="${escapeHtml(role)}" ${role === state.selectedPermissionRole ? "selected" : ""}>${escapeHtml(displayRoleName(role))}</option>`)
    .join("");
}

function renderRolePermissionMatrix() {
  const selectedRole = state.selectedPermissionRole;
  const permissions = new Set(state.rolePermissions[selectedRole] ?? []);
  const editable = canManageRolePermissions();
  const activeUsersInRole = state.users.filter((user) => user.role === selectedRole && isActiveUserAccount(user)).length;

  permissionCount.textContent = selectedRole
    ? `${permissions.size} droit(s) • ${activeUsersInRole} compte(s) actif(s)`
    : "Aucun rôle";
  rolePermissionNotice.textContent = editable
    ? "Super Admin : glissez à droite pour accorder, à gauche pour refuser."
    : "Lecture seule : seul le Super Admin peut attribuer les droits par rôle.";

  rolePermissionGrid.innerHTML = crudPermissionModules
    .map((moduleName) => {
      const toggles = crudActions
        .map((crudAction) => {
          const permission = `${moduleName}:${crudAction.key}`;
          const checked = permissions.has(permission);
          return `
            <label class="permission-switch ${checked ? "granted" : "denied"}">
              <input
                type="checkbox"
                data-permission-toggle
                data-role="${escapeHtml(selectedRole)}"
                data-permission="${escapeHtml(permission)}"
                ${checked ? "checked" : ""}
                ${editable ? "" : "disabled"}
              />
              <span class="switch-track" aria-hidden="true"></span>
              <strong>${crudAction.label}</strong>
              <small>${checked ? "Accordé" : "Refus"}</small>
            </label>
          `;
        })
        .join("");

      return `
        <article class="role-permission-row">
          <div>
            <strong>${escapeHtml(moduleName)}</strong>
            <span>CRUD</span>
          </div>
          <div class="permission-switches">${toggles}</div>
        </article>
      `;
    })
    .join("");
  refreshActionVisibility();
}

function renderReports() {
  const covered = mvpCoverage.filter((item) => item.status === "Couvert").length;
  const partial = mvpCoverage.filter((item) => item.status === "Partiel").length;
  const missing = mvpCoverage.filter((item) => item.status === "Manquant").length;

  coverageSummary.textContent = `${covered} couvert • ${partial} partiel • ${missing} manquant`;
  coverageGrid.innerHTML = [
    { label: "Couvert", value: covered, className: "status-ok" },
    { label: "Partiel", value: partial, className: "status-warning" },
    { label: "Manquant", value: missing, className: "status-danger" },
    { label: "Modules suivis", value: mvpCoverage.length, className: "" },
  ]
    .map(
      (item) => `
        <article class="coverage-card">
          <span>${item.label}</span>
          <strong class="${item.className}">${item.value}</strong>
        </article>
      `
    )
    .join("");

  roadmapList.innerHTML = mvpCoverage
    .map(
      (item) => `
        <article class="roadmap-item">
          <div>
            <strong>${item.module}</strong>
            <p>${item.scope} • ${item.detail}</p>
          </div>
          <div class="row-actions">
            <span class="status ${getCoverageClass(item.status)}">${item.status}</span>
            <span class="priority">${item.priority}</span>
          </div>
        </article>
      `
    )
    .join("");
  refreshActionVisibility();
}

function getVisibleUsers() {
  const currentUser = state.session?.user;
  if (currentUser?.role === "Admin Pays") {
    const schoolCodes = new Set(getConfigurableSchools().map((school) => school.code));
    return state.users.filter((user) =>
      user.role === "Admin School" &&
      (normalize(user.countryScope) === normalize(currentUser.countryScope) || schoolCodes.has(user.schoolCode))
    );
  }

  if (isInternalSchoolRole(currentUser?.role)) {
    return state.users.filter((user) => normalize(user.schoolCode) === normalize(currentUser.schoolCode));
  }

  return state.users;
}

function canManageUserRow(user, action = "READ") {
  if (!hasBackOfficePermission("Utilisateurs", action)) return false;
  const currentUser = state.session?.user;
  if (isSuperAdminRole(currentUser?.role)) return true;
  if (currentUser?.role === "Admin Pays") {
    return user.role === "Admin School" && getVisibleUsers().some((item) => item.id === user.id);
  }
  return user.schoolCode === currentUser?.schoolCode;
}

function renderAcademicSettings() {
  renderAcademicSchoolOptions();
  renderAcademicSettingsForm();
}

function renderAcademicSchoolOptions() {
  const schools = getConfigurableSchools();
  const current = academicSchoolSelect.value || getDefaultAcademicSchoolCode(schools);

  academicSchoolSelect.innerHTML = schools
    .map((school) => `<option value="${escapeHtml(school.code)}">${escapeHtml(school.name)} (${escapeHtml(school.code)})</option>`)
    .join("");
  academicSchoolSelect.value = schools.some((school) => school.code === current)
    ? current
    : getDefaultAcademicSchoolCode(schools);
  academicSchoolSelect.disabled = schools.length <= 1;
}

function renderAcademicSettingsForm() {
  const schoolCode = academicSchoolSelect.value || getDefaultAcademicSchoolCode(getConfigurableSchools());
  const config = getAcademicConfigForSchool(schoolCode);
  const periods = Array.isArray(config.periods) && config.periods.length
    ? config.periods
    : defaultAcademicConfig.periods;

  academicSettingsStatus.textContent = schoolCode
    ? `${schoolCode} • ${config.periodMode ?? "trimestre"}`
    : "Aucun établissement";
  academicPeriodModeInput.value = config.periodMode ?? "trimestre";
  academicDefaultScaleInput.value = config.defaultScale ?? 20;
  academicReportCardModeInput.value = config.reportCardMode ?? "period";
  academicPeriodsInput.value = periods
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((period) => period.name)
    .join("\n");
  academicEvaluationTypesInput.value = (config.evaluationTypes ?? defaultAcademicConfig.evaluationTypes).join("\n");
  academicAllowClassesInput.checked = config.allowCustomClasses !== false;
  academicAllowCoursesInput.checked = config.allowCustomCourses !== false;
  academicAllowBulletinsInput.checked = config.allowCustomReportCards !== false;

  const editable = canManageAcademicSettings();
  academicSettingsForm.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !editable || (!schoolCode && field !== academicSchoolSelect);
  });
  refreshActionVisibility();
}

async function handleAcademicSettingsSubmit(event) {
  event.preventDefault();

  if (!canManageAcademicSettings()) {
    showToast("Vous n'avez pas le droit de modifier la configuration établissement.");
    return;
  }

  const schoolCode = academicSchoolSelect.value;
  if (!schoolCode) {
    showToast("Sélectionnez un établissement.");
    return;
  }

  const periods = linesFromTextarea(academicPeriodsInput.value).map((name, index) => ({
    id: slugify(`${academicPeriodModeInput.value}-${index + 1}`),
    name,
    order: index + 1,
    active: index === 0,
  }));
  const evaluationTypes = linesFromTextarea(academicEvaluationTypesInput.value);

  if (!periods.length || !evaluationTypes.length) {
    showToast("Ajoutez au moins une période et un type de session.");
    return;
  }

  const payload = {
    schoolCode,
    periodMode: academicPeriodModeInput.value,
    periods,
    evaluationTypes,
    defaultScale: Math.max(1, Number(academicDefaultScaleInput.value || 20)),
    reportCardMode: academicReportCardModeInput.value,
    allowCustomClasses: academicAllowClassesInput.checked,
    allowCustomCourses: academicAllowCoursesInput.checked,
    allowCustomReportCards: academicAllowBulletinsInput.checked,
  };

  try {
    const saved = await request("/academic-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.academicConfigs[saved.schoolCode] = { ...payload, ...saved };
    addAudit("Configuration établissement", saved.schoolCode, `${saved.periodMode} • ${saved.periods.length} période(s) • barème /${saved.defaultScale}`);
    renderAcademicSettings();
    persistSession();
    showToast("Configuration établissement enregistrée et synchronisée.");
  } catch (error) {
    showToast(error.message);
  }
}

function getConfigurableSchools() {
  const user = state.session?.user ?? {};
  if (user.role === "Admin School" && user.schoolCode && user.schoolCode !== "*") {
    return state.schools.filter((school) => school.code === user.schoolCode);
  }

  if (user.role === "Admin Pays" && user.countryScope) {
    return state.schools.filter((school) => school.countryCode === user.countryScope || school.country === user.countryScope);
  }

  return state.schools;
}

function getDefaultAcademicSchoolCode(schools) {
  const userSchool = state.session?.user?.schoolCode;
  if (userSchool && userSchool !== "*" && schools.some((school) => school.code === userSchool)) {
    return userSchool;
  }

  return schools[0]?.code ?? "";
}

function getAcademicConfigForSchool(schoolCode) {
  return {
    ...defaultAcademicConfig,
    ...(state.academicConfigs[schoolCode] ?? {}),
    schoolCode,
  };
}

function canManageAcademicSettings() {
  return hasBackOfficePermission("Paramètres Établissement", "UPDATE");
}

async function saveSchoolUserSettings() {
  if (state.session?.user?.role !== "Admin School" || !hasBackOfficePermission("Paramètres Établissement", "UPDATE")) {
    showToast("Action réservée à l'Admin établissement.");
    return;
  }

  const schoolCode = state.session.user.schoolCode;
  const evaluationTypes = linesFromTextarea(schoolConfigEvaluationTypes?.value ?? "");
  if (!evaluationTypes.length) {
    showToast("Ajoutez au moins un type d'évaluation.");
    return;
  }

  const current = getAcademicConfigForSchool(schoolCode);
  const periodMode = schoolConfigPeriodMode.value || current.periodMode || "trimestre";
  const defaultScale = Math.max(1, Number(schoolConfigDefaultScale.value || current.defaultScale || 20));
  const payload = {
    ...current,
    schoolCode,
    periodMode,
    defaultScale,
    reportCardMode: schoolConfigReportMode.value || current.reportCardMode || "period",
    evaluationTypes,
    periods: Array.isArray(current.periods) && current.periods.length
      ? current.periods
      : defaultAcademicConfig.periods,
  };

  try {
    const saved = await request("/academic-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.academicConfigs[saved.schoolCode] = { ...payload, ...saved };
    addAudit("Configuration établissement", saved.schoolCode, `${saved.periodMode} • barème /${saved.defaultScale}`);
    persistSession();
    renderUsers();
    showToast("Configuration interne enregistrée.");
  } catch (error) {
    showToast(error.message);
  }
}

function getSchoolPilotageRoles() {
  const roles = new Set(["Secrétaire", "Préfet des études", "Enseignant", "Parent", "Élève / Étudiant"]);
  getVisibleUsers().forEach((user) => {
    if (!isSuperAdminRole(user.role) && !["Admin Pays", "Admin School"].includes(user.role)) {
      roles.add(user.role);
    }
  });
  return [...roles].filter(Boolean).sort((a, b) => displayRoleName(a).localeCompare(displayRoleName(b), "fr"));
}

function getDelegableSchoolFeatures() {
  const features = ["Utilisateurs", "Classes", "Élèves", "Enseignants", "Affectations", "Présences", "Notes", "Bulletins", "Paiements", "Notifications", "Messages", "Documents", "Rapports", "Années Académiques", "Matières", "Examens", "Paramètres Établissement"];
  return features.filter((feature) => getDelegableActionsForFeature(feature).length > 0);
}

function getDelegableActionsForFeature(feature) {
  return crudActions.filter((crudAction) => hasBackOfficePermission(feature, crudAction.key));
}

function isSchoolFeatureEnabledForRole(role, feature) {
  const permissions = new Set(state.rolePermissions[role] ?? []);
  const actions = getDelegableActionsForFeature(feature);
  return actions.length > 0 && actions.every((action) => permissions.has(`${feature}:${action.key}`));
}

function linesFromTextarea(value) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "periode";
}

function showView(viewName) {
  const titles = {
    overview: "Vue globale",
    countries: "Pays",
    schools: "Établissements",
    subscriptions: "Abonnements",
    notifications: "Notifications",
    users: "Utilisateurs",
    reports: "Rapports",
    permissions: "Permissions",
    academicSettings: "Configuration",
  };

  if (!canReadView(viewName)) {
    showToast("Accès refusé pour ce module.");
    viewName = "overview";
  }

  closeDetail();
  closeSchoolForm();
  closeRoleForm();
  setActiveView(viewName);
  pageTitle.textContent = titles[viewName] ?? "Plateforme";
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  document.querySelector(`#${viewName}View`)?.classList.remove("hidden");
  refreshActionVisibility();
}

function setActiveView(viewName) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });
}

async function handleActionClick(event) {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const { action, id } = button.dataset;

  if (!action) return;

  if (!canRunBackOfficeAction(action, button)) {
    showToast("Action non autorisée pour ce rôle.");
    return;
  }

  if (action === "refresh-dashboard") {
    renderOperationalViews();
    renderControls();
    showToast("Tableau de bord actualisé.");
    return;
  }

  if (action === "inspect-control") {
    openPermissionDetail(id, "Contrôle métier");
    return;
  }

  if (action === "open-business-control") {
    const targetView = button.dataset.view;
    if (!targetView) return;
    showView(targetView);
    showToast(`Module ${button.dataset.label ?? "Plateforme"} ouvert.`);
    return;
  }

  if (action === "save-school-user-settings") {
    await saveSchoolUserSettings();
    return;
  }

  if (action === "inspect-permission") {
    openPermissionDetail(id, "Permission du compte");
    return;
  }

  if (action === "create-role") {
    createRole();
    return;
  }

  if (action === "rename-role") {
    renameSelectedRole();
    return;
  }

  if (action === "delete-role") {
    deleteSelectedRole();
    return;
  }

  if (action === "save-role-permissions") {
    if (!canManageRolePermissions()) {
      showToast("Seul le Super Admin peut enregistrer les droits.");
      return;
    }

    applySelectedRolePermissions();
    persistSession();
    renderUsers();
    renderControls();
    renderPermissions();
    showToast(`Droits du rôle ${state.selectedPermissionRole} enregistrés.`);
    return;
  }

  if (action === "reset-role-permissions") {
    initializeRolePermissions({ force: true });
    renderPermissions();
    showToast("Droits réinitialisés depuis les comptes existants.");
    return;
  }

  if (action === "previous-school-page") {
    state.schoolPage = Math.max(1, state.schoolPage - 1);
    renderSchools();
    return;
  }

  if (action === "next-school-page") {
    state.schoolPage += 1;
    renderSchools();
    return;
  }

  if (action === "close-detail") {
    closeDetail();
    return;
  }

  if (action === "close-school-form") {
    closeSchoolForm();
    return;
  }

  if (action === "close-role-form") {
    closeRoleForm();
    return;
  }

  if (action === "add-country") {
    openCountryForm();
    return;
  }

  if (action === "assign-country-admin") {
    const target = id ? state.countries.find((country) => country.id === id) : state.countries.find((country) => !country.administratorId);
    if (!target) {
      showToast("Aucun pays sans administrateur à affecter.");
      return;
    }

    target.administratorId = target.administratorId || getAvailableCountryAdminId(target);
    addAudit("Affectation administrateur pays", target.code, `Administrateur ${target.administratorId} affecté`);
    renderOperationalViews();
    persistSession();
    showToast(`Administrateur affecté à ${target.code}.`);
    return;
  }

  if (action === "toggle-country") {
    const target = state.countries.find((country) => country.id === id);
    if (!target) return;
    target.status = target.status === "Suspendu" ? "Actif" : "Suspendu";
    addAudit("Changement statut pays", target.code, `${target.name} passé à ${target.status}`);
    renderOperationalViews();
    persistSession();
    showToast(`Pays ${target.status.toLowerCase()}.`);
    return;
  }

  if (action === "save-country-form") {
    saveCountryForm();
    return;
  }

  if (action === "add-school") {
    openSchoolForm();
    return;
  }

  if (action === "edit-school") {
    const target = state.schools.find((school) => school.code === id);
    if (!target) return;
    openSchoolForm(target);
    return;
  }

  if (action === "validate-schools") {
    const count = state.schools.filter((school) => school.validationStatus === "En attente").length;
    state.schools.forEach((school) => {
      if (school.validationStatus === "En attente") {
        school.validationStatus = "Validé";
      }
    });
    addAudit("Validation établissements", "bulk", `${count} établissement(s) validé(s)`);
    renderOperationalViews();
    persistSession();
    showToast(`${count} établissement(s) validé(s).`);
    return;
  }

  if (action === "validate-school") {
    const target = state.schools.find((school) => school.code === id);
    if (!target) return;
    target.validationStatus = "Validé";
    addAudit("Validation établissement", target.code, `${target.name} validé`);
    renderOperationalViews();
    persistSession();
    showToast(`${target.name} validé.`);
    return;
  }

  if (action === "inspect-school") {
    const target = state.schools.find((school) => school.code === id);
    if (!target) return;
    openSchoolDetail(target);
    return;
  }

  if (action === "toggle-school") {
    const target = state.schools.find((school) => school.code === id);
    if (!target) return;
    target.status = target.status === "Suspendu" ? "Actif" : "Suspendu";
    addAudit("Changement statut établissement", target.code, `${target.name} passé à ${target.status}`);
    renderOperationalViews();
    persistSession();
    showToast(`Établissement ${target.status.toLowerCase()}.`);
    return;
  }

  if (action === "renew-subscriptions") {
    state.subscriptions.forEach(renewSubscription);
    state.subscriptions.forEach((subscription) => addAudit("Renouvellement abonnement", subscription.schoolCode, `Abonnement renouvelé jusqu'au ${subscription.endDate}`));
    renderOperationalViews();
    persistSession();
    showToast("Tous les abonnements ont été renouvelés.");
    return;
  }

  if (action === "renew-subscription") {
    const target = state.subscriptions.find((subscription) => subscription.id === id);
    if (!target) return;
    renewSubscription(target);
    addAudit("Renouvellement abonnement", target.schoolCode, `Abonnement renouvelé jusqu'au ${target.endDate}`);
    renderOperationalViews();
    persistSession();
    showToast(`Abonnement ${target.schoolCode} renouvelé.`);
    return;
  }

  if (action === "remind-subscriptions") {
    const count = markSubscriptionReminders(state.subscriptions);
    renderOperationalViews();
    persistSession();
    showToast(`${count} relance(s) abonnement enregistrée(s).`);
    return;
  }

  if (action === "remind-subscription") {
    const target = state.subscriptions.find((subscription) => subscription.id === id);
    if (!target) return;
    markSubscriptionReminders([target]);
    renderOperationalViews();
    persistSession();
    showToast(`Relance enregistrée pour ${target.schoolCode}.`);
    return;
  }

  if (action === "add-notification") {
    openNotificationForm();
    return;
  }

  if (action === "save-notification-form") {
    saveNotificationForm();
    return;
  }

  if (action === "read-all-notifications") {
    state.notifications.forEach((notification) => {
      notification.status = "Lu";
    });
    addAudit("Lecture notifications", "bulk", "Toutes les notifications marquées comme lues");
    renderOperationalViews();
    persistSession();
    showToast("Toutes les notifications sont marquées comme lues.");
    return;
  }

  if (action === "read-notification") {
    const target = state.notifications.find((notification) => notification.id === id);
    if (!target) return;
    target.status = "Lu";
    addAudit("Lecture notification", target.id, target.title);
    renderOperationalViews();
    persistSession();
    showToast("Notification marquée comme lue.");
    return;
  }

  if (action === "archive-notification") {
    const target = state.notifications.find((notification) => notification.id === id);
    state.notifications = state.notifications.filter((notification) => notification.id !== id);
    addAudit("Archivage notification", id, target?.title ?? "Notification archivée");
    renderOperationalViews();
    persistSession();
    showToast("Notification archivée.");
    return;
  }

  if (action === "add-user") {
    openUserForm();
    return;
  }

  if (action === "save-user-form") {
    saveUserForm();
    return;
  }

  if (action === "reset-passwords") {
    const targets = getVisibleUsers().filter((user) => canManageUserRow(user, "UPDATE"));
    for (const user of targets) {
      const temporaryPassword = generateTemporaryPassword();
      const response = await request(`/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ temporaryPassword }),
      });
      user.temporaryPassword = response.temporaryPassword ?? temporaryPassword;
      user.mustChangePassword = true;
    }
    addAudit("Réinitialisation mots de passe", "bulk", `${targets.length} mot(s) de passe temporaire réinitialisé(s)`);
    renderOperationalViews();
    persistSession();
    showToast(`${targets.length} mot(s) de passe temporaire réinitialisé(s) à 1234.`);
    return;
  }

  if (action === "reset-user-password") {
    const target = state.users.find((user) => user.id === id);
    if (!target) return;
    if (!canManageUserRow(target, "UPDATE")) {
      showToast("Action non autorisée sur cet utilisateur.");
      return;
    }
    const temporaryPassword = generateTemporaryPassword();
    const response = await request(`/users/${encodeURIComponent(target.id)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ temporaryPassword }),
    });
    target.temporaryPassword = response.temporaryPassword ?? temporaryPassword;
    target.mustChangePassword = true;
    target.history = [...(target.history ?? []), `Mot de passe réinitialisé le ${formatDate(new Date())}`];
    addAudit("Réinitialisation mot de passe", target.identifier, `${target.firstName} ${target.lastName}`);
    renderOperationalViews();
    persistSession();
    showToast(`Mot de passe de ${target.identifier} réinitialisé : ${target.temporaryPassword}`);
    return;
  }

  if (action === "toggle-user") {
    const target = state.users.find((user) => user.id === id);
    if (!target) return;
    if (!canManageUserRow(target, "SUSPEND")) {
      showToast("Action non autorisée sur cet utilisateur.");
      return;
    }
    target.status = target.status === "Suspendu" ? "Actif" : "Suspendu";
    addAudit("Changement statut utilisateur", target.identifier, `${target.firstName} ${target.lastName} passé à ${target.status}`);
    renderOperationalViews();
    persistSession();
    showToast(`Utilisateur ${target.status.toLowerCase()}.`);
    return;
  }

  if (action === "export-permissions") {
    const role = state.selectedPermissionRole;
    const permissions = state.rolePermissions[role] ?? state.session.user.permissions ?? [];
    const payload = [`Rôle: ${role}`, ...permissions].join("\n");
    const copied = await copyToClipboard(payload);
    if (copied) {
      showToast("Permissions exportées dans le presse-papiers.");
    } else {
      openTextExport("Permissions du compte", payload);
    }
    return;
  }

  if (action === "export-mvp-report") {
    const report = mvpCoverage
      .map((item) => `${item.priority} | ${item.status} | ${item.scope} | ${item.module} | ${item.detail}`)
      .join("\n");
    const copied = await copyToClipboard(report);
    if (copied) {
      showToast("Rapport MVP copié dans le presse-papiers.");
    } else {
      openTextExport("Rapport MVP", report);
    }
  }
}

function handlePermissionToggle(event) {
  const schoolRoleSelect = event.target.closest("[data-school-role-select]");
  if (schoolRoleSelect) {
    state.selectedSchoolPilotageRole = schoolRoleSelect.value;
    renderSchoolRolePilotage();
    return;
  }

  const schoolFeatureSelect = event.target.closest("[data-school-feature-select]");
  if (schoolFeatureSelect) {
    state.selectedSchoolPilotageFeature = schoolFeatureSelect.value;
    renderSchoolRolePilotage();
    return;
  }

  const schoolInput = event.target.closest("[data-school-role-toggle]");
  if (schoolInput) {
    handleSchoolRoleToggle(schoolInput);
    return;
  }

  const input = event.target.closest("[data-permission-toggle]");

  if (!input) return;

  if (!canManageRolePermissions()) {
    input.checked = !input.checked;
    showToast("Seul le Super Admin peut modifier les droits.");
    return;
  }

  const role = input.dataset.role;
  const permission = input.dataset.permission;
  const rolePermissions = new Set(state.rolePermissions[role] ?? []);

  if (input.checked) {
    rolePermissions.add(permission);
  } else {
    rolePermissions.delete(permission);
  }

  state.rolePermissions[role] = [...rolePermissions].sort(sortPermissions);
  applyRolePermissions(role);
  persistSession();
  renderMenus();
  renderControls();
  renderUsers();
  renderRolePermissionMatrix();
  showToast(`${permission} ${input.checked ? "accordé" : "refusé"} pour ${role}.`);
}

function handleSchoolRoleToggle(input) {
  if (state.session?.user?.role !== "Admin School") {
    input.checked = !input.checked;
    showToast("Seul l'Admin établissement peut piloter ces rôles ici.");
    return;
  }

  const role = input.dataset.role;
  const permission = input.dataset.permission;
  const [feature, action] = String(permission ?? "").split(":");
  if (!getSchoolPilotageRoles().includes(role)) {
    input.checked = !input.checked;
    showToast("Ce rôle n'appartient pas au pilotage de l'établissement.");
    return;
  }
  if (!getDelegableActionsForFeature(feature).some((crudAction) => crudAction.key === action)) {
    input.checked = !input.checked;
    showToast("Ce droit n'est pas dans votre périmètre accordé.");
    return;
  }

  const rolePermissions = new Set(state.rolePermissions[role] ?? []);
  if (input.checked) {
    rolePermissions.add(permission);
  } else {
    rolePermissions.delete(permission);
  }

  state.rolePermissions[role] = [...rolePermissions].sort(sortPermissions);
  applyRolePermissions(role);
  persistSession();
  renderMenus();
  renderControls();
  renderUsers();
  showToast(`${permission} ${input.checked ? "accordé" : "refusé"} pour ${displayRoleName(role)}.`);
}

function renewSubscription(subscription) {
  subscription.status = "Actif";
  subscription.paymentStatus = "À jour";
  subscription.endDate = addOneYearDate(subscription.endDate);
  subscription.lastPaymentDate = formatDate(new Date());
  subscription.lastReminderDate = "";
}

function markSubscriptionReminders(subscriptions) {
  let count = 0;
  subscriptions.forEach((subscription) => {
    if (subscription.paymentStatus === "En retard" || isPastDate(subscription.endDate)) {
      subscription.lastReminderDate = formatDate(new Date());
      subscription.paymentStatus = "En retard";
      addAudit("Relance abonnement", subscription.schoolCode, `Relance envoyée pour l'abonnement ${subscription.plan}`);
      count += 1;
    }
  });
  return count;
}

function renderOperationalViews() {
  renderKpis();
  renderCountries();
  renderSchools();
  renderSubscriptions();
  renderNotifications();
  renderUsers();
  renderReports();
  renderAcademicSettings();
  refreshActionVisibility();
}

function persistSession({ sync = true } = {}) {
  if (!state.session) return;

  enforceCountryAdminSchoolAdminCrud();
  state.session.schools = state.schools;
  state.session.users = state.users;
  state.session.countries = state.countries;
  state.session.subscriptions = state.subscriptions;
  state.session.notifications = state.notifications;
  state.session.students = state.students;
  state.session.teachers = state.teachers;
  state.session.classes = state.classes;
  state.session.courses = state.courses;
  state.session.assignments = state.assignments;
  state.session.payments = state.payments;
  state.session.presences = state.presences;
  state.session.notes = state.notes;
  state.session.announcements = state.announcements;
  state.session.messages = state.messages;
  state.session.paymentStatuses = state.paymentStatuses;
  state.session.auditLog = state.auditLog;
  state.session.rolePermissions = state.rolePermissions;
  state.session.academicConfigs = state.academicConfigs;

  if (sync) {
    scheduleBackOfficeSync();
  }
}

async function refreshBackOfficeStateFromBackend() {
  try {
    const backendState = await request("/backoffice/state");
    applyBackOfficeState(backendState);
    persistSession({ sync: false });
    renderOperationalViews();
  } catch (error) {
    console.warn("Synchronisation plateforme indisponible.", error);
  }
}

function applyBackOfficeState(backendState = {}) {
  if (Array.isArray(backendState.schools) && backendState.schools.length) state.schools = backendState.schools;
  if (Array.isArray(backendState.users) && backendState.users.length) state.users = backendState.users;
  if (Array.isArray(backendState.countries) && backendState.countries.length) state.countries = backendState.countries;
  if (Array.isArray(backendState.subscriptions) && backendState.subscriptions.length) state.subscriptions = backendState.subscriptions;
  if (Array.isArray(backendState.notifications) && backendState.notifications.length) state.notifications = backendState.notifications;
  if (Array.isArray(backendState.students)) state.students = backendState.students;
  if (Array.isArray(backendState.teachers)) state.teachers = backendState.teachers;
  if (Array.isArray(backendState.classes)) state.classes = backendState.classes;
  if (Array.isArray(backendState.courses)) state.courses = backendState.courses;
  if (Array.isArray(backendState.assignments)) state.assignments = backendState.assignments;
  if (Array.isArray(backendState.payments)) state.payments = backendState.payments;
  if (Array.isArray(backendState.presences)) state.presences = backendState.presences;
  if (Array.isArray(backendState.notes)) state.notes = backendState.notes;
  if (Array.isArray(backendState.announcements)) state.announcements = backendState.announcements;
  if (Array.isArray(backendState.messages)) state.messages = backendState.messages;
  if (Array.isArray(backendState.paymentStatuses)) state.paymentStatuses = backendState.paymentStatuses;
  if (Array.isArray(backendState.auditLog) && backendState.auditLog.length) state.auditLog = backendState.auditLog;
  if (backendState.rolePermissions && typeof backendState.rolePermissions === "object") {
    state.rolePermissions = backendState.rolePermissions;
  }
  if (backendState.academicConfigs && typeof backendState.academicConfigs === "object") {
    state.academicConfigs = backendState.academicConfigs;
  }
  enforceCountryAdminSchoolAdminCrud();
}

function getBackOfficeStatePayload() {
  return {
    schools: state.schools,
    users: state.users,
    countries: state.countries,
    subscriptions: state.subscriptions,
    notifications: state.notifications,
    students: state.students,
    teachers: state.teachers,
    classes: state.classes,
    courses: state.courses,
    assignments: state.assignments,
    payments: state.payments,
    presences: state.presences,
    notes: state.notes,
    announcements: state.announcements,
    messages: state.messages,
    paymentStatuses: state.paymentStatuses,
    auditLog: state.auditLog,
    rolePermissions: state.rolePermissions,
    academicConfigs: state.academicConfigs,
  };
}

function scheduleBackOfficeSync() {
  clearTimeout(state.syncTimeoutId);
  state.syncTimeoutId = setTimeout(() => {
    syncBackOfficeState().catch((error) => {
      console.warn("Échec de synchronisation plateforme.", error);
      showToast("Synchronisation backend indisponible.");
    });
  }, 350);
}

async function syncBackOfficeState() {
  if (!state.session?.accessToken) return;
  const synced = await request("/backoffice/state", {
    method: "PUT",
    body: JSON.stringify(getBackOfficeStatePayload()),
  });
  applyBackOfficeState(synced);
  renderOperationalViews();
}

function startRealtimeSync() {
  stopRealtimeSync();
  state.realtimeIntervalId = setInterval(() => {
    if (!state.session?.accessToken) return;
    refreshBackOfficeStateFromBackend();
  }, SYNC_INTERVAL_MS);
}

function stopRealtimeSync() {
  if (state.realtimeIntervalId) {
    clearInterval(state.realtimeIntervalId);
    state.realtimeIntervalId = null;
  }
}

function initializeRolePermissions({ force = false } = {}) {
  if (!force && Object.keys(state.rolePermissions).length) {
    return;
  }

  const matrix = {};
  const allAccounts = [state.session?.user, ...state.users].filter(Boolean);

  allAccounts.forEach((account) => {
    if (!account.role) return;
    const existingPermissions = matrix[account.role] ?? [];
    matrix[account.role] = [...new Set([...existingPermissions, ...(account.permissions ?? [])])].sort(sortPermissions);
  });

  if (state.session?.user?.role && !matrix[state.session.user.role]) {
    matrix[state.session.user.role] = [...(state.session.user.permissions ?? [])].sort(sortPermissions);
  }

  state.rolePermissions = matrix;
  enforceCountryAdminSchoolAdminCrud();
  state.selectedPermissionRole = state.selectedPermissionRole || state.session?.user?.role || Object.keys(matrix)[0] || "";
}

function enforceCountryAdminSchoolAdminCrud() {
  const superAdminPermissions = new Set(
    state.rolePermissions["Super Administrateur Somafrik"] ??
      state.rolePermissions["Super Administrateur OKAFRIK"] ??
      [],
  );
  superAdminPermissions.add("ALL_PRIVILEGES");
  crudPermissionModules.forEach((moduleName) => {
    crudActions.forEach((crudAction) => superAdminPermissions.add(`${moduleName}:${crudAction.key}`));
  });
  state.rolePermissions["Super Administrateur Somafrik"] = [...superAdminPermissions].sort(sortPermissions);

  const countryAdminPermissions = new Set(state.rolePermissions["Admin Pays"] ?? []);
  countryAdminSchoolAdminPermissions.forEach((permission) => countryAdminPermissions.add(permission));
  state.rolePermissions["Admin Pays"] = [...countryAdminPermissions].sort(sortPermissions);

  Object.entries(internalRoleDefaultPermissions).forEach(([roleName, defaults]) => {
    const rolePermissions = new Set(state.rolePermissions[roleName] ?? []);
    if (!rolePermissions.size) {
      defaults.forEach((permission) => rolePermissions.add(permission));
    }
    if (roleName === "Admin School") {
      rolePermissions.add("Paramètres Établissement:READ");
      rolePermissions.add("Paramètres Établissement:UPDATE");
    }
    [...rolePermissions].forEach((permission) => {
      if (isInternalRoleForbiddenPermission(permission)) {
        rolePermissions.delete(permission);
      }
    });
    state.rolePermissions[roleName] = [...rolePermissions].sort(sortPermissions);
  });

  state.users = state.users.map((user) => {
    if (internalRoleDefaultPermissions[user.role]) {
      return {
        ...user,
        permissions: [...(state.rolePermissions[user.role] ?? user.permissions ?? [])].sort(sortPermissions),
      };
    }

    if (user.role !== "Admin Pays") return user;
    return {
      ...user,
      scopeLevel: "Pays",
      schoolCode: "*",
      countryScope: user.countryScope || state.session?.user?.countryScope || "",
      permissions: [...(state.rolePermissions["Admin Pays"] ?? user.permissions ?? [])].sort(sortPermissions),
    };
  });

  if (state.session?.user?.role === "Admin Pays") {
    state.session.user.permissions = [...(state.rolePermissions["Admin Pays"] ?? state.session.user.permissions ?? [])].sort(sortPermissions);
    state.session.user.scopeLevel = "Pays";
    state.session.user.schoolCode = "*";
  }

  if (state.session?.user?.role === "Admin School") {
    state.session.user.permissions = [...(state.rolePermissions["Admin School"] ?? state.session.user.permissions ?? [])].sort(sortPermissions);
  }

  if (state.session?.user?.role === "Secrétaire" || state.session?.user?.role === "Sécretaire") {
    state.session.user.permissions = [...(state.rolePermissions[state.session.user.role] ?? state.session.user.permissions ?? [])].sort(sortPermissions);
  }

  if (state.session?.user?.role === "Préfet des études") {
    state.session.user.permissions = [...(state.rolePermissions["Préfet des études"] ?? state.session.user.permissions ?? [])].sort(sortPermissions);
  }
}

function isSchoolAdminForbiddenPermission(permission) {
  return isInternalRoleForbiddenPermission(permission);
}

function isInternalRoleForbiddenPermission(permission) {
  const normalizedPermission = normalize(permission);
  if (String(permission).startsWith("Paramètres Établissement")) {
    return false;
  }
  return (
    [...schoolAdminForbiddenFeatures].some((featureName) => String(permission).startsWith(featureName)) ||
    schoolAdminForbiddenPermissionKeywords.some((keyword) => normalizedPermission.includes(keyword))
  );
}

function getPermissionRoles() {
  const roles = new Set([state.session?.user?.role, ...state.users.map((user) => user.role), ...Object.keys(state.rolePermissions)]);
  return [...roles].filter(Boolean).sort((a, b) => {
    if (a === "Super Administrateur Somafrik") return -1;
    if (b === "Super Administrateur Somafrik") return 1;
    return a.localeCompare(b, "fr");
  });
}

function canManageRolePermissions() {
  return isSuperAdminRole(state.session?.user?.role);
}

function getCurrentRolePermissions() {
  const role = state.session?.user?.role;
  if (role && Array.isArray(state.rolePermissions[role])) {
    return [...new Set(state.rolePermissions[role])];
  }

  const userPermissions = state.session?.user?.permissions ?? [];
  return [...new Set(userPermissions)];
}

function hasBackOfficePermission(features, action = "READ") {
  if (!state.session?.user) return false;
  const normalizedAction = action === "R" ? "READ" : action;
  const featureList = Array.isArray(features) ? features : [features];
  const permissions = new Set(getCurrentRolePermissions());

  if (isInternalSchoolRole(state.session.user.role) && featureList.some((feature) => schoolAdminForbiddenFeatures.has(feature))) {
    return false;
  }

  if (permissions.has("ALL_PRIVILEGES")) return true;
  if (featureList.includes("Droits par rôle")) return canManageRolePermissions();

  return featureList.some((feature) => {
    if (!feature) return true;
    if (permissions.has(`${feature}:${normalizedAction}`) || permissions.has(`${feature}:CRUD`)) return true;
    if (normalizedAction === "READ" && (permissions.has(`${feature}:R`) || permissions.has(`${feature}:READ`))) return true;
    if (crudPermissionModules.includes(feature)) return false;

    const normalizedFeature = normalize(feature);
    return [...permissions].some((permission) => {
      const normalizedPermission = normalize(permission);
      if (normalizedPermission === "country-privileges" && normalizedFeature === "pays") {
        return normalizedAction === "READ";
      }
      if (normalizedPermission === "country-privileges" && ["établissements", "etablissements", "abonnements", "utilisateurs", "rapports"].includes(normalizedFeature)) {
        return true;
      }
      return normalizedPermission.includes(normalizedFeature) && (
        normalizedAction === "READ" ||
        normalizedPermission.includes(normalize(normalizedAction)) ||
        normalizedPermission.includes("gerer") ||
        normalizedPermission.includes("creer") ||
        normalizedPermission.includes("modifier") ||
        normalizedPermission.includes("suspendre") ||
        normalizedPermission.includes("reactiver") ||
        normalizedPermission.includes("supprimer")
      );
    });
  });
}

function canReadView(viewName) {
  if (viewName === "overview") return true;
  return hasBackOfficePermission(viewPermissionFeatures[viewName], "READ");
}

function getActionPermission(action) {
  return actionPermissions[action] ?? null;
}

function canRunBackOfficeAction(action, button = null) {
  if (unrestrictedActions.has(action)) return true;
  if (action === "inspect-school") return hasBackOfficePermission("Établissements", "READ");
  if (action === "inspect-control") return true;
  if (action === "inspect-permission") return canManageRolePermissions();
  if (action === "open-business-control") return canReadView(button?.dataset?.view);

  const permission = getActionPermission(action);
  if (!permission) return true;
  return hasBackOfficePermission(permission[0], permission[1]);
}

function refreshActionVisibility() {
  if (!state.session) return;

  document.querySelectorAll("[data-action]").forEach((button) => {
    const allowed = canRunBackOfficeAction(button.dataset.action, button);
    button.classList.toggle("hidden", !allowed);
    button.disabled = !allowed;
    if (!allowed) {
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-disabled");
    }
  });
}

function applySelectedRolePermissions() {
  applyRolePermissions(state.selectedPermissionRole);
}

function applyRolePermissions(role) {
  if (!role) return;
  const permissions = state.rolePermissions[role] ?? [];

  state.users = state.users.map((user) => (
    user.role === role ? { ...user, permissions: [...permissions] } : user
  ));

  if (state.session.user.role === role) {
    state.session.user.permissions = [...permissions];
  }
}

function createRole() {
  if (!canManageRolePermissions()) {
    showToast("Seul le Super Admin peut créer un rôle.");
    return;
  }

  openRoleForm("create");
}

function renameSelectedRole() {
  if (!canManageRolePermissions()) {
    showToast("Seul le Super Admin peut modifier un rôle.");
    return;
  }

  const currentRole = state.selectedPermissionRole;
  if (!currentRole) return;

  if (isSuperAdminRole(currentRole)) {
    openRoleForm("rename-protected", currentRole);
    return;
  }

  openRoleForm("rename", currentRole);
}

function deleteSelectedRole() {
  if (!canManageRolePermissions()) {
    showToast("Seul le Super Admin peut supprimer un rôle.");
    return;
  }

  const role = state.selectedPermissionRole;
  if (!role) return;

  if (isSuperAdminRole(role)) {
    openRoleForm("delete-protected", role);
    return;
  }

  const usersInRole = state.users.filter((user) => user.role === role).length;
  if (usersInRole > 0) {
    openRoleForm("delete-blocked", role);
    return;
  }

  openRoleForm("delete", role);
}

function openRoleForm(mode, role = "") {
  closeSchoolForm();
  roleForm.reset();
  roleForm.dataset.mode = mode;
  roleOriginalName.value = role;
  roleFormError.textContent = "";
  roleDeleteWarning.classList.add("hidden");
  roleNameLabel.classList.remove("hidden");
  roleNameInput.disabled = false;
  roleNameInput.required = true;
  roleSubmitButton.disabled = false;
  roleSubmitButton.classList.remove("muted-action");

  if (mode === "create") {
    roleFormMode.textContent = "Création";
    roleFormTitle.textContent = "Créer un rôle";
    roleSubmitButton.textContent = "Créer";
  }

  if (mode === "rename") {
    roleFormMode.textContent = "Modification";
    roleFormTitle.textContent = "Modifier le rôle";
    roleNameInput.value = role;
    roleSubmitButton.textContent = "Enregistrer";
  }

  if (mode === "delete") {
    roleFormMode.textContent = "Suppression";
    roleFormTitle.textContent = "Supprimer le rôle";
    roleNameInput.value = role;
    roleNameInput.disabled = true;
    roleNameInput.required = false;
    roleDeleteWarning.textContent = `Confirmez la suppression du rôle "${role}". Cette action retire le rôle de la matrice des droits.`;
    roleDeleteWarning.classList.remove("hidden");
    roleSubmitButton.textContent = "Supprimer";
  }

  if (mode === "rename-protected") {
    roleFormMode.textContent = "Modification";
    roleFormTitle.textContent = "Modifier le rôle";
    roleNameInput.value = role;
    roleNameInput.disabled = true;
    roleNameInput.required = false;
    roleDeleteWarning.textContent = "Ce rôle est protégé : il garantit l'accès complet du Super Admin et ne peut pas être renommé.";
    roleDeleteWarning.classList.remove("hidden");
    roleSubmitButton.textContent = "Verrouillé";
    roleSubmitButton.disabled = true;
    roleSubmitButton.classList.add("muted-action");
  }

  if (mode === "delete-protected" || mode === "delete-blocked") {
    const usersInRole = state.users.filter((user) => user.role === role).length;
    roleFormMode.textContent = "Suppression";
    roleFormTitle.textContent = "Supprimer le rôle";
    roleNameInput.value = role;
    roleNameInput.disabled = true;
    roleNameInput.required = false;
    roleDeleteWarning.textContent = mode === "delete-protected"
      ? "Ce rôle est protégé : il garantit l'accès complet du Super Admin et ne peut pas être supprimé."
      : `Ce rôle ne peut pas être supprimé tant que ${usersInRole} compte(s) l'utilisent.`;
    roleDeleteWarning.classList.remove("hidden");
    roleSubmitButton.textContent = "Suppression bloquée";
    roleSubmitButton.disabled = true;
    roleSubmitButton.classList.add("muted-action");
  }

  roleModal.classList.remove("hidden");
  if (mode !== "delete") {
    roleNameInput.focus();
  }
}

function closeRoleForm() {
  roleModal.classList.add("hidden");
}

function handleRoleFormSubmit(event) {
  event.preventDefault();

  if (!canManageRolePermissions()) {
    roleFormError.textContent = "Seul le Super Admin peut gérer les rôles.";
    return;
  }

  const mode = roleForm.dataset.mode;
  const currentRole = roleOriginalName.value;

  if (mode === "create") {
    const roleName = normalizeRoleName(roleNameInput.value);
    if (!roleName) {
      roleFormError.textContent = "Le nom du rôle est obligatoire.";
      return;
    }

    if (state.rolePermissions[roleName] || getPermissionRoles().includes(roleName)) {
      roleFormError.textContent = "Ce rôle existe déjà.";
      return;
    }

    state.rolePermissions[roleName] = [];
    state.selectedPermissionRole = roleName;
    persistSession();
    closeRoleForm();
    renderPermissions();
    showToast(`Rôle ${roleName} créé.`);
    return;
  }

  if (mode === "rename") {
    const nextRole = normalizeRoleName(roleNameInput.value);
    if (!nextRole) {
      roleFormError.textContent = "Le nom du rôle est obligatoire.";
      return;
    }

    if (nextRole === currentRole) {
      closeRoleForm();
      return;
    }

    if (state.rolePermissions[nextRole] || getPermissionRoles().includes(nextRole)) {
      roleFormError.textContent = "Ce rôle existe déjà.";
      return;
    }

    state.rolePermissions[nextRole] = state.rolePermissions[currentRole] ?? [];
    delete state.rolePermissions[currentRole];
    state.users = state.users.map((user) => (
      user.role === currentRole ? { ...user, role: nextRole } : user
    ));
    state.selectedPermissionRole = nextRole;
    persistSession();
    closeRoleForm();
    renderUsers();
    renderPermissions();
    showToast(`Rôle renommé en ${nextRole}.`);
    return;
  }

  if (mode === "delete") {
    const usersInRole = state.users.filter((user) => user.role === currentRole).length;
    if (usersInRole > 0) {
      roleFormError.textContent = `Impossible : ${usersInRole} compte(s) utilisent ce rôle.`;
      return;
    }

    delete state.rolePermissions[currentRole];
    state.selectedPermissionRole = getPermissionRoles().find((item) => item !== currentRole) ?? state.session.user.role;
    persistSession();
    closeRoleForm();
    renderPermissions();
    showToast(`Rôle ${currentRole} supprimé.`);
  }
}

function normalizeRoleName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function displayRoleName(role) {
  const labels = {
    "Super Administrateur Somafrik": "Super Administrateur Somafrik",
    "Super Administrateur OKAFRIK": "Super Administrateur Somafrik",
    "Admin School": "Admin établissement",
  };
  return labels[role] ?? role;
}

function isSuperAdminRole(role) {
  return role === "Super Administrateur Somafrik" || role === "Super Administrateur OKAFRIK";
}

function sortPermissions(a, b) {
  return String(a).localeCompare(String(b), "fr");
}

function showToast(message) {
  toastMessage.textContent = message;
  toastMessage.classList.remove("hidden");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toastMessage.classList.add("hidden");
  }, 2600);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("Clipboard API indisponible, tentative de copie classique.", error);
  }

  return fallbackCopyToClipboard(text);
}

function fallbackCopyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch (error) {
    console.warn("Copie classique indisponible.", error);
    return false;
  } finally {
    textarea.remove();
  }
}

function openTextExport(title, text) {
  openDetail(
    "Export manuel",
    title,
    `
      <div class="detail-section">
        <strong>Copie manuelle</strong>
        <p>Le navigateur a bloqué l'accès automatique au presse-papiers. Le contenu reste disponible ici.</p>
        <textarea class="export-textarea" readonly>${escapeHtml(text)}</textarea>
      </div>
    `
  );
}

function openPermissionDetail(permission, context) {
  if (!permission) return;

  const description = getControlDescription(permission);
  const scope = getPermissionScope(permission);
  const account = state.session?.user;

  openDetail(
    context,
    permission,
    `
      <div class="detail-grid">
        ${renderDetailItem("Statut", "Autorisé")}
        ${renderDetailItem("Périmètre", scope)}
        ${renderDetailItem("Compte", account?.identifier ?? "Session active")}
        ${renderDetailItem("Rôle", account?.role ?? "Administrateur")}
      </div>
      <div class="detail-section">
        <strong>Contrôle métier</strong>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="detail-section">
        <strong>Utilisation attendue</strong>
        <p>Cette permission ouvre les actions liées au module correspondant sur la plateforme et limite les opérations au périmètre de votre compte.</p>
      </div>
    `
  );
}

function openCountryForm() {
  openDetail(
    "Pays",
    "Créer un pays",
    `
      <div class="form-grid detail-form">
        <label>Nom <input id="countryNameInput" placeholder="Ex. République Démocratique du Congo" /></label>
        <label>Code ISO <input id="countryCodeInput" maxlength="8" placeholder="CD" /></label>
        <label>Indicatif <input id="countryPhoneInput" placeholder="+243" /></label>
        <label>Devise <input id="countryCurrencyInput" placeholder="CDF" /></label>
        <label>Fuseau horaire <input id="countryTimezoneInput" placeholder="Africa/Kinshasa" /></label>
        <label>Statut
          <select id="countryStatusInput">
            <option>Actif</option>
            <option>Suspendu</option>
          </select>
        </label>
      </div>
      <p class="error" id="countryFormError"></p>
      <div class="row-actions detail-actions">
        <button class="icon-action" type="button" data-action="save-country-form">Enregistrer</button>
      </div>
    `
  );
}

function saveCountryForm() {
  const payload = {
    name: document.querySelector("#countryNameInput")?.value.trim(),
    code: document.querySelector("#countryCodeInput")?.value.trim().toUpperCase(),
    phonePrefix: document.querySelector("#countryPhoneInput")?.value.trim(),
    currency: document.querySelector("#countryCurrencyInput")?.value.trim().toUpperCase(),
    timezone: document.querySelector("#countryTimezoneInput")?.value.trim() || "UTC",
    status: document.querySelector("#countryStatusInput")?.value ?? "Actif",
  };
  const errorTarget = document.querySelector("#countryFormError");

  if (!payload.name || !payload.code || !payload.phonePrefix || !payload.currency) {
    errorTarget.textContent = "Nom, code, indicatif et devise sont obligatoires.";
    return;
  }

  if (state.countries.some((country) => country.code === payload.code)) {
    errorTarget.textContent = "Ce code pays existe déjà.";
    return;
  }

  state.countries.unshift({
    id: `COUNTRY-${payload.code}-${Date.now()}`,
    ...payload,
    administratorId: "",
    createdAt: formatDate(new Date()),
  });
  addAudit("Création pays", payload.code, `${payload.name} ajouté à la plateforme`);
  closeDetail();
  renderOperationalViews();
  persistSession();
  showToast(`Pays ${payload.code} créé.`);
}

function openNotificationForm() {
  openDetail(
    "Notification",
    "Créer une notification",
    `
      <div class="form-grid detail-form">
        <label>Titre <input id="notificationTitleInput" placeholder="Titre de la notification" /></label>
        <label>Type
          <select id="notificationTypeInput">
            <option>Support</option>
            <option>Abonnement</option>
            <option>Paiement</option>
            <option>Système</option>
          </select>
        </label>
        <label>Priorité
          <select id="notificationPriorityInput">
            <option>Moyenne</option>
            <option>Haute</option>
            <option>Basse</option>
          </select>
        </label>
        <label>Audience <input id="notificationAudienceInput" value="${escapeHtml(state.session?.user?.role ?? "Plateforme")}" /></label>
        <label class="form-wide">Message <input id="notificationMessageInput" placeholder="Message à envoyer" /></label>
      </div>
      <p class="error" id="notificationFormError"></p>
      <div class="row-actions detail-actions">
        <button class="icon-action" type="button" data-action="save-notification-form">Publier</button>
      </div>
    `
  );
}

function saveNotificationForm() {
  const title = document.querySelector("#notificationTitleInput")?.value.trim();
  const message = document.querySelector("#notificationMessageInput")?.value.trim();
  const errorTarget = document.querySelector("#notificationFormError");

  if (!title || !message) {
    errorTarget.textContent = "Le titre et le message sont obligatoires.";
    return;
  }

  const notification = {
    id: `NOTIF-${Date.now()}`,
    audience: document.querySelector("#notificationAudienceInput")?.value.trim() || "Plateforme",
    countryCode: state.session?.user?.countryCode || "*",
    title,
    message,
    type: document.querySelector("#notificationTypeInput")?.value ?? "Support",
    priority: document.querySelector("#notificationPriorityInput")?.value ?? "Moyenne",
    channels: ["Web", "Mobile"],
    status: "Non lu",
    date: formatDate(new Date()),
    createdBy: state.session?.user?.id,
  };

  state.notifications.unshift(notification);
  addAudit("Création notification", notification.id, notification.title);
  closeDetail();
  renderOperationalViews();
  persistSession();
  showToast("Notification publiée.");
}

function openUserForm() {
  const roleOptions = getAssignableUserRoles()
    .map((role) => `<option>${escapeHtml(role)}</option>`)
    .join("");
  const schoolOptions = getAssignableUserSchools()
    .map((school) => `<option value="${escapeHtml(school.code)}">${escapeHtml(school.name)} (${escapeHtml(school.code)})</option>`)
    .join("");
  const countryOptions = state.countries
    .map((country) => `<option value="${escapeHtml(country.name)}">${escapeHtml(country.name)} (${escapeHtml(country.code)})</option>`)
    .join("");

  openDetail(
    "Utilisateur",
    "Créer un utilisateur",
    `
      <div class="form-grid detail-form">
        <label>Prénom <input id="userFirstNameInput" placeholder="Prénom" /></label>
        <label>Nom <input id="userLastNameInput" placeholder="Nom" /></label>
        <label>Identifiant unique <input id="userIdentifierInput" placeholder="USR-0001, ENS-0001, ELE-0001..." /></label>
        <label>Rôle <select id="userRoleInput">${roleOptions}</select></label>
        <label>Établissement <select id="userSchoolInput">${schoolOptions}</select></label>
        <label>Pays géré <select id="userCountryInput">${countryOptions}</select></label>
        <label>Statut
          <select id="userStatusInput">
            <option>Actif</option>
            <option>Suspendu</option>
          </select>
        </label>
      </div>
      <p class="error" id="userFormError"></p>
      <div class="row-actions detail-actions">
        <button class="icon-action" type="button" data-action="save-user-form">Créer</button>
      </div>
    `
  );
  document.querySelector("#userRoleInput")?.addEventListener("change", syncUserScopeInputs);
  syncUserScopeInputs();
}

function getAssignableUserRoles() {
  const currentUser = state.session?.user;
  if (currentUser?.role === "Admin Pays") {
    return ["Admin School"];
  }

  return getPermissionRoles();
}

function getAssignableUserSchools() {
  const currentUser = state.session?.user;
  if (currentUser?.role === "Admin Pays") {
    return getConfigurableSchools();
  }

  return state.schools;
}

function saveUserForm() {
  const role = document.querySelector("#userRoleInput")?.value;
  const allowedRoles = getAssignableUserRoles();
  const allowedSchools = getAssignableUserSchools();
  const selectedSchoolCode = document.querySelector("#userSchoolInput")?.value || allowedSchools[0]?.code || "*";
  const countryScope = document.querySelector("#userCountryInput")?.value || state.session?.user?.countryScope || "";
  const schoolCode = role === "Admin Pays" ? "*" : selectedSchoolCode;
  const school = state.schools.find((item) => item.code === schoolCode);
  const payload = {
    firstName: document.querySelector("#userFirstNameInput")?.value.trim(),
    lastName: document.querySelector("#userLastNameInput")?.value.trim(),
    identifier: document.querySelector("#userIdentifierInput")?.value.trim(),
    role,
    schoolCode,
    countryScope: role === "Admin Pays" ? countryScope : school?.country ?? state.session?.user?.countryScope ?? "",
    status: document.querySelector("#userStatusInput")?.value ?? "Actif",
  };
  const errorTarget = document.querySelector("#userFormError");

  if (!payload.firstName || !payload.lastName || !payload.identifier || !payload.role) {
    errorTarget.textContent = "Prénom, nom, identifiant et rôle sont obligatoires.";
    return;
  }

  if (!allowedRoles.includes(payload.role)) {
    errorTarget.textContent = "Ce rôle ne peut pas être attribué par votre compte.";
    return;
  }

  if (state.session?.user?.role === "Admin Pays" && !allowedSchools.some((item) => item.code === payload.schoolCode)) {
    errorTarget.textContent = "Cet établissement n'appartient pas à votre périmètre pays.";
    return;
  }

  if (payload.role === "Admin Pays" && !payload.countryScope) {
    errorTarget.textContent = "Un Admin Pays doit être rattaché à un pays, pas à un établissement.";
    return;
  }

  if (state.users.some((user) => normalize(user.identifier) === normalize(payload.identifier))) {
    errorTarget.textContent = "Cet identifiant existe déjà.";
    return;
  }

  const permissions = state.rolePermissions[payload.role] ?? ["Voir tableau de bord"];
  const user = {
    id: `USER-${Date.now()}`,
    publicId: `USR-${Date.now()}`,
    ...payload,
    scopeLevel: payload.role === "Admin Pays" ? "Pays" : payload.schoolCode === "*" ? "Global" : "Établissement",
    accessChannel: "Application",
    permissions: [...permissions],
    temporaryPassword: "1234",
    history: [`Créé le ${formatDate(new Date())}`],
  };

  state.users.unshift(user);
  if (user.role === "Enseignant") {
    const syncService = {
      upsertTeacherFromUser(teachers, account) {
        const schoolCode = String(account.schoolCode ?? "").trim();
        if (!schoolCode || schoolCode === "*") return teachers;
        const next = [...teachers];
        const index = next.findIndex(
          (teacher) =>
            String(teacher.userId ?? "") === String(account.id) ||
            (normalize(teacher.identifier) === normalize(account.identifier) &&
              (!teacher.userId || String(teacher.userId) === String(account.id))),
        );
        const row = {
          ...(index >= 0 ? next[index] : {}),
          id: index >= 0 ? next[index].id : `TEACHER-${Date.now()}`,
          userId: account.id,
          publicId: account.publicId ?? `${schoolCode}-${account.identifier}`,
          identifier: account.identifier,
          schoolCode,
          name: account.lastName,
          firstName: account.firstName,
          gender: account.gender ?? "Non renseigné",
          phone: account.phone ?? "",
          email: account.email ?? "",
          status: account.status === "Suspendu" ? "Suspendu" : "Actif",
          password: account.temporaryPassword ?? "1234",
          assignments: index >= 0 ? next[index].assignments ?? [] : [],
          assignedClasses: index >= 0 ? next[index].assignedClasses ?? [] : [],
        };
        if (index >= 0) next[index] = row;
        else next.unshift(row);
        return next;
      },
    };
    state.teachers = syncService.upsertTeacherFromUser(state.teachers, user);
  }
  addAudit("Création utilisateur", user.identifier, `${user.firstName} ${user.lastName} créé avec le rôle ${user.role}`);
  closeDetail();
  renderOperationalViews();
  renderPermissions();
  persistSession();
  showToast("Utilisateur créé avec le mot de passe temporaire 1234.");
}

function syncUserScopeInputs() {
  const role = document.querySelector("#userRoleInput")?.value;
  const schoolInput = document.querySelector("#userSchoolInput");
  const countryInput = document.querySelector("#userCountryInput");
  if (!schoolInput || !countryInput) return;

  const isCountryAdmin = role === "Admin Pays";
  schoolInput.disabled = isCountryAdmin;
  countryInput.disabled = !isCountryAdmin;
}

function openSchoolDetail(school) {
  const subscription = state.subscriptions.find((item) => item.schoolCode === school.code);
  const users = state.users.filter((user) => user.schoolCode === school.code);
  const auditRows = state.auditLog.filter((item) => item.targetId === school.code).slice(0, 8);

  detailEyebrow.textContent = `${school.type} • ${school.status}`;
  detailTitle.textContent = school.name;
  detailBody.innerHTML = `
    <div class="detail-grid">
      ${renderDetailItem("Code", school.code)}
      ${renderDetailItem("Pays", school.country)}
      ${renderDetailItem("Ville", school.city)}
      ${renderDetailItem("Validation", school.validationStatus ?? "Validé")}
      ${renderDetailItem("Téléphone", school.phone ?? "Non renseigné")}
      ${renderDetailItem("Email", school.email ?? "Non renseigné")}
      ${renderDetailItem("Devise", school.currency ?? "Non renseignée")}
      ${renderDetailItem("Fuseau", school.timezone ?? "Non renseigné")}
      ${renderDetailItem("Année scolaire", school.schoolYear ?? "2025-2026")}
      ${renderDetailItem("Abonnement", `${school.subscriptionPlan ?? subscription?.plan ?? "Non défini"} • ${subscription?.paymentStatus ?? school.subscriptionStatus ?? "À contrôler"}`)}
      ${renderDetailItem("Limite élèves", school.maxStudents ?? "Non définie")}
      ${renderDetailItem("Limite enseignants", school.maxTeachers ?? "Non définie")}
    </div>
    <div class="detail-section">
      <strong>Actions</strong>
      <div class="row-actions detail-actions">
        <button class="icon-action" type="button" data-action="edit-school" data-id="${school.code}">Modifier</button>
        <button class="icon-action ${school.status === "Suspendu" ? "" : "danger"}" type="button" data-action="toggle-school" data-id="${school.code}">
          ${school.status === "Suspendu" ? "Réactiver" : "Suspendre"}
        </button>
      </div>
    </div>
    <div class="detail-section">
      <strong>Utilisateurs liés</strong>
      <p>${users.length ? users.map((user) => `${user.firstName} ${user.lastName} (${user.role})`).slice(0, 6).join(", ") : "Aucun utilisateur directement rattaché."}</p>
    </div>
    <div class="detail-section">
      <strong>Audit récent</strong>
      ${
        auditRows.length
          ? `<div class="audit-list">${auditRows.map((item) => `<p><b>${item.date}</b> • ${item.action} • ${item.summary}</p>`).join("")}</div>`
          : "<p>Aucune action auditée sur cet établissement.</p>"
      }
    </div>
  `;
  detailDrawer.classList.remove("hidden");
}

function openSchoolForm(school = null) {
  closeDetail();
  schoolForm.reset();
  schoolFormError.textContent = "";
  schoolOriginalCode.value = school?.code ?? "";
  schoolFormMode.textContent = school ? "Modification" : "Création";
  schoolFormTitle.textContent = school ? "Modifier un établissement" : "Créer un établissement";
  schoolNameInput.value = school?.name ?? "";
  schoolCodeInput.value = school?.code ?? generateSchoolCode();
  schoolCodeInput.disabled = Boolean(school);
  schoolTypeInput.value = school?.type ?? "Lycée";
  schoolCountryInput.value = school?.country ?? state.session?.user?.countryScope ?? "RDC";
  schoolCityInput.value = school?.city ?? "";
  schoolStatusInput.value = school?.status ?? "Actif";
  schoolPhoneInput.value = school?.phone ?? "";
  schoolEmailInput.value = school?.email ?? "";
  schoolPlanInput.value = school?.subscriptionPlan ?? "Standard";
  schoolEndDateInput.value = school?.subscriptionEndDate ?? "31-08-2026";
  schoolMaxStudentsInput.value = school?.maxStudents ?? 500;
  schoolMaxTeachersInput.value = school?.maxTeachers ?? 50;
  schoolAddressInput.value = school?.address ?? "";
  schoolLogoInput.value = school?.logoUrl ?? "";
  schoolModal.classList.remove("hidden");
}

function closeSchoolForm() {
  schoolCodeInput.disabled = false;
  schoolModal.classList.add("hidden");
}

function handleSchoolFormSubmit(event) {
  event.preventDefault();
  const originalCode = schoolOriginalCode.value;

  if (!hasBackOfficePermission("Établissements", originalCode ? "UPDATE" : "CREATE")) {
    schoolFormError.textContent = "Action non autorisée pour ce rôle.";
    return;
  }

  const payload = readSchoolForm();
  const error = validateSchoolForm(payload, originalCode);

  if (error) {
    schoolFormError.textContent = error;
    return;
  }

  if (originalCode) {
    const index = state.schools.findIndex((school) => school.code === originalCode);
    if (index < 0) return;
    state.schools[index] = {
      ...state.schools[index],
      ...payload,
      publicId: originalCode,
      code: originalCode,
    };
    syncSchoolSubscription(state.schools[index]);
    addAudit("Modification établissement", originalCode, `${payload.name} mis à jour`);
    showToast("Établissement modifié.");
    openSchoolDetail(state.schools[index]);
  } else {
    const school = {
      ...payload,
      id: `SCHOOL-${Date.now()}`,
      publicId: payload.code,
      validationStatus: "En attente",
      subscriptionStartDate: formatDate(new Date()),
      schoolYear: "2025-2026",
      currency: "CDF",
      timezone: "Africa/Kinshasa",
      language: "Français",
      dateFormat: "JJ-MM-AAAA",
      primaryColor: "#2563EB",
      createdAt: formatDate(new Date()),
    };
    state.schools.unshift(school);
    syncSchoolSubscription(school);
    addAudit("Création établissement", school.code, `${school.name} créé`);
    state.schoolPage = 1;
    showToast("Établissement créé et mis en attente de validation.");
  }

  closeSchoolForm();
  renderSchools();
  renderKpis();
  renderSubscriptions();
  persistSession();
}

function readSchoolForm() {
  return {
    name: schoolNameInput.value.trim(),
    code: schoolCodeInput.value.trim().toUpperCase(),
    type: schoolTypeInput.value,
    country: schoolCountryInput.value.trim(),
    city: schoolCityInput.value.trim(),
    status: schoolStatusInput.value,
    phone: schoolPhoneInput.value.trim(),
    email: schoolEmailInput.value.trim(),
    subscriptionPlan: schoolPlanInput.value,
    subscriptionEndDate: schoolEndDateInput.value.trim(),
    maxStudents: Number(schoolMaxStudentsInput.value) || 0,
    maxTeachers: Number(schoolMaxTeachersInput.value) || 0,
    address: schoolAddressInput.value.trim(),
    logoUrl: schoolLogoInput.value.trim(),
  };
}

function validateSchoolForm(payload, originalCode) {
  if (!payload.name || !payload.code || !payload.type || !payload.country || !payload.city) {
    return "Nom, code, type, pays et ville sont obligatoires.";
  }

  const duplicate = state.schools.find((school) => school.code === payload.code && school.code !== originalCode);
  if (duplicate) {
    return "Ce code établissement existe déjà.";
  }

  if (payload.email && !payload.email.includes("@")) {
    return "L'email de l'établissement est invalide.";
  }

  if (payload.logoUrl && !/\.(jpg|jpeg|png|webp)$/i.test(payload.logoUrl)) {
    return "Le logo doit être une URL JPG, PNG ou WebP.";
  }

  if (payload.maxStudents < 1 || payload.maxTeachers < 1) {
    return "Les limites élèves et enseignants doivent être supérieures à zéro.";
  }

  return "";
}

function syncSchoolSubscription(school) {
  let subscription = state.subscriptions.find((item) => item.schoolCode === school.code);
  const price = getPlanPrice(school.subscriptionPlan);

  if (!subscription) {
    subscription = {
      id: `SUB-${school.code}`,
      schoolCode: school.code,
      countryCode: school.code.slice(0, 2),
      country: school.country,
      plan: school.subscriptionPlan,
      monthlyPrice: price.monthly,
      annualPrice: price.annual,
      currency: "USD",
      status: school.status,
      paymentStatus: "À jour",
      startDate: formatDate(new Date()),
      endDate: school.subscriptionEndDate,
      lastPaymentDate: formatDate(new Date()),
    };
    state.subscriptions.unshift(subscription);
  }

  subscription.country = school.country;
  subscription.plan = school.subscriptionPlan;
  subscription.monthlyPrice = price.monthly;
  subscription.annualPrice = price.annual;
  subscription.status = school.status;
  subscription.endDate = school.subscriptionEndDate;
}

function getPlanPrice(plan) {
  if (plan === "Premium") return { monthly: 120, annual: 1200 };
  if (plan === "Standard") return { monthly: 90, annual: 900 };
  return { monthly: 60, annual: 600 };
}

function addAudit(action, targetId, summary) {
  state.auditLog.unshift({
    id: `AUDIT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toLocaleString("fr-FR"),
    actor: state.session?.user?.identifier ?? "system",
    action,
    targetId,
    summary,
  });
}

function generateSchoolCode() {
  const country = state.session?.user?.countryScope === "RDC" ? "CD" : "SL";
  const next = state.schools.length + 1;
  return `${country}-2026-${String(next).padStart(4, "0")}`;
}

function getAvailableCountryAdminId(country) {
  const countryAdmin = state.users.find((user) =>
    user.role === "Admin Pays" &&
    user.status === "Actif" &&
    (!user.countryScope || user.countryScope === country.name || user.countryScope === country.code)
  );
  return countryAdmin?.id ?? state.session?.user?.id ?? "À affecter";
}

function parseFrenchDate(value) {
  const match = String(value ?? "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function isPastDate(value) {
  const date = parseFrenchDate(value);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

function addOneYearDate(value) {
  const date = parseFrenchDate(value) ?? new Date();
  date.setFullYear(date.getFullYear() + 1);
  return formatDate(date);
}

function renderDetailItem(label, value) {
  return `
    <article class="detail-item">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function openDetail(eyebrow, title, body) {
  closeSchoolForm();
  detailEyebrow.textContent = eyebrow;
  detailTitle.textContent = title;
  detailBody.innerHTML = body;
  detailDrawer.classList.remove("hidden");
  refreshActionVisibility();
}

function closeDetail() {
  detailDrawer.classList.add("hidden");
}

function formatDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

function generateTemporaryPassword() {
  return `SF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isActiveUserAccount(user) {
  const status = normalizeUserStatus(user?.status);
  return !["suspendu", "desactive", "disabled", "inactive", "inactif"].includes(status);
}

function normalizeUserStatus(value) {
  return String(value ?? "Actif")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getControlDescription(permission) {
  if (permission === "ALL_PRIVILEGES") return "Accès total à la plateforme Somafrik.";
  if (permission === "COUNTRY_PRIVILEGES") return "Accès limité aux données du pays affecté.";
  if (permission.includes("pays")) return "Contrôle limité au périmètre pays autorisé.";
  if (permission.includes("établissement")) return "Contrôle des écoles, statuts et abonnements.";
  if (permission.includes("utilisateur") || permission.includes("admins")) return "Création, suspension et audit des comptes.";
  if (permission.includes("rapport")) return "Suivi des indicateurs consolidés.";
  if (permission.includes("abonnement")) return "Gestion des plans, échéances et limites.";
  return "Action autorisée selon votre niveau métier.";
}

function getPermissionScope(permission) {
  if (permission === "ALL_PRIVILEGES") return "Plateforme complète";
  if (permission === "COUNTRY_PRIVILEGES" || permission.includes("pays")) return state.session?.user?.countryScope ?? "Pays affecté";
  if (permission.includes("établissement")) return "Établissements accessibles";
  if (permission.includes("utilisateur") || permission.includes("admins")) return "Comptes du périmètre autorisé";
  if (permission.includes("rapport")) return "Rapports consolidés autorisés";
  if (permission.includes("abonnement")) return "Abonnements et paiements";
  return "Périmètre du compte";
}

function formatMetric(value, suffix) {
  return `${value}${suffix ? ` ${suffix}` : ""}`;
}

function getStatusClass(status) {
  return status === "Suspendu" ? "status-danger" : "";
}

function getPaymentClass(status) {
  return status === "En retard" ? "status-warning" : "";
}

function getCoverageClass(status) {
  if (status === "Manquant") return "status-danger";
  if (status === "Partiel") return "status-warning";
  return "";
}
