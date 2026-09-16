"use strict";

const { rolePermissions } = require("../data");
const { buildBulkPlatformSeed } = require("./bulkPlatformSeed");
const { buildSchoolBulletinBundle } = require("./bulletinSeedData");

const PUBLIC_DEMO_COUNTRY = "CD";
const PUBLIC_DEMO_LOGIN_CODE = "CD-IN-26-001";
const PUBLIC_DEMO_CLASSES = 10;
const PUBLIC_DEMO_STUDENTS = 200;
const PUBLIC_DEMO_TEACHERS = 20;
const PUBLIC_DEMO_SUBJECTS = [
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
const CLASS_BLUEPRINTS = [
  ["1ère A", "1ère"],
  ["1ère B", "1ère"],
  ["2ème A", "2ème"],
  ["2ème B", "2ème"],
  ["3ème A", "3ème"],
  ["3ème B", "3ème"],
  ["4ème A", "4ème"],
  ["4ème B", "4ème"],
  ["5ème A", "5ème"],
  ["5ème B", "5ème"],
];

function pad(value, width = 3) {
  return String(value).padStart(width, "0");
}

function slug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function safeEmail(prefix) {
  return `${prefix}@demo.somafrik.invalid`;
}

function sanitizeSchool(school) {
  return {
    ...school,
    name: "Institut Scolaire Horizon Démo",
    type: "Établissement secondaire",
    city: "Kinshasa",
    address: "Adresse fictive — Zone Démonstration, Kinshasa",
    phone: "",
    email: safeEmail("contact"),
    website: "https://demo.somafrik.invalid",
    slogan: "Données fictives pour démonstration Somafrik",
    loginCode: PUBLIC_DEMO_LOGIN_CODE,
    publicId: PUBLIC_DEMO_LOGIN_CODE,
  };
}

function sanitizeStaffAccounts(accounts, schoolCode) {
  const perRoleLimit = new Map([
    ["Admin School", 1],
    ["Secrétaire", 1],
    ["Préfet des études", 1],
    ["Proviseur", 1],
    ["Directeur", 1],
    ["Comptable", 1],
    ["Surveillant", 1],
    ["Parent", 10],
  ]);
  const seen = new Map();
  const kept = [];

  for (const account of accounts) {
    if (String(account.schoolCode) !== schoolCode) continue;
    const limit = perRoleLimit.get(account.role) ?? 0;
    if (!limit) continue;
    const ordinal = (seen.get(account.role) ?? 0) + 1;
    if (ordinal > limit) continue;
    seen.set(account.role, ordinal);
    const roleLabel = account.role === "Admin School" ? "Administrateur" : account.role;
    kept.push({
      ...account,
      firstName: roleLabel,
      lastName: `Démo ${pad(ordinal, 2)}`,
      phone: "",
      email: safeEmail(`${slug(account.role).toLowerCase()}-${pad(ordinal, 2)}`),
      history: ["Compte fictif — environnement Démonstration"],
    });
  }

  return kept;
}

function buildClasses(bundle, schoolCode) {
  return bundle.classes.slice(0, PUBLIC_DEMO_CLASSES).map((row, index) => {
    const [name, level] = CLASS_BLUEPRINTS[index];
    return {
      ...row,
      schoolCode,
      name,
      level,
      track: "Générale",
      teacherId: "",
    };
  });
}

function buildTeachers(bundle, schoolCode) {
  return bundle.teachers.slice(0, PUBLIC_DEMO_TEACHERS).map((row, index) => ({
    ...row,
    schoolCode,
    firstName: "Enseignant",
    name: `Enseignant Démo ${pad(index + 1)}`,
    phone: "",
    email: safeEmail(`enseignant-${pad(index + 1)}`),
    mainSubject: PUBLIC_DEMO_SUBJECTS[index % PUBLIC_DEMO_SUBJECTS.length],
    assignments: [],
  }));
}

function buildStudents(bundle, classes, schoolCode) {
  const perClass = PUBLIC_DEMO_STUDENTS / PUBLIC_DEMO_CLASSES;
  return bundle.students.slice(0, PUBLIC_DEMO_STUDENTS).map((row, index) => {
    const classIndex = Math.min(PUBLIC_DEMO_CLASSES - 1, Math.floor(index / perClass));
    const className = classes[classIndex].name;
    const ordinal = index + 1;
    return {
      ...row,
      schoolCode,
      firstName: "Élève",
      name: `Élève Démo ${pad(ordinal)}`,
      className,
      parentName: `Parent Démo ${pad(((ordinal - 1) % 10) + 1, 2)}`,
      parentPhone: "",
      parentEmail: safeEmail(`parent-eleve-${pad(ordinal)}`),
      archived: false,
    };
  });
}

function buildCourses(classes, teachers, schoolCode) {
  const courses = [];
  classes.forEach((schoolClass, classIndex) => {
    PUBLIC_DEMO_SUBJECTS.forEach((subject, subjectIndex) => {
      const teacher = teachers[(classIndex * 5 + subjectIndex) % teachers.length];
      courses.push({
        id: `CRS-${schoolCode}-${slug(schoolClass.name)}-${pad(subjectIndex + 1)}`,
        publicId: `CRS-${schoolCode}-${slug(schoolClass.name)}-${pad(subjectIndex + 1)}`,
        schoolCode,
        name: subject,
        className: schoolClass.name,
        coefficient: (subjectIndex % 3) + 1,
        teacherId: teacher.id,
        teacherName: teacher.name,
      });
    });
  });
  return courses;
}

function buildAssignments(classes, teachers, schoolCode) {
  const assignments = [];
  let ordinal = 0;
  classes.forEach((schoolClass, classIndex) => {
    PUBLIC_DEMO_SUBJECTS.slice(0, 5).forEach((subject, subjectIndex) => {
      ordinal += 1;
      const teacher = teachers[(classIndex * 5 + subjectIndex) % teachers.length];
      assignments.push({
        id: `ASSIGN-${schoolCode}-${pad(ordinal)}`,
        schoolCode,
        teacherId: teacher.id,
        teacherName: teacher.name,
        className: schoolClass.name,
        subject,
        course: subject,
      });
    });
  });
  return assignments;
}

function buildPresences(students, schoolCode) {
  const statuses = ["Present", "Present", "Present", "Absent", "Retard", "Justifié"];
  return students.map((student, index) => {
    const status = statuses[index % statuses.length];
    return {
      id: `P-${schoolCode}-${pad(index + 1)}`,
      publicId: `PRE-${schoolCode}-${pad(index + 1)}`,
      schoolCode,
      studentId: student.id,
      className: student.className,
      date: `2026-06-${String((index % 20) + 1).padStart(2, "0")}`,
      present: status === "Present" || status === "Justifié",
      status,
    };
  });
}

function buildPayments(students, schoolCode) {
  return students.map((student, index) => ({
    id: `PAY-${schoolCode}-${pad(index + 1)}`,
    publicId: `PAY-${schoolCode}-${pad(index + 1)}`,
    schoolCode,
    studentId: student.id,
    amount: 10000 + (index % 4) * 5000,
    date: `2026-05-${String((index % 20) + 1).padStart(2, "0")}`,
    status: index % 4 === 3 ? "EN_ATTENTE" : "PAYE",
    method: ["Mobile Money", "Especes", "Virement bancaire"][index % 3],
  }));
}

function buildAnnouncements(schoolCode) {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `A-${schoolCode}-${pad(index + 1, 2)}`,
    schoolCode,
    title: `Annonce Démo ${index + 1}`,
    message: `Communication fictive de démonstration numéro ${index + 1}.`,
    date: `${String(index + 1).padStart(2, "0")}-06-2026`,
    audience: index % 2 === 0 ? "Tous" : "Parents",
    status: "Publié",
  }));
}

