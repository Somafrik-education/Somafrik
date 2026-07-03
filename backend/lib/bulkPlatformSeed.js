/**
 * Jeu de données plateforme : 3 pays, 3 admins pays, 10 établissements / pays,
 * 10 admins scolaires / établissement, 10 enregistrements / fonctionnalité / établissement.
 */
const { rolePermissions } = require("../data");
const { buildSchoolBulletinBundle } = require("./bulletinSeedData");
const { buildSchoolPlanningSlots, buildAcademicConfigsFromState } = require("./planningSeedData");

const SCHOOLS_PER_COUNTRY = 10;
const USERS_PER_ROLE = 10;
const RECORDS_PER_FEATURE = 10;

/** Rôles établissement créés comme comptes utilisateurs (hors Enseignant/Élève déjà portés par teachers/students). */
const SCHOOL_USER_ROLES = [
  "Admin School",
  "Secrétaire",
  "Préfet des études",
  "Proviseur",
  "Directeur",
  "Comptable",
  "Surveillant",
  "Parent",
];

const ROLE_IDENTIFIER_PREFIX = {
  "Admin School": "admin",
  Secrétaire: "secretaire",
  "Préfet des études": "prefet",
  Proviseur: "proviseur",
  Directeur: "directeur",
  Comptable: "comptable",
  Surveillant: "surveillant",
  Parent: "parent",
};

const DEMO_SUBJECTS = [
  "Mathématiques",
  "Français",
  "Sciences",
  "Histoire",
  "Géographie",
  "Anglais",
  "Physique",
  "Chimie",
  "SVT",
  "Informatique",
];

const DEMO_FIRST_NAMES = ["Jean", "Marie", "Patrick", "Sarah", "Grace", "David", "Amina", "Joseph", "Chantal", "Moise"];
const DEMO_LAST_NAMES = ["Kabeya", "Mukendi", "Ilunga", "Mbuyi", "Kabasele", "Tshibangu", "Mabiala", "Ndaye", "Kalala", "Mbala"];
const DEMO_LEVELS = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
const DEMO_TRACKS = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
const DEMO_CITIES = {
  CD: ["Kinshasa", "Lubumbashi", "Goma", "Mbuji-Mayi", "Kisangani"],
  CG: ["Brazzaville", "Pointe-Noire", "Dolisie", "Nkayi", "Owando"],
  BI: ["Bujumbura", "Gitega", "Ngozi", "Rumonge", "Muyinga"],
};

const COUNTRY_TEMPLATES = [
  {
    code: "CD",
    name: "République Démocratique du Congo",
    phonePrefix: "+243",
    currency: "CDF",
    timezone: "Africa/Kinshasa",
    scope: "RDC",
    adminIdentifier: "admin-rdc",
  },
  {
    code: "CG",
    name: "République du Congo",
    phonePrefix: "+242",
    currency: "XAF",
    timezone: "Africa/Brazzaville",
    scope: "CG",
    adminIdentifier: "admin-cg",
  },
  {
    code: "BI",
    name: "Burundi",
    phonePrefix: "+257",
    currency: "BIF",
    timezone: "Africa/Bujumbura",
    scope: "BI",
    adminIdentifier: "admin-bi",
  },
];

function pad(value, width = 4) {
  return String(value).padStart(width, "0");
}

function schoolCode(iso, index) {
  return `${iso}-2026-${pad(index, 4)}`;
}

function scopedEmail(schoolCodeValue, localPart, domain = "somafrik.demo") {
  return `${localPart}+${schoolCodeValue.toLowerCase()}@${domain}`;
}

function buildSuperAdmins() {
  const users = [];
  for (let index = 1; index <= USERS_PER_ROLE; index += 1) {
    users.push({
      id: `USER-SUPERADMIN-${pad(index, 2)}`,
      publicId: index === 1 ? "USR-2026-000002" : `USR-SUPER-${pad(index, 4)}`,
      lastName: "Somafrik",
      firstName: index === 1 ? "Super Admin" : `Super Admin ${index}`,
      gender: "Masculin",
      phone: `+243 810 000 ${pad(900 + index, 3)}`,
      email: index === 1 ? "superadmin@somafrik.app" : `superadmin${index}@somafrik.app`,
      role: "Super Administrateur Somafrik",
      secondaryRoles: [],
      scopeLevel: "Global",
      countryScope: "",
      schoolCode: "*",
      accessChannel: "Application",
      identifier: index === 1 ? "superadmin" : `superadmin-${pad(index, 2)}`,
      password: "1234",
      status: "Actif",
      permissions: rolePermissions["Super Administrateur Somafrik"],
      temporaryPassword: "",
      photoUrl: "",
      createdAt: "01-09-2025",
      lastLoginAt: "01-06-2026",
      createdBy: "Système",
      history: [`Compte super administrateur #${index}`],
    });
  }
  return users;
}

