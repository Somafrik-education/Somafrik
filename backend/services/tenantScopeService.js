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

    if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
      return rows;
    }

    const roleScoped = this.filterByRoleOwnership(rows, principal);

    if (principal.role === "Admin Pays") {
      return roleScoped.filter((row) => {
        if (this.isSystemBroadcast(row)) return true;
        const countryCode = row[countryField] ?? this.countryCodeFromCountry(row.country) ?? this.countryCodeFromSchool(row[schoolField]);
        return Boolean(countryCode) && countryCode === principal.countryCode;
      });
    }

    // Périmètre établissement : un compte ne doit jamais voir les données d'un autre
    // établissement (SOM-SAA-002). On rattache chaque ligne à l'établissement par son
    // code, son élève ou sa/ses classe(s). Les anciennes lignes sans code établissement
    // ne sont plus diffusées globalement : elles doivent être reliées à l'établissement.
    const studentIds = new Set([...(principal.studentIds ?? []), ...(schoolStudentIds ?? [])]);
    const classNames = new Set([...(principal.classNames ?? []), ...(schoolClassNames ?? [])]);

    return roleScoped.filter((row) => {
      // Diffusion système (Super Admin) : annonce/message destiné à tous les établissements.
      if (this.isSystemBroadcast(row)) return true;

      if (
        (principal.role === "Parent" || principal.role === "Élève / Étudiant") &&
        this.rowMatchesStudentScope(row, studentIds)
      ) {
        return true;
      }

      const rowSchool = this.normalizeSchoolCode(row[schoolField]);
      const principalSchool = this.normalizeSchoolCode(principal.schoolCode);
      if (rowSchool) {
        return rowSchool === principalSchool;
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

    if (principal.role === "Admin Pays") {
      if (this.countryCodeFromSchool(schoolCode) === principal.countryCode) {
        return;
      }
      throw new BusinessError(403, "Accès refusé: pays hors périmètre.");
    }

    if (schoolCode && schoolCode !== principal.schoolCode) {
      throw new BusinessError(403, "Accès refusé: établissement hors périmètre.");
    }
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