function buildExams(classes, schoolCode) {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `EX-${schoolCode}-${pad(index + 1, 2)}`,
    schoolCode,
    name: `Évaluation Démo ${index + 1} — ${PUBLIC_DEMO_SUBJECTS[index]}`,
    className: classes[index % classes.length].name,
    subject: PUBLIC_DEMO_SUBJECTS[index],
    examType: index % 2 === 0 ? "Examen" : "Devoir",
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    period: "Trimestre 1",
    status: index % 3 === 0 ? "Publié" : "Validé",
  }));
}

function buildDocuments(students, schoolCode) {
  return students.slice(0, 10).map((student, index) => ({
    id: `DOC-${schoolCode}-${pad(index + 1, 2)}`,
    schoolCode,
    studentId: student.id,
    studentName: student.name,
    documentType: index % 2 === 0 ? "Attestation" : "Relevé",
    title: `Document Démo ${index + 1} — ${student.name}`,
    format: "PDF",
    status: "Disponible",
    generatedAt: `${String(index + 1).padStart(2, "0")}-05-2026`,
  }));
}

function buildMessages(students, schoolCode) {
  return students.slice(0, 10).map((student, index) => ({
    id: `MSG-${schoolCode}-${pad(index + 1, 2)}`,
    schoolCode,
    from: "Administration Démo",
    to: `Parent Démo ${pad((index % 10) + 1, 2)}`,
    subject: `Message Démo ${index + 1}`,
    body: `Message fictif concernant ${student.name}.`,
    date: `${String(index + 1).padStart(2, "0")}-06-2026`,
    status: index % 3 === 0 ? "Lu" : "Non lu",
    channel: "Application",
  }));
}

