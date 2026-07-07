const { BusinessError } = require("./authService");
const { CommunicationService } = require("./communicationService");
const { verifySecret } = require("./credentialService");
const {
  getLoginAttemptKey,
  assertLoginNotLocked,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
} = require("../lib/loginLockout");
const { GENERIC_AUTH_ERROR, canUserAccountLogin, loginBlockedMessage } = require("../lib/userAccountRules");
const { canAccessBackOfficeRole, canAccessWebPlatformRole, isEstablishmentBackOfficeRole } = require("../lib/establishmentRoles");
const { getCountryCodeFromScope, schoolMatchesCountryScope } = require("../lib/countryScope");

const SUPER_ADMIN_ROLE = "Super Administrateur Somafrik";
const LEGACY_SUPER_ADMIN_ROLE = "Super Administrateur OKAFRIK";
const PENDING_VALIDATION_STATUS = "En attente de validation";

function isSuperAdminRole(role) {
  return role === SUPER_ADMIN_ROLE || role === LEGACY_SUPER_ADMIN_ROLE;
}

class BackOfficeAccessService {
  constructor({ school, schools = [school], userAccounts, countries = [], subscriptions = [], notifications = [] }) {
    this.school = school;
    this.schools = schools;
    this.userAccounts = userAccounts;
    this.countries = countries;
    this.subscriptions = subscriptions;
    this.notifications = notifications;
    this.communicationService = new CommunicationService({ notifications });
  }

  login({ schoolCode, identifier, password }) {
    if (!identifier || !password) {
      throw new BusinessError(400, "Identifiant et mot de passe obligatoires");
    }

    const loginKey = getLoginAttemptKey(schoolCode, identifier);
    try {
      assertLoginNotLocked(loginKey);
    } catch {
      throw new BusinessError(
        423,
        "Compte temporairement verrouillé après plusieurs tentatives. Réessayez dans 15 minutes.",
      );
    }

    const user = this.findUserAccount(identifier, schoolCode);

    if (!user || !this.verifyPassword(user, password)) {
      recordFailedLoginAttempt(loginKey);
      throw new BusinessError(401, GENERIC_AUTH_ERROR);
    }

    if (!canUserAccountLogin(user)) {
      throw new BusinessError(403, loginBlockedMessage(user));
    }

    if (!canAccessWebPlatformRole(user.role) && user.accessChannel !== "BackOffice") {
      throw new BusinessError(403, "Ce compte n'a pas accès à la plateforme");
    }

    if (user.role === "Admin Pays" && this.isCountrySuspended(this.getCountryCode(user.countryScope))) {
      throw new BusinessError(403, "Pays suspendu. Connexion indisponible pour ce pays.");
    }

    if (!this.isPlatformAdmin(user) && !String(schoolCode ?? "").trim()) {
      throw new BusinessError(400, "Code établissement obligatoire pour ce compte");
    }

    const explicitSchoolCode = String(schoolCode ?? "").trim().toUpperCase();
    const resolvedSchoolCode = explicitSchoolCode
      ? explicitSchoolCode
      : this.isPlatformAdmin(user)
        ? ""
        : this.getDefaultSchoolCodeForUser(user) || "";
    let schoolContext = null;
    if (resolvedSchoolCode) {
      schoolContext = this.resolveSchoolContext(resolvedSchoolCode, {
        forPlatformAdmin: this.isPlatformAdmin(user),
      });
    } else if (!this.isPlatformAdmin(user)) {
      throw new BusinessError(400, "Code établissement obligatoire pour ce compte");
    }
    this.assertScopeCanAccessSchool(user, schoolContext);
    this.assertSchoolCountryActive(user, schoolContext);

    clearFailedLoginAttempts(loginKey);

    const { password: _password, temporaryPassword: _temporaryPassword, ...safeUser } = user;
    const mustChangePassword = Boolean(user.mustChangePassword) || Boolean(user.temporaryPassword);

    return {
      user: { ...safeUser, mustChangePassword },
      schoolContext,
      scope: this.getScope(user),
      menus: this.getMenus(user),
      dashboard: this.getDashboard(user),
      schools: this.getScopedSchools(user),
      users: this.getScopedUsers(user).map(({ password: _pwd, temporaryPassword: _tmp, ...account }) => account),
      countries: this.getScopedCountries(user),
      subscriptions: this.getScopedSubscriptions(user),
      notifications: this.getScopedNotifications(user),
      unreadNotifications: this.communicationService.getUnreadCount(this.getScopedNotifications(user)),
    };
  }

