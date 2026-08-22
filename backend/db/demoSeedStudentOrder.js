"use strict";

const seedData = require("../data");
const { hashSecret } = require("../services/credentialService");
const { shouldSeedDemoData } = require("../lib/demoSeedPolicy");

function normalizeRole(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isStudentSeedUser(user) {
  const role = normalizeRole(user?.role);
  return role === "STUDENT" || role === "ELEVE / ETUDIANT";
}

function isAcademicStudentUserInsertSql(sql) {
  const normalized = String(sql ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return normalized.includes("INSERT INTO USERS") && normalized.includes("'STUDENT'");
}

function withoutAcademicStudentUserWrites(client) {
  if (!client || typeof client.query !== "function") {
    return client;
  }
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return async (sql, params) => {
          if (isAcademicStudentUserInsertSql(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return target.query(sql, params);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Les triggers canoniques imposent qu'un compte STUDENT référence d'abord une
 * ligne students existante. Le seed historique créait ces comptes à deux
 * endroits trop tôt : seedReferenceData() puis seedAcademicData().
 *
 * Ce wrapper conserve les contraintes fail-closed :
 * - les comptes élèves sont retirés uniquement pendant seedReferenceData() ;
 * - les INSERT users/STUDENT de seedAcademicData() sont neutralisés ;
 * - ensureStudentUsers() crée ensuite les comptes depuis students ;
 * - parent_email / parent_phone ne sont jamais recopiés dans users.email/phone,
 *   car ces colonnes sont des identités de connexion uniques par établissement.
 */
function attachDemoStudentSeedOrder(repository) {
  if (!repository || typeof repository.seedReferenceData !== "function") {
    return repository;
  }
  if (repository.__demoStudentSeedOrderAttached) {
    return repository;
  }

  const originalSeedReferenceData = repository.seedReferenceData;
  const originalSeedAcademicData =
    typeof repository.seedAcademicData === "function" ? repository.seedAcademicData : null;

  repository.seedReferenceData = async function seedReferenceDataWithoutPrematureStudents(client) {
    const accounts = seedData.userAccounts;
    if (!Array.isArray(accounts)) {
      return originalSeedReferenceData.call(this, client);
    }

    const snapshot = accounts.slice();
    const referenceAccounts = snapshot.filter((user) => !isStudentSeedUser(user));

    if (referenceAccounts.length === snapshot.length) {
      return originalSeedReferenceData.call(this, client);
    }

    accounts.splice(0, accounts.length, ...referenceAccounts);
    try {
      return await originalSeedReferenceData.call(this, client);
    } finally {
      accounts.splice(0, accounts.length, ...snapshot);
    }
  };

  if (originalSeedAcademicData) {
    repository.seedAcademicData = async function seedAcademicDataWithoutStudentUsers(client, maps) {
      return originalSeedAcademicData.call(this, withoutAcademicStudentUserWrites(client), maps);
    };
  }

  if (typeof repository.ensureStudentUsers === "function") {
    repository.ensureStudentUsers = async function ensureStudentUsersCanonical() {
      if (!shouldSeedDemoData()) {
        return;
      }
      await this.query(
        `INSERT INTO users (
           school_id, user_code, first_name, last_name, email, phone,
           password_hash, pin_hash, role, status
         )
         SELECT
           st.school_id, st.student_code, st.first_name, st.last_name,
           NULL::text, NULL::text, NULL, $1, 'STUDENT', st.status
         FROM students st
         LEFT JOIN users u
           ON u.school_id = st.school_id AND u.user_code = st.student_code
         WHERE u.id IS NULL
         ON CONFLICT (user_code) DO NOTHING`,
        [hashSecret("1234")],
      );
    };
  }

  Object.defineProperty(repository, "__demoStudentSeedOrderAttached", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return repository;
}

module.exports = {
  attachDemoStudentSeedOrder,
  isStudentSeedUser,
  isAcademicStudentUserInsertSql,
  withoutAcademicStudentUserWrites,
};
