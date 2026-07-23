/**
 * Jeu de données plateforme : 3 pays, 3 établissements (1 / pays).
 * Par établissement : 30 classes (10 élèves/classe), 300 élèves, 59 enseignants, 40 matières.
 */
const { rolePermissions } = require("../data");
const { buildSchoolBulletinBundle } = require("./bulletinSeedData");
const { buildSchoolPlanningSlots, buildAcademicConfigsFromState } = require("./planningSeedData");

const SCHOOLS_PER_COUNTRY = 1;
const USERS_PER_ROLE = 10;
const PLATFORM_ADMINS_PER_SCOPE = 1;
const RECORDS_PER_FEATURE = 10;

const CLASSES_PER_SCHOOL = 30;
const STUDENTS_PER_CLASS = 10;
const STUDENTS_PER_SCHOOL = CLASSES_PER_SCHOOL * STUDENTS_PER_CLASS;
const TEACHERS_PER_SCHOOL = 59;
const SUBJECTS_PER_SCHOOL = 40;

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
  "EPS",
  "Musique",
  "Arts plastiques",
  "Philosophie",
  "Latin",
  "Espagnol",
  "Allemand",
  "Économie",
  "Comptabilité",
  "Droit",
  "Biologie",
  "Géologie",
  "Astronomie",
  "Robotique",
  "Programmation",
  "Électronique",
  "Mécanique",
  "Électricité",
  "Dessin technique",
  "Statistiques",
  "Communication",
  "Entrepreneuriat",
  "Citoyenneté",
  "Éducation civique",
  "Religion",
  "Kinyarwanda",
  "Lingala",
  "Swahili",
  "Kituba",
  "Tshiluba",
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

const CONTACT_TYPES_CYCLE = ["Parent", "Enseignant", "Élève", "Secrétaire", "Comptable", "Directeur"];