  findUserAccount(identifier, schoolCode) {
    const normalizedIdentifier = String(identifier).trim().toLowerCase();
    const normalizedSchoolCode = String(schoolCode ?? "").trim().toUpperCase();
    const matches = this.userAccounts.filter((account) =>
      [account.identifier, account.email, account.phone, account.publicId].some(
        (value) => String(value ?? "").trim().toLowerCase() === normalizedIdentifier
      )
    );

    if (!matches.length) {
      return undefined;
    }

    if (normalizedSchoolCode) {
      const exact = matches.find(
        (account) => String(account.schoolCode ?? "").trim().toUpperCase() === normalizedSchoolCode
      );
      if (exact) {
        return exact;
      }

      const platform = matches.find((account) => account.schoolCode === "*");
      if (platform) {
        return platform;
      }

      return undefined;
    }

    return matches[0];
  }

  isPendingValidation(user) {
    return (
      user?.validationStatus === PENDING_VALIDATION_STATUS ||
      user?.status === PENDING_VALIDATION_STATUS
    );
  }

  verifyPassword(user, password) {
    const normalizedPassword = String(password ?? "");

    if (user.passwordHash && verifySecret(normalizedPassword, user.passwordHash)) {
      return true;
    }

    if (user.pinHash && verifySecret(normalizedPassword, user.pinHash)) {
      return true;
    }

    const temporaryPassword = String(user.temporaryPassword ?? "").trim();
    if (temporaryPassword && temporaryPassword === normalizedPassword) {
      return true;
    }

    return String(user.password ?? "") === normalizedPassword;
  }

  isPlatformAdmin(user) {
    return isSuperAdminRole(user.role) || user.role === "Admin Pays";
  }

  isBackOfficeRole(user) {
    return canAccessBackOfficeRole(user.role);
  }

  resolveSchoolContext(schoolCode, { forPlatformAdmin = false } = {}) {
    const normalizedCode = String(schoolCode).trim().toUpperCase();
    const school = this.schools.find((item) =>
      [item.code, item.publicId].some(
        (value) => String(value ?? "").trim().toUpperCase() === normalizedCode
      )
    );

    if (!school) {
      throw new BusinessError(404, "Code établissement invalide");
    }

    if (forPlatformAdmin) {
      return school;
    }

    if (school.status === "Suspendu") {
      throw new BusinessError(403, "Établissement suspendu. Connexion indisponible.");
    }

    if (school.status === "Désactivé") {
      throw new BusinessError(403, "Établissement désactivé. Connexion indisponible.");
    }

    if (
      school.validationStatus === "En attente de validation" ||
      school.validationStatus === "En attente"
    ) {
      throw new BusinessError(
        403,
        "Établissement en attente de validation par le Super Administrateur. Connexion indisponible."
      );
    }

    const { assertSchoolCanConnect } = require("./schoolSubscriptionAccessService");
    assertSchoolCanConnect(school.code, {
      schools: this.schools,
      subscriptions: this.subscriptions,
    });

    return school;
  }

  getDefaultSchoolCodeForUser(user) {
    if (this.isPlatformAdmin(user) && (!user.schoolCode || user.schoolCode === "*")) {
      return "";
    }

    if (user.schoolCode && user.schoolCode !== "*") {
      return user.schoolCode;
    }

    if (user.countryScope) {
      const countryCode = this.getCountryCode(user.countryScope);
      const scopedSchool = this.schools.find((school) =>
        school.status !== "Suspendu" && (school.country === user.countryScope || school.code.startsWith(countryCode))
      );

      if (scopedSchool) {
        return scopedSchool.code;
      }
    }

    return this.schools.find((school) => school.status !== "Suspendu")?.code ?? this.school?.code;
  }

  assertScopeCanAccessSchool(user, school) {
    if (isSuperAdminRole(user.role)) {
      return;
    }

    if (!school) {
      if (this.isPlatformAdmin(user)) {
        return;
      }
      throw new BusinessError(404, "Code établissement invalide");
    }

    if (user.role === "Admin Pays") {
      const countryCode = this.getCountryCode(user.countryScope);
      const allowed = school.country === user.countryScope || school.code.startsWith(countryCode);

      if (!allowed) {
        throw new BusinessError(403, "Cet administrateur pays ne peut accéder qu'à son pays.");
      }

      return;
    }

    if (user.schoolCode !== school.code) {
      throw new BusinessError(403, "Un établissement ne peut pas voir les données d'un autre établissement.");
    }
  }

  isCountrySuspended(countryCode) {
    if (!countryCode) {
      return false;
    }

    const normalized = String(countryCode).trim().toUpperCase();
    return this.countries.some(
      (country) =>
        String(country.code ?? "").trim().toUpperCase() === normalized &&
        country.status === "Suspendu"
    );
  }