function buildCountryAdmins(country, countryIndex) {
  const users = [];
  for (let index = 1; index <= USERS_PER_ROLE; index += 1) {
    users.push({
      id: `USER-COUNTRY-${country.code}-${pad(index, 2)}`,
      publicId: `ADM-${country.code}-2026-${pad(index, 4)}`,
      lastName: "Admin",
      firstName:
        index === 1
          ? country.code === "CD"
            ? "RDC"
            : country.name.split(" ").pop()
          : `${country.name.split(" ").pop()} ${index}`,
      gender: index % 2 === 0 ? "Féminin" : "Masculin",
      phone: `${country.phonePrefix} 810 ${pad(900 + countryIndex, 3)} ${pad(index, 3)}`,
      email:
        index === 1
          ? `admin.${country.code.toLowerCase()}@somafrik.app`
          : `admin.${country.code.toLowerCase()}.${index}@somafrik.app`,
      role: "Admin Pays",
      secondaryRoles: [],
      scopeLevel: "Pays",
      countryScope: country.scope,
      schoolCode: "*",
      accessChannel: "Application",
      identifier: index === 1 ? country.adminIdentifier : `${country.adminIdentifier}-${pad(index, 2)}`,
      password: "1234",
      status: "Actif",
      permissions: rolePermissions["Admin Pays"],
      temporaryPassword: "",
      photoUrl: "",
      createdAt: "01-09-2025",
      lastLoginAt: "01-06-2026",
      createdBy: "Super Administrateur Somafrik",
      history: [`Compte admin pays ${country.name} #${index}`],
    });
  }
  return users;
}

function buildSchoolRecord(country, schoolIndex) {
  const code = schoolCode(country.code, schoolIndex);
  const cities = DEMO_CITIES[country.code] ?? DEMO_CITIES.CD;
  const city = cities[(schoolIndex - 1) % cities.length];
  const types = ["École primaire", "Collège", "Lycée", "Université", "Institut"];

  return {
    id: `SCHOOL-${country.code}-${pad(schoolIndex, 4)}`,
    publicId: code,
    code,
    name: `Établissement Somafrik ${country.code} ${pad(schoolIndex, 2)}`,
    type: types[(schoolIndex - 1) % types.length],
    city,
    country: country.scope,
    address: `Avenue Somafrik ${schoolIndex}, ${city}`,
    phone: `${country.phonePrefix} 810 ${pad(schoolIndex, 3)} 100`,
    email: scopedEmail(code, "contact"),
    website: `https://${code.toLowerCase()}.somafrik.demo`,
    currency: country.currency,
    slogan: "Excellence et Innovation",
    status: "Actif",
    logoUrl: "",
    schoolYear: "2025-2026",
    timezone: country.timezone,
    language: "Français",
    dateFormat: "JJ-MM-AAAA",
    primaryColor: "#2563EB",
    subscriptionPlan: ["Essentiel", "Standard", "Premium"][(schoolIndex - 1) % 3],
    subscriptionStartDate: "01-09-2025",
    subscriptionEndDate: "31-08-2026",
    validationStatus: "Validé",
    subscriptionStatus: "À jour",
    maxStudents: 1200,
    maxTeachers: 120,
    createdAt: "01-09-2025",
  };
}

function buildSubscription(school, country) {
  return {
    id: `SUB-${school.code}`,
    schoolCode: school.code,
    countryCode: country.code,
    country: school.country,
    plan: school.subscriptionPlan,
    monthlyPrice: [60, 90, 120][(parseInt(school.code.slice(-2), 10) - 1) % 3],
    annualPrice: [600, 900, 1200][(parseInt(school.code.slice(-2), 10) - 1) % 3],
    currency: "USD",
    status: "Actif",
    paymentStatus: "À jour",
    startDate: "01-09-2025",
    endDate: "31-08-2026",
    lastPaymentDate: "01-06-2026",
  };
}