const COUNTRY_TEMPLATES = [
  {
    code: "CD",
    name: "République Démocratique du Congo",
    phonePrefix: "+243",
    currency: "CDF",
    timezone: "GMT+1",
    scope: "RDC",
    adminIdentifier: "admin-rdc",
  },
  {
    code: "CG",
    name: "République du Congo",
    phonePrefix: "+242",
    currency: "XAF",
    timezone: "GMT+1",
    scope: "CG",
    adminIdentifier: "admin-cg",
  },
  {
    code: "BI",
    name: "Burundi",
    phonePrefix: "+257",
    currency: "BIF",
    timezone: "GMT+2",
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

function usersPerSchoolRole(role) {
  return role === "Admin School" ? PLATFORM_ADMINS_PER_SCOPE : USERS_PER_ROLE;
}

function buildCountryAdmins(country, countryIndex) {
  const users = [];
  for (let index = 1; index <= PLATFORM_ADMINS_PER_SCOPE; index += 1) {
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
  const isPrimaryDemo = userIndex === 1;
  const identifier =
    role === "Admin School" && isPrimaryDemo
      ? country.code === "CD"
        ? "admin"
        : `admin-${country.code.toLowerCase()}`
      : isPrimaryDemo && code === "CD-2026-0001"
        ? role === "Préfet des études"
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
    for (let userIndex = 1; userIndex <= usersPerSchoolRole(role); userIndex += 1) {
      users.push(buildSchoolRoleUser(school, country, role, userIndex));
    }
  }
  return users;
}

function buildClassName(classIndex) {
  const level = DEMO_LEVELS[Math.floor(classIndex / 5) % DEMO_LEVELS.length];
  const section = String.fromCharCode(65 + (classIndex % 5));
  return `${level} ${section}`;
}

function buildSubjectCatalog(count = SUBJECTS_PER_SCHOOL) {
  return DEMO_SUBJECTS.slice(0, count);
}

function buildSchoolContactsAndRelations(school, country, students, teachers) {
  const code = school.code;
  const contacts = [];
  const relations = [];

  for (let index = 1; index <= RECORDS_PER_FEATURE; index += 1) {
    const contactType = CONTACT_TYPES_CYCLE[(index - 1) % CONTACT_TYPES_CYCLE.length];
    const firstName = DEMO_FIRST_NAMES[(index - 1) % DEMO_FIRST_NAMES.length];
    const lastName = DEMO_LAST_NAMES[(index + 1) % DEMO_LAST_NAMES.length];
    const contactId = `CNT-${code}-${pad(index, 2)}`;
    const student = students[index - 1];
    const teacher = teachers[index - 1];
    const wantsAccess = contactType === "Parent" && index <= 3;

    contacts.push({
      id: contactId,
      schoolCode: code,
      lastName,
      firstName,
      contactType,
      phone: `${country.phonePrefix} 850 ${pad(index, 3)} ${pad(parseInt(code.slice(-4), 10), 3)}`,
      email: scopedEmail(code, `contact${index}`),
      gender: index % 2 === 0 ? "Féminin" : "Masculin",
      birthDate: `15-0${(index % 9) + 1}-1985`,
      address: `Rue ${index}, ${school.city}`,
      status: "Actif",
      hasAccess: wantsAccess ? "Oui" : "Non",
      role: wantsAccess ? "Parent" : "",
      teacherId: contactType === "Enseignant" ? teacher?.id ?? "" : "",
      studentId: contactType === "Élève" ? student?.id ?? "" : "",
      userId: wantsAccess ? `USER-PARENT-${code}-${pad(index, 2)}` : "",
      userIdentifier: wantsAccess
        ? `parent-${country.code.toLowerCase()}-01-${pad(index, 2)}`
        : "",
    });
  }

  const parentContacts = contacts.filter((row) => String(row.contactType ?? "") === "Parent");
  students.forEach((student, index) => {
    const parentContact =
      parentContacts[index % Math.max(parentContacts.length, 1)] ?? contacts[0];
    const parentContactId = String(parentContact?.id ?? "").trim();
    const parentFirstName = String(parentContact?.firstName ?? DEMO_FIRST_NAMES[(index + 1) % DEMO_FIRST_NAMES.length]);
    const parentLastName = String(parentContact?.lastName ?? DEMO_LAST_NAMES[index % DEMO_LAST_NAMES.length]);
    const studentLastName = student.name.replace(student.firstName, "").trim() || student.name;
    if (!parentContactId) return;

    relations.push({
      id: `REL-${code}-${pad(index + 1, 3)}`,
      schoolCode: code,
      relationType: "Parent → Élève",
      fromContactId: parentContactId,
      fromContactName: `${parentFirstName} ${parentLastName}`,
      toStudentId: student.id,
      toStudentName: `${student.firstName} ${studentLastName}`,
      isPrincipal: index === 0 ? "Oui" : "Non",
      status: "Actif",
    });
  });

  return { contacts, relations };
}

function buildSchoolAcademicBundle(school, country) {
  const code = school.code;
  const subjectNames = buildSubjectCatalog(SUBJECTS_PER_SCHOOL);
  const classes = [];
  const teachers = [];
  const students = [];
  const assignments = [];
  const presences = [];
  const payments = [];
  const announcements = [];
  const exams = [];
  const documents = [];
  const messages = [];

  for (let classIndex = 0; classIndex < CLASSES_PER_SCHOOL; classIndex += 1) {
    const className = buildClassName(classIndex);
    const classId = `CLS-${code}-${pad(classIndex + 1, 2)}`;
    const level = DEMO_LEVELS[Math.floor(classIndex / 5) % DEMO_LEVELS.length];
    const track = DEMO_TRACKS[classIndex % DEMO_TRACKS.length];

    classes.push({
      id: classId,
      publicId: `${code}-${classId}`,
      schoolCode: code,
      name: className,
      level,
      track,
      teacherId: "",
    });
  }

  for (let index = 1; index <= TEACHERS_PER_SCHOOL; index += 1) {
    const teacherId = `TCH-${code}-${pad(index, 3)}`;
    const teacherPublicId = `${code}-ENS-${pad(index, 4)}`;
    const teacherLoginId =
      code === "CD-2026-0001" && index === 1 ? "ENS-0001" : `ENS-${pad(parseInt(code.slice(-4), 10) * 100 + index, 4)}`;
    const teacherFirstName = DEMO_FIRST_NAMES[(index - 1) % DEMO_FIRST_NAMES.length];
    const teacherLastName = DEMO_LAST_NAMES[(index + 2) % DEMO_LAST_NAMES.length];
    const mainSubject = subjectNames[(index - 1) % SUBJECTS_PER_SCHOOL];
    const className = classes[(index - 1) % CLASSES_PER_SCHOOL].name;

    teachers.push({
      id: teacherId,
      publicId: teacherPublicId,
      schoolCode: code,
      identifier: teacherLoginId,
      name: `${teacherFirstName} ${teacherLastName}`,
      firstName: teacherFirstName,
      phone: `${country.phonePrefix} 830 ${pad(index % 1000, 3)} ${pad(parseInt(code.slice(-4), 10), 3)}`,
      email: scopedEmail(code, `ens${index}`),
      mainSubject,
      password: "1234",
      assignments: [{ className, course: mainSubject }],
    });

    assignments.push({
      id: `${teacherId}-ASSIGN-${pad(index, 3)}`,
      schoolCode: code,
      teacherId,
      teacherName: `${teacherFirstName} ${teacherLastName}`,
      className,
      subject: mainSubject,
      course: mainSubject,
    });

    classes[(index - 1) % CLASSES_PER_SCHOOL].teacherId = teacherPublicId;
  }

  for (let classIndex = 0; classIndex < CLASSES_PER_SCHOOL; classIndex += 1) {
    const className = classes[classIndex].name;
    for (let seat = 0; seat < STUDENTS_PER_CLASS; seat += 1) {
      const studentIndex = classIndex * STUDENTS_PER_CLASS + seat + 1;
      const studentId = `STU-${code}-${pad(studentIndex, 3)}`;
      const matricule =
        code === "CD-2026-0001" && studentIndex === 1 ? "ELE-0001" : `${code}-ELE-${pad(studentIndex, 4)}`;
      const studentFirstName = DEMO_FIRST_NAMES[(studentIndex + 4) % DEMO_FIRST_NAMES.length];
      const studentLastName = DEMO_LAST_NAMES[(studentIndex + 1) % DEMO_LAST_NAMES.length];

      students.push({
        id: studentId,
        publicId: matricule,
        matricule,
        name: `${studentFirstName} ${studentLastName}`,
        firstName: studentFirstName,
        gender: studentIndex % 2 === 0 ? "Féminin" : "Masculin",
        birthDate: `${pad((studentIndex % 27) + 1, 2)}-0${(studentIndex % 9) + 1}-2012`,
        className,
        schoolCode: code,
        pin: "1234",
        parentName: `Parent ${studentLastName}`,
        parentPhone: `${country.phonePrefix} 840 ${pad(studentIndex % 1000, 3)} ${pad(parseInt(code.slice(-4), 10), 3)}`,
        parentEmail: scopedEmail(code, `parent${studentIndex}`),
        archived: false,
      });
    }
  }

  students.forEach((student, index) => {
    const presenceStatus = ["Present", "Absent", "Retard", "Justifié"][index % 4];
    presences.push({
      id: `P-${code}-${pad(index + 1, 3)}`,
      publicId: `PRE-${code}-${pad(index + 1, 3)}`,
      schoolCode: code,
      studentId: student.id,
      className: student.className,
      date: `2026-06-${pad((index % 27) + 1, 2)}`,
      present: presenceStatus === "Present" || presenceStatus === "Justifié",
      status: presenceStatus,
    });

    payments.push({
      id: `PAY-${code}-${pad(index + 1, 3)}`,
      publicId: `PAY-${code}-${pad(index + 1, 3)}`,
      schoolCode: code,
      studentId: student.id,
      amount: 10000 + (index % 5) * 5000,
      date: `2026-05-${pad((index % 27) + 1, 2)}`,
      status: index % 4 === 0 ? "EN_ATTENTE" : "PAYE",
      method: ["Mobile Money", "Especes", "Virement bancaire", "Carte bancaire"][index % 4],
    });
  });

  for (let index = 1; index <= RECORDS_PER_FEATURE; index += 1) {
    const className = classes[(index - 1) % CLASSES_PER_SCHOOL].name;
    const subject = subjectNames[(index - 1) % SUBJECTS_PER_SCHOOL];
    const student = students[index - 1];

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

    if (student) {
      documents.push({
        id: `DOC-${code}-${pad(index, 2)}`,
        schoolCode: code,
        studentId: student.id,
        studentName: student.name,
        documentType: ["Attestation", "Certificat", "Relevé", "Bulletin"][index % 4],
        title: `Document ${index} — ${student.name}`,
        format: "PDF",
        status: index % 5 === 0 ? "En génération" : "Disponible",
        generatedAt: index % 5 === 0 ? "" : `${pad((index % 27) + 1, 2)}-05-2026`,
      });

      messages.push({
        id: `MSG-${code}-${pad(index, 2)}`,
        schoolCode: code,
        from: `Admin ${school.name}`,
        to: `Parent ${student.name}`,
        subject: `Message ${index}`,
        body: `Message établissement ${code} pour la famille ${student.name}.`,
        date: `${pad((index % 27) + 1, 2)}-06-2026`,
        status: index % 3 === 0 ? "Lu" : "Non lu",
        channel: "Application",
      });
    }
  }

  const classCourses = classes.flatMap((schoolClass) =>
    subjectNames.map((subject, subjectIndex) => ({
      id: `CRS-${code}-${slugClass(schoolClass.name)}-${pad(subjectIndex + 1, 3)}`,
      publicId: `CRS-${code}-${slugClass(schoolClass.name)}-${pad(subjectIndex + 1, 3)}`,
      schoolCode: code,
      name: subject,
      className: schoolClass.name,
      coefficient: (subjectIndex % 3) + 1,
      teacherId: teachers[subjectIndex % TEACHERS_PER_SCHOOL].id,
      teacherName: teachers[subjectIndex % TEACHERS_PER_SCHOOL].name,
    })),
  );

  const bulletinBundle = buildSchoolBulletinBundle({
    schoolCode: code,
    students,
    courses: classCourses,
    teachers,
    periods: ["Trimestre 1"],
    studentsPerClass: STUDENTS_PER_CLASS,
  });

  const courseSchedules = buildSchoolPlanningSlots({
    schoolCode: code,
    courses: classCourses,
    classes,
    maxClasses: CLASSES_PER_SCHOOL,
  });

  const { contacts, relations } = buildSchoolContactsAndRelations(school, country, students, teachers);

  return {
    school,
    country,
    classes,
    courses: classCourses,
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
    contacts,
    relations,
  };
}

function slugClass(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase();
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
    contacts: [],
    relations: [],
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
      countryAdmins: countries.length * PLATFORM_ADMINS_PER_SCOPE,
      schools: platformSchools.length,
      platformAdminsPerScope: PLATFORM_ADMINS_PER_SCOPE,
      usersPerRole: USERS_PER_ROLE,
      recordsPerFeature: RECORDS_PER_FEATURE,
      classesPerSchool: CLASSES_PER_SCHOOL,
      studentsPerClass: STUDENTS_PER_CLASS,
      studentsPerSchool: STUDENTS_PER_SCHOOL,
      teachersPerSchool: TEACHERS_PER_SCHOOL,
      subjectsPerSchool: SUBJECTS_PER_SCHOOL,
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
  PLATFORM_ADMINS_PER_SCOPE,
  RECORDS_PER_FEATURE,
  CLASSES_PER_SCHOOL,
  STUDENTS_PER_CLASS,
  STUDENTS_PER_SCHOOL,
  TEACHERS_PER_SCHOOL,
  SUBJECTS_PER_SCHOOL,
  SCHOOL_USER_ROLES,
  COUNTRY_TEMPLATES,
};