  assertSchoolCountryActive(user, school) {
    if (isSuperAdminRole(user.role) || !school) {
      return;
    }

    const countryCode =
      this.getCountryCode(school.country) ||
      this.getCountryCode(school.countryCode) ||
      String(school.code ?? "").slice(0, 2).toUpperCase();

    if (this.isCountrySuspended(countryCode)) {
      throw new BusinessError(403, "Pays suspendu. Connexion indisponible pour cet établissement.");
    }
  }

  getScopedSchools(user) {
    if (isSuperAdminRole(user.role)) {
      return this.schools;
    }

    if (user.role === "Admin Pays") {
      const countryScope = String(user.countryScope ?? user.countryCode ?? "").trim();
      if (!countryScope || !getCountryCodeFromScope(countryScope)) {
        return [];
      }
      return this.schools.filter((item) => schoolMatchesCountryScope(item, countryScope));
    }

    return this.schools.filter((item) => item.code === user.schoolCode);
  }

  getScopedCountries(user) {
    if (isSuperAdminRole(user.role)) {
      return this.countries;
    }

    if (user.role === "Admin Pays") {
      return this.countries.filter((country) => country.code === this.getCountryCode(user.countryScope));
    }

    return this.countries.filter((country) => country.code === this.getCountryCode(user.countryScope));
  }

  getScopedSubscriptions(user) {
    if (isSuperAdminRole(user.role)) {
      return this.subscriptions;
    }

    if (user.role === "Admin Pays") {
      return this.subscriptions.filter((subscription) => subscription.countryCode === this.getCountryCode(user.countryScope));
    }

    return [];
  }

  getScopedNotifications(user) {
    if (isSuperAdminRole(user.role)) {
      return this.communicationService.enrichNotifications(this.notifications);
    }

    if (user.role === "Admin Pays") {
      const countryCode = this.getCountryCode(user.countryScope);
      return this.communicationService.filterByAudience("Admin Pays", countryCode);
    }

    return [];
  }

  getMenus(user) {
    if (isSuperAdminRole(user.role)) {
      return [
        "Pays",
        "Établissements",
        "Abonnements",
        "Utilisateurs",
        "Notifications",
        "Paramètres",
        "Droits par rôle",
        "Graphiques",
        "Conception bulletins",
      ];
    }

    if (user.role === "Admin Pays") {
      return ["Dashboard", "Établissements", "Validations", "Paiements", "Rapports", "Support", "Paramètres"];
    }

    if (user.role === "Admin School") {
      return ["Dashboard", "Utilisateurs", "Rapports", "Support", "Années Académiques"];
    }

    if (user.role === "Secrétaire" || user.role === "Sécretaire") {
      return ["Dashboard", "Utilisateurs", "Support", "Rapports"];
    }

    if (user.role === "Préfet des études" || user.role === "Proviseur" || user.role === "Directeur") {
      return ["Dashboard", "Utilisateurs", "Rapports", "Années Académiques", "Support"];
    }

    if (user.role === "Comptable") {
      return ["Dashboard", "Paiements", "Rapports", "Support"];
    }

    if (user.role === "Enseignant") {
      return ["Dashboard", "Classes", "Notes", "Présences", "Rapports", "Support"];
    }

    if (user.role === "Parent") {
      return ["Dashboard", "Notes", "Paiements", "Messages", "Support"];
    }

    if (["Élève / Étudiant", "Élève", "Étudiant"].includes(user.role)) {
      return ["Dashboard", "Notes", "Bulletins", "Documents", "Support"];
    }

    if (isEstablishmentBackOfficeRole(user.role)) {
      return ["Dashboard", "Support", "Rapports"];
    }

    return ["Dashboard"];
  }