function buildSchoolRoleUser(school, country, role, userIndex) {
  const code = school.code;
  const schoolNum = pad(parseInt(code.slice(-4), 10), 2);
  const prefix = ROLE_IDENTIFIER_PREFIX[role] ?? "user";
  const isPrimaryDemo = code === "CD-2026-0001" && userIndex === 1;
  const identifier = isPrimaryDemo
    ? role === "Admin School"
      ? "admin"
      : role === "Préfet des études"
        ? "prefet"
        : role === "Secrétaire"
          ? "secretaire"
          : `${prefix}-${country.code.toLowerCase()}-${schoolNum}-${pad(userIndex, 2)}`
    : `${prefix}-${country.code.toLowerCase()}-${schoolNum}-${pad(userIndex, 2)}`;

  const roleSlug = prefix.toUpperCase().replace(/-/g, "_");
  const publicId = `${roleSlug}-${code}-${pad(userIndex, 2)}`.slice(0, 64);

  return {
    id: `USER-${publicId}`,
    publicId,
    lastName: DEMO_LAST_NAMES[(userIndex - 1) % DEMO_LAST_NAMES.length],
    firstName: DEMO_FIRST_NAMES[(userIndex + 1) % DEMO_FIRST_NAMES.length],
    gender: userIndex % 2 === 0 ? "Féminin" : "Masculin",
    phone: `${country.phonePrefix} 85${pad(SCHOOL_USER_ROLES.indexOf(role), 1)} ${pad(parseInt(code.slice(-4), 10), 3)} ${pad(userIndex, 3)}`,
    email: scopedEmail(code, `${prefix}${userIndex}`),
    role,
    secondaryRoles: [],
    scopeLevel: "Établissement",
    countryScope: country.scope,
    schoolCode: code,
    accessChannel: "Application",
    identifier,
    password: "1234",
    status: "Actif",
    permissions: rolePermissions[role] ?? ["Voir tableau de bord"],
    temporaryPassword: "",
    photoUrl: "",
    createdAt: "01-09-2025",
    lastLoginAt: "01-06-2026",
    createdBy: "Super Administrateur Somafrik",
    history: [`Compte ${role} — ${code} #${userIndex}`],
  };
}

function buildSchoolStaffUsers(school, country) {
  const users = [];
  for (const role of SCHOOL_USER_ROLES) {
    for (let userIndex = 1; userIndex <= USERS_PER_ROLE; userIndex += 1) {
      users.push(buildSchoolRoleUser(school, country, role, userIndex));
    }
  }
  return users;
}