function buildContactsAndRelations(students, teachers, parentAccounts, schoolCode) {
  const contacts = parentAccounts.map((account, index) => ({
    id: `CNT-${schoolCode}-PARENT-${pad(index + 1, 2)}`,
    schoolCode,
    lastName: `Démo ${pad(index + 1, 2)}`,
    firstName: "Parent",
    contactType: "Parent",
    phone: "",
    email: safeEmail(`parent-${pad(index + 1, 2)}`),
    gender: "",
    birthDate: "",
    address: "Adresse fictive",
    status: "Actif",
    hasAccess: "Oui",
    role: "Parent",
    teacherId: "",
    studentId: "",
    userId: account.id,
    userIdentifier: account.identifier,
  }));

  teachers.slice(0, 3).forEach((teacher, index) => {
    contacts.push({
      id: `CNT-${schoolCode}-TEACHER-${pad(index + 1, 2)}`,
      schoolCode,
      lastName: `Démo ${pad(index + 1)}`,
      firstName: "Enseignant",
      contactType: "Enseignant",
      phone: "",
      email: teacher.email,
      gender: "",
      birthDate: "",
      address: "Adresse fictive",
      status: "Actif",
      hasAccess: "Oui",
      role: "Enseignant",
      teacherId: teacher.id,
      studentId: "",
      userId: "",
      userIdentifier: teacher.identifier,
    });
  });

  const parentContacts = contacts.filter((row) => row.contactType === "Parent");
  const relations = students.map((student, index) => {
    const parent = parentContacts[index % parentContacts.length];
    return {
      id: `REL-${schoolCode}-${pad(index + 1)}`,
      schoolCode,
      relationType: "Parent → Élève",
      fromContactId: parent.id,
      fromContactName: `${parent.firstName} ${parent.lastName}`,
      toStudentId: student.id,
      toStudentName: student.name,
      isPrincipal: "Oui",
      status: "Actif",
    };
  });

  return { contacts, relations };
}

function buildPublicDemoPlatformSeed() {
  const base = buildBulkPlatformSeed();
  const country = base.countries.find((row) => row.code === PUBLIC_DEMO_COUNTRY);
  const sourceSchool = base.platformSchools.find((row) => row.loginCode === PUBLIC_DEMO_LOGIN_CODE);
  if (!country || !sourceSchool) {
    throw new Error("PUBLIC_DEMO_SOURCE_MISSING");
  }
  const sourceBundle = base.schoolBundles.find((row) => row.school.code === sourceSchool.code);
  if (!sourceBundle) throw new Error("PUBLIC_DEMO_BUNDLE_MISSING");

  const school = sanitizeSchool(sourceSchool);
  const classes = buildClasses(sourceBundle, school.code);
  const teachers = buildTeachers(sourceBundle, school.code);
  const students = buildStudents(sourceBundle, classes, school.code);
  const courses = buildCourses(classes, teachers, school.code);
  const assignments = buildAssignments(classes, teachers, school.code);

  assignments.forEach((assignment) => {
    const teacher = teachers.find((row) => row.id === assignment.teacherId);
    if (teacher) {
      teacher.assignments.push({ className: assignment.className, course: assignment.subject });
    }
  });
  classes.forEach((schoolClass, index) => {
    schoolClass.teacherId = teachers[index % teachers.length].publicId;
  });

  const bulletinBundle = buildSchoolBulletinBundle({
    schoolCode: school.code,
    students,
    courses,
    teachers,
    periods: ["Trimestre 1"],
    studentsPerClass: PUBLIC_DEMO_STUDENTS / PUBLIC_DEMO_CLASSES,
  });
  const staff = sanitizeStaffAccounts(base.userAccounts, school.code);
  const parentAccounts = staff.filter((row) => row.role === "Parent");
  const { contacts, relations } = buildContactsAndRelations(
    students,
    teachers,
    parentAccounts,
    school.code,
  );

  const bundle = {
    school,
    country: { ...sourceBundle.country, name: country.name },
    classes,
    courses,
    teachers,
    students,
    assignments,
    notes: bulletinBundle.notes,
    presences: buildPresences(students, school.code),
    payments: buildPayments(students, school.code),
    announcements: buildAnnouncements(school.code),
    exams: buildExams(classes, school.code),
    bulletins: bulletinBundle.bulletins,
    courseSchedules: [],
    documents: buildDocuments(students, school.code),
    messages: buildMessages(students, school.code),
    contacts,
    relations,
  };

  const flat = {
    classes,
    courses,
    teachers,
    students,
    assignments,
    notes: bundle.notes,
    presences: bundle.presences,
    payments: bundle.payments,
    announcements: bundle.announcements,
    exams: bundle.exams,
    bulletins: bundle.bulletins,
    courseSchedules: [],
    documents: bundle.documents,
    messages: bundle.messages,
    contacts,
    relations,
  };

  const subscription = base.subscriptions.find((row) => row.schoolCode === school.code);
  const academicConfigs = {};
  if (base.academicConfigs && typeof base.academicConfigs === "object") {
    for (const [key, value] of Object.entries(base.academicConfigs)) {
      if (key === school.code || key === school.loginCode || key === PUBLIC_DEMO_LOGIN_CODE) {
        academicConfigs[key] = value;
      }
    }
  }

  const usersByRole = staff.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});
  usersByRole.Enseignant = teachers.length;
  usersByRole["Élève / Étudiant"] = students.length;

  return {
    meta: {
      countries: 1,
      countryAdmins: 0,
      schools: 1,
      platformAdminsPerScope: 0,
      usersPerRole: 0,
      recordsPerFeature: 10,
      classesPerSchool: classes.length,
      studentsPerClass: PUBLIC_DEMO_STUDENTS / PUBLIC_DEMO_CLASSES,
      studentsPerSchool: students.length,
      teachersPerSchool: teachers.length,
      subjectsPerSchool: PUBLIC_DEMO_SUBJECTS.length,
      schoolUserRoles: [...new Set(staff.map((row) => row.role))],
      usersByRole,
      totalUserAccounts: staff.length + teachers.length + students.length,
      dataset: "public-demo-drc-v1",
    },
    countries: [{ ...country, phonePrefix: "+243", currency: "CDF" }],
    userAccounts: staff,
    platformSchools: [school],
    subscriptions: subscription ? [subscription] : [],
    schoolBundles: [bundle],
    platformNotifications: buildAnnouncements(school.code).slice(0, 5).map((row, index) => ({
      id: `NOTIF-DEMO-${pad(index + 1, 2)}`,
      audience: "Admin School",
      countryCode: PUBLIC_DEMO_COUNTRY,
      title: row.title,
      message: row.message,
      type: "Démonstration",
      priority: "Faible",
      channels: ["Web"],
      status: index % 2 === 0 ? "Lu" : "Non lu",
      date: row.date,
      createdBy: "Système Démo",
    })),
    academicConfigs,
    ...flat,
    rolePermissions,
  };
}

