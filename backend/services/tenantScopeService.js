const { BusinessError } = require("./authService");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

class TenantScopeService {
  filterRows(rows, principal, options = {}) {
    const {
      schoolField = "schoolCode",
      countryField = "countryCode",
      studentField = "studentId",
      classField = "className",
      schoolStudentIds = null,
      schoolClassNames = null,
    } = options;

    if (!principal) {
      return rows;
    }

    const hasEffectiveSchoolScope = this.hasEffectiveSchoolScope(principal);
    if (SUPER_ADMIN_ROLES.has(principal.role) && !hasEffectiveSchoolScope) {
      return rows;
    }

    const roleScoped = this.filterByRoleOwnership(rows, principal);

    if (principal.role === "Admin Pays" && !hasEffectiveSchoolScope) {
      return roleScoped.filter((row) => {
        if (this.isSystemBroadcast(row)) return true;
        const countryCode = row[countryField] ?? this.countryCodeFromCountry(row.country) ?? this.countryCodeFromSchool(row[schoolField]);
        return Boolean(countryCode) && countryCode === principal.countryCode;
      });
    }

    // Périmètre établissement : un compte ne doit jamais voir les données d'un autre
    // établissement (SOM-SAA-002). Ce bloc s'applique aussi aux rôles plateforme
    // lorsqu'un scope request-scoped a été validé par requireAuth.
    const studentIds = new Set([...(principal.studentIds ?? []), ...(schoolStudentIds ?? [])]);
    const classNames = new Set([...(principal.classNames ?? []), ...(schoolClassNames ?? [])]);
    const principalSchools = this.principalSchoolCodes(principal);

    return roleScoped.filter((row) => {
      // Diffusion système (Super Admin) : annonce/message destiné à tous les établissements.
      if (this.isSystemBroadcast(row)) return true;

      if (
        (principal.role === "Parent" || principal.role === "Élève / Étudiant") &&
        this.rowMatchesStudentScope(row, studentIds)
      ) {
        return true;
      }

      const rowSchools = this.rowSchoolCodes(row, schoolField);
      if (rowSchools.size) {
        return [...rowSchools].some((code) => principalSchools.has(code));
      }

      const studentId = row[studentField];
      if (studentId) {
        return studentIds.has(String(studentId).trim());
      }

      const directClass = row[classField] ?? (row.level && row.track ? row.name : undefined);
      if (directClass) {
        return classNames.has(directClass);
      }

      const assignmentClasses = [
        ...((row.assignments ?? []).map((assignment) => assignment.className)),
        ...(row.assignedClasses ?? []),
      ].filter(Boolean);
      if (assignmentClasses.length) {
        return assignmentClasses.some((className) => classNames.has(className));
      }

      // Donnée sans rattachement établissement : exclue du périmètre école (SOM-SAA-002).
      return false;
    });
  }

  normalizeSchoolCode(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  hasEffectiveSchoolScope(principal) {
    return Boolean(
      principal?.schoolScopeSource === "request" &&
      this.normalizeSchoolCode(principal?.effectiveSchoolCode),
    );
  }

  principalSchoolCodes(principal = {}) {
    return new Set(
      [
        principal.effectiveSchoolCode,
        principal.effectiveSchoolInternalCode,
        principal.schoolCode,
      ]
        .map((value) => this.normalizeSchoolCode(value))
        .filter((value) => value && value !== "*"),
    );
  }

  rowSchoolCodes(row = {}, schoolField = "schoolCode") {
    return new Set(
      [
        row[schoolField],
        row.schoolCode,
        row.school_code,
        row.schoolPublicCode,
        row.school_public_code,
        row.schoolLoginCode,
        row.school_login_code,
      ]
        .map((value) => this.normalizeSchoolCode(value))
        .filter(Boolean),
    );
  }

  rowMatchesStudentScope(row = {}, studentIds = new Set()) {
    for (const value of [row.studentId, row.id, row.publicId, row.matricule]) {
      const key = String(value ?? "").trim();
      if (key && studentIds.has(key)) {
        return true;
      }
    }
    return false;
  }

  filterByRoleOwnership(rows, principal) {
    const studentIds = new Set(principal.studentIds ?? []);
    const classNames = new Set(principal.classNames ?? []);

    if (principal.role === "Parent" || principal.role === "Élève / Étudiant") {
      if (!studentIds.size) {
        return [];
      }

      return rows.filter((row) => {
        if (this.rowMatchesStudentScope(row, studentIds)) return true;
        if (row.studentId) return studentIds.has(String(row.studentId).trim());
        if (row.id && row.matricule) return false;
        if (row.className && !row.studentId && !row.matricule) return true;
        return !["student", "payment", "grade", "attendance"].includes(
          String(row.entityType ?? "").toLowerCase(),
        );
      });
    }

    if (principal.role === "Enseignant") {
      const classCodes = new Set(
        [...(principal.classCodes ?? [])]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      );
      // Sans aucune affectation (ni nom ni code) : ne rien exposer — évite la fuite
      // où filterByRoleOwnership laissait passer tout l'établissement.
      if (!classNames.size && !classCodes.size) {
        return [];
      }

      return rows.filter((row) => {
        const rowCode = String(row.classCode ?? row.class_code ?? "").trim();
        if (classCodes.size && rowCode) {
          return classCodes.has(rowCode);
        }
        if (classNames.size) {
          if (row.className) return classNames.has(row.className);
          if (row.name && row.level && row.track) return classNames.has(row.name);
          if (row.studentClassName) return classNames.has(row.studentClassName);
        }
        // Enseignant avec codes mais ligne sans classCode : ne pas élargir.
        if (classCodes.size) {
          return false;
        }
        return true;
      });
    }

    return rows;
  }

  assertSchoolAccess(principal, schoolCode) {
    if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
      return;
    }

    const requested = this.normalizeSchoolCode(schoolCode);
    if (requested && this.principalSchoolCodes(principal).has(requested)) {
      return;
    }

    if (principal.role === "Admin Pays") {
      if (this.countryCodeFromSchool(schoolCode) === principal.countryCode) {
        return;
      }
      throw new BusinessError(403, "Accès refusé: pays hors périmètre.");
    }

    throw new BusinessError(403, "Accès refusé: établissement hors périmètre.");
  }

  isSystemBroadcast(row = {}) {
    return row.systemBroadcast === true || String(row.scope ?? "").trim().toLowerCase() === "system";
  }

  countryCodeFromSchool(schoolCode) {
    return String(schoolCode ?? "").slice(0, 2).toUpperCase();
  }

  countryCodeFromCountry(country) {
    const normalized = String(country ?? "").trim().toUpperCase();
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
}

module.exports = { TenantScopeService };