function buildSchoolAcademicBundle(school, country) {
  const code = school.code;
  const classes = [];
  const courses = [];
  const teachers = [];
  const students = [];
  const assignments = [];
  const notes = [];
  const presences = [];
  const payments = [];
  const announcements = [];
  const exams = [];
  const bulletins = [];
  const documents = [];
  const messages = [];

  for (let index = 1; index <= RECORDS_PER_FEATURE; index += 1) {
    const classId = `CLS-${code}-${pad(index, 2)}`;
    const level = DEMO_LEVELS[(index - 1) % DEMO_LEVELS.length];
    const track = DEMO_TRACKS[(index - 1) % DEMO_TRACKS.length];
    const className = `${level} ${String.fromCharCode(64 + ((index - 1) % 2) + 1)}`;

    classes.push({
      id: classId,
      publicId: `${code}-${classId}`,
      schoolCode: code,
      name: className,
      level,
      track,
      teacherId: "",
    });

    const subject = DEMO_SUBJECTS[(index - 1) % DEMO_SUBJECTS.length];
    courses.push({
      id: `CRS-${code}-${pad(index, 2)}`,
      publicId: `CRS-${code}-${pad(index, 2)}`,
      schoolCode: code,
      name: subject,
      className,
      coefficient: (index % 3) + 1,
      teacherId: "",
      teacherName: "",
    });

    const teacherId = `TCH-${code}-${pad(index, 2)}`;
    const teacherPublicId = `${code}-ENS-${pad(index, 4)}`;
    const teacherLoginId =
      code === "CD-2026-0001" && index === 1 ? "ENS-0001" : `ENS-${pad(parseInt(code.slice(-4), 10) * 100 + index, 4)}`;
    const teacherFirstName = DEMO_FIRST_NAMES[(index - 1) % DEMO_FIRST_NAMES.length];
    const teacherLastName = DEMO_LAST_NAMES[(index + 2) % DEMO_LAST_NAMES.length];
    teachers.push({
      id: teacherId,
      publicId: teacherPublicId,
      schoolCode: code,
      identifier: teacherLoginId,
      name: `${teacherFirstName} ${teacherLastName}`,
      firstName: teacherFirstName,
      phone: `${country.phonePrefix} 830 ${pad(index, 3)} ${pad(parseInt(code.slice(-4), 10), 3)}`,
      email: scopedEmail(code, `ens${index}`),
      mainSubject: subject,
      password: "1234",
      assignments: [{ className, course: subject }],
    });

    assignments.push({
      id: `${teacherId}-ASSIGN-${pad(index, 2)}`,
      schoolCode: code,
      teacherId,
      teacherName: `${teacherFirstName} ${teacherLastName}`,
      className,
      subject,
      course: subject,
    });

    courses[index - 1].teacherId = teacherId;
    courses[index - 1].teacherName = `${teacherFirstName} ${teacherLastName}`;
    classes[index - 1].teacherId = teacherPublicId;

    const studentId = `STU-${code}-${pad(index, 2)}`;
    const matricule = code === "CD-2026-0001" && index === 1 ? "ELE-0001" : `${code}-ELE-${pad(index, 4)}`;
    const studentFirstName = DEMO_FIRST_NAMES[(index + 4) % DEMO_FIRST_NAMES.length];
    const studentLastName = DEMO_LAST_NAMES[(index + 1) % DEMO_LAST_NAMES.length];
    students.push({
      id: studentId,
      publicId: matricule,
      matricule,
      name: `${studentFirstName} ${studentLastName}`,
      firstName: studentFirstName,
      gender: index % 2 === 0 ? "Féminin" : "Masculin",
      birthDate: `${pad((index % 27) + 1, 2)}-0${(index % 9) + 1}-2012`,
      className,
      schoolCode: code,
      pin: "1234",
      parentName: `Parent ${studentLastName}`,
      parentPhone: `${country.phonePrefix} 840 ${pad(index, 3)} ${pad(parseInt(code.slice(-4), 10), 3)}`,
      parentEmail: scopedEmail(code, `parent${index}`),
      archived: false,
    });

    const presenceStatus = ["Present", "Absent", "Retard", "Justifié"][index % 4];
    presences.push({
      id: `P-${code}-${pad(index, 2)}`,
      publicId: `PRE-${code}-${pad(index, 2)}`,
      schoolCode: code,
      studentId,
      className,
      date: `2026-06-${pad((index % 27) + 1, 2)}`,
      present: presenceStatus === "Present" || presenceStatus === "Justifié",
      status: presenceStatus,
    });

    payments.push({
      id: `PAY-${code}-${pad(index, 2)}`,
      publicId: `PAY-${code}-${pad(index, 2)}`,
      schoolCode: code,
      studentId,
      amount: 10000 + (index % 5) * 5000,
      date: `2026-05-${pad((index % 27) + 1, 2)}`,
      status: index % 4 === 0 ? "EN_ATTENTE" : "PAYE",
      method: ["Mobile Money", "Especes", "Virement bancaire", "Carte bancaire"][index % 4],
    });

    announcements.push({
      id: `A-${code}-${pad(index, 2)}`,
      schoolCode: code,
      title: `Annonce ${index} — ${school.name}`,
      message: `Communication établissement ${code}, message numéro ${index}.`,
      date: `${pad((index % 27) + 1, 2)}-06-2026`,
      audience: index % 2 === 0 ? "Parents" : "Tous",
      status: "Publié",
    });

    exams.push({
      id: `EX-${code}-${pad(index, 2)}`,
      schoolCode: code,
      name: `Examen ${index} — ${subject}`,
      className,
      subject,
      examType: ["Contrôle", "Devoir", "Examen", "Interrogation"][index % 4],
      date: `2026-06-${pad((index % 27) + 1, 2)}`,
      period: "Trimestre 1",
      status: ["Programmé", "En cours", "Publié", "Validé"][index % 4],
    });

    documents.push({
      id: `DOC-${code}-${pad(index, 2)}`,
      schoolCode: code,
      studentId,
      studentName: `${studentFirstName} ${studentLastName}`,
      documentType: ["Attestation", "Certificat", "Relevé", "Bulletin"][index % 4],
      title: `Document ${index} — ${studentLastName}`,
      format: "PDF",
      status: index % 5 === 0 ? "En génération" : "Disponible",
      generatedAt: index % 5 === 0 ? "" : `${pad((index % 27) + 1, 2)}-05-2026`,
    });

    messages.push({
      id: `MSG-${code}-${pad(index, 2)}`,
      schoolCode: code,
      from: `Admin ${school.name}`,
      to: `Parent ${studentLastName}`,
      subject: `Message ${index}`,
      body: `Message établissement ${code} pour la famille ${studentLastName}.`,
      date: `${pad((index % 27) + 1, 2)}-06-2026`,
      status: index % 3 === 0 ? "Lu" : "Non lu",
      channel: "Application",
    });
  }

  const bulletinBundle = buildSchoolBulletinBundle({
    schoolCode: code,
    students,
    courses,
    teachers,
    periods: ["Trimestre 1"],
  });

  const courseSchedules = buildSchoolPlanningSlots({
    schoolCode: code,
    courses,
    classes,
  });

  return {
    school,
    country,
    classes,
    courses,
    teachers,
    students,
    assignments,
    notes: bulletinBundle.notes,
    presences,
    payments,
    announcements,
    exams,
    bulletins: bulletinBundle.bulletins,
    courseSchedules,
    documents,
    messages,
  };
}