function verifyPublicDemoSeed(seed) {
  const problems = [];
  if (seed.countries?.length !== 1 || seed.countries?.[0]?.code !== PUBLIC_DEMO_COUNTRY) {
    problems.push("country");
  }
  if (seed.platformSchools?.length !== 1 || seed.platformSchools?.[0]?.loginCode !== PUBLIC_DEMO_LOGIN_CODE) {
    problems.push("school");
  }
  if (seed.classes?.length !== PUBLIC_DEMO_CLASSES) problems.push("classes");
  if (seed.students?.length !== PUBLIC_DEMO_STUDENTS) problems.push("students");
  if (seed.teachers?.length !== PUBLIC_DEMO_TEACHERS) problems.push("teachers");
  if (seed.userAccounts?.some((row) => ["Super Administrateur Somafrik", "Admin Pays"].includes(row.role))) {
    problems.push("privileged-users");
  }
  if (seed.students?.some((row) => row.parentPhone || !String(row.parentEmail || "").endsWith(".invalid"))) {
    problems.push("student-contact-pii");
  }
  if (seed.teachers?.some((row) => row.phone || !String(row.email || "").endsWith(".invalid"))) {
    problems.push("teacher-contact-pii");
  }
  if (seed.userAccounts?.some((row) => row.phone || !String(row.email || "").endsWith(".invalid"))) {
    problems.push("staff-contact-pii");
  }
  if (problems.length) {
    throw new Error(`PUBLIC_DEMO_SEED_INVALID:${problems.join(",")}`);
  }
  return {
    country: seed.countries[0].code,
    schools: seed.platformSchools.length,
    classes: seed.classes.length,
    students: seed.students.length,
    teachers: seed.teachers.length,
    users: seed.userAccounts.length,
    assignments: seed.assignments.length,
    notes: seed.notes.length,
    payments: seed.payments.length,
    relations: seed.relations.length,
  };
}

module.exports = {
  PUBLIC_DEMO_COUNTRY,
  PUBLIC_DEMO_LOGIN_CODE,
  PUBLIC_DEMO_CLASSES,
  PUBLIC_DEMO_STUDENTS,
  PUBLIC_DEMO_TEACHERS,
  PUBLIC_DEMO_SUBJECTS,
  buildPublicDemoPlatformSeed,
  verifyPublicDemoSeed,
};