  getDashboard(user) {
    const scopedSchools = this.getScopedSchools(user);
    const scopedSubscriptions = this.getScopedSubscriptions(user);
    const scopedUsers = this.getScopedUsers(user);
    const countryCount = this.getScopedCountries(user).length;
    const suspendedSchools = scopedSchools.filter((school) => school.status === "Suspendu").length;
    const expiredSubscriptions = scopedSubscriptions.filter(
      (subscription) => subscription.status === "Suspendu" || subscription.paymentStatus === "En retard"
    ).length;
    const monthlyRevenue = scopedSubscriptions.reduce((total, subscription) => total + Number(subscription.monthlyPrice || 0), 0);
    const annualRevenue = scopedSubscriptions.reduce((total, subscription) => total + Number(subscription.annualPrice || 0), 0);
    const schoolAdmins = scopedUsers.filter((account) => account.role === "Admin School").length;

    if (isSuperAdminRole(user.role)) {
      return {
        profile: "Super Administrateur",
        privilegeLevel: "ALL_PRIVILEGES",
        kpis: [
          { label: "Pays", value: countryCount },
          { label: "Établissements", value: scopedSchools.length },
          { label: "Élèves", value: this.school?.maxStudents ?? 0 },
          { label: "Enseignants", value: this.school?.maxTeachers ?? 0 },
          { label: "Revenus mensuels", value: monthlyRevenue, suffix: "USD" },
          { label: "Revenus annuels", value: annualRevenue, suffix: "USD" },
          { label: "Établissements suspendus", value: suspendedSchools },
          { label: "Abonnements expirés", value: expiredSubscriptions },
        ],
      };
    }

    if (user.role === "Admin Pays") {
      return {
        profile: "Administrateur Pays",
        privilegeLevel: "COUNTRY_PRIVILEGES",
        kpis: [
          { label: "Établissements", value: scopedSchools.length },
          { label: "Élèves", value: this.school?.maxStudents ?? 0 },
          { label: "Enseignants", value: this.school?.maxTeachers ?? 0 },
          { label: "Taux de paiement", value: this.getPaymentRate(scopedSubscriptions), suffix: "%" },
          { label: "Nouveaux établissements", value: scopedSchools.filter((school) => school.validationStatus !== "Validé").length },
          { label: "Établissements suspendus", value: suspendedSchools },
          { label: "Admins écoles", value: schoolAdmins },
          { label: "Abonnements en retard", value: expiredSubscriptions },
        ],
      };
    }

    if (user.role === "Secrétaire" || user.role === "Sécretaire") {
      return {
        profile: "Secrétaire",
        privilegeLevel: "SCHOOL_INTERNAL",
        kpis: [
          { label: "Établissement", value: scopedSchools.length },
          { label: "Utilisateurs", value: scopedUsers.length },
          { label: "Dossiers élèves", value: scopedUsers.filter((account) => ["Élève / Étudiant", "Élève", "Étudiant"].includes(account.role)).length },
          { label: "Permissions", value: user.permissions?.length ?? 0 },
        ],
      };
    }

    if (user.role === "Préfet des études") {
      return {
        profile: "Préfet des études",
        privilegeLevel: "SCHOOL_PEDAGOGY",
        kpis: [
          { label: "Établissement", value: scopedSchools.length },
          { label: "Enseignants", value: scopedUsers.filter((account) => account.role === "Enseignant").length },
          { label: "Élèves", value: scopedUsers.filter((account) => ["Élève / Étudiant", "Élève", "Étudiant"].includes(account.role)).length },
          { label: "Permissions", value: user.permissions?.length ?? 0 },
        ],
      };
    }

    return {
      profile: "Administrateur École",
      privilegeLevel: "SCHOOL_PRIVILEGES",
      kpis: [
        { label: "Établissement", value: scopedSchools.length },
        { label: "Utilisateurs", value: scopedUsers.length },
        { label: "Permissions", value: user.permissions?.length ?? 0 },
      ],
    };
  }

  isSuperadminManagedUser(account) {
    const role = String(account?.role ?? "").trim().toLowerCase();
    return role === "admin pays" || role === "admin school";
  }

  getScopedUsers(user) {
    if (isSuperAdminRole(user.role)) {
      return this.userAccounts.filter((account) => this.isSuperadminManagedUser(account));
    }

    if (user.role === "Admin Pays") {
      const countryCode = this.getCountryCode(user.countryScope);
      const scopedSchoolCodes = new Set(
        this.schools
          .filter((school) => school.country === user.countryScope || school.code.startsWith(countryCode))
          .map((school) => school.code)
      );
      return this.userAccounts.filter((account) =>
        account.role === "Admin School" &&
        (account.countryScope === user.countryScope || scopedSchoolCodes.has(account.schoolCode))
      );
    }

    return this.userAccounts.filter((account) => account.schoolCode === user.schoolCode);
  }

  getScope(user) {
    if (isSuperAdminRole(user.role)) {
      return {
        label: "Périmètre global",
        hint: "Vous contrôlez tous les pays et établissements de la plateforme Somafrik.",
      };
    }

    if (user.role === "Admin Pays") {
      return {
        label: `Périmètre pays : ${user.countryScope}`,
        hint: "Vous contrôlez uniquement les écoles et utilisateurs de ce pays.",
      };
    }

    return {
      label: `Périmètre établissement : ${user.schoolCode}`,
      hint: "Vous contrôlez uniquement votre établissement.",
    };
  }

  getCountryCode(countryScope) {
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

  getPaymentRate(subscriptions) {
    if (!subscriptions.length) {
      return 0;
    }

    const paid = subscriptions.filter((subscription) => subscription.paymentStatus === "À jour").length;
    return Math.round((paid / subscriptions.length) * 100);
  }
}

module.exports = { BackOfficeAccessService };