function buildPlatformNotifications(countries) {
  const notifications = [];
  const types = ["Pays", "Inscription", "Abonnement", "Paiement", "Maintenance", "Support", "Validation", "Rapport"];
  const priorities = ["Faible", "Moyenne", "Haute", "Critique"];

  for (const country of countries) {
    for (let index = 1; index <= RECORDS_PER_FEATURE; index += 1) {
      notifications.push({
        id: `NOTIF-${country.code}-${pad(index, 3)}`,
        audience: index % 2 === 0 ? "Super Administrateur Somafrik" : "Admin Pays",
        countryCode: country.code,
        title: `Notification ${country.code} #${index}`,
        message: `Événement plateforme ${index} pour ${country.name}.`,
        type: types[(index - 1) % types.length],
        priority: priorities[(index - 1) % priorities.length],
        channels: ["Web", "Tablette", "Mobile"],
        status: index % 3 === 0 ? "Lu" : "Non lu",
        date: `${pad((index % 27) + 1, 2)}-06-2026`,
        createdBy: "Système",
      });
    }
  }
  return notifications;
}

function buildBulkPlatformSeed() {
  const countries = [];
  const userAccounts = [...buildSuperAdmins()];
  const platformSchools = [];
  const subscriptions = [];
  const schoolBundles = [];

  const flat = {
    classes: [],
    courses: [],
    teachers: [],
    students: [],
    assignments: [],
    notes: [],
    presences: [],
    payments: [],
    announcements: [],
    exams: [],
    bulletins: [],
    courseSchedules: [],
    documents: [],
    messages: [],
  };

  COUNTRY_TEMPLATES.forEach((country, countryIndex) => {
    countries.push({
      id: `COUNTRY-${country.code}`,
      name: country.name,
      code: country.code,
      phonePrefix: country.phonePrefix,
      currency: country.currency,
      timezone: country.timezone,
      status: "Actif",
      administratorId: `USER-COUNTRY-${country.code}`,
      createdAt: "01-09-2025",
    });

    userAccounts.push(...buildCountryAdmins(country, countryIndex + 1));

    for (let schoolIndex = 1; schoolIndex <= SCHOOLS_PER_COUNTRY; schoolIndex += 1) {
      const school = buildSchoolRecord(country, schoolIndex);
      platformSchools.push(school);
      subscriptions.push(buildSubscription(school, country));

      userAccounts.push(...buildSchoolStaffUsers(school, country));

      const bundle = buildSchoolAcademicBundle(school, country);
      schoolBundles.push(bundle);

      for (const key of Object.keys(flat)) {
        flat[key].push(...bundle[key]);
      }
    }
  });

  const platformNotifications = buildPlatformNotifications(countries);
  const academicConfigs = buildAcademicConfigsFromState(flat);

  const usersByRole = userAccounts.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});
  usersByRole.Enseignant = (usersByRole.Enseignant ?? 0) + flat.teachers.length;
  usersByRole["Élève / Étudiant"] = (usersByRole["Élève / Étudiant"] ?? 0) + flat.students.length;

  return {
    meta: {
      countries: countries.length,
      countryAdmins: countries.length * USERS_PER_ROLE,
      schools: platformSchools.length,
      usersPerRole: USERS_PER_ROLE,
      recordsPerFeature: RECORDS_PER_FEATURE,
      schoolUserRoles: SCHOOL_USER_ROLES,
      usersByRole,
      totalUserAccounts: userAccounts.length + flat.teachers.length + flat.students.length,
    },
    countries,
    userAccounts,
    platformSchools,
    subscriptions,
    schoolBundles,
    platformNotifications,
    academicConfigs,
    ...flat,
    rolePermissions,
  };
}

module.exports = {
  buildBulkPlatformSeed,
  SCHOOLS_PER_COUNTRY,
  USERS_PER_ROLE,
  RECORDS_PER_FEATURE,
  SCHOOL_USER_ROLES,
  COUNTRY_TEMPLATES,
};
