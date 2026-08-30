"use strict";

const assert = require("node:assert/strict");
const {
  classifySchoolDuplicates,
  findPotentialDuplicates,
  generateSchoolCode,
  withActiveStudentCounts,
  DUPLICATE_STRONG,
  DUPLICATE_CONTACT,
  CROSS_COUNTRY_CONTACT_MATCH,
} = require("./schoolModule");

const kanyosha = {
  id: "school-bi",
  code: "SCH-BI-KANYOSHA",
  loginCode: "BI-EK-26-001",
  publicId: "BI-EK-26-001",
  name: "Ecole Kanyosha",
  city: "Muha",
  country: "Burundi",
  countryCode: "BI",
  email: "contact@somafrik.app",
  phone: "9090909",
};

const baraka = {
  name: "Institut Baraka",
  city: "Bukavu",
  country: "RDC",
  countryCode: "CD",
  email: "contact@somafrik.app",
  phone: "9090909",
};

const bukavu = {
  code: "CD-2026-0002",
  name: "Institut Baraka",
  city: "Bukavu",
  country: "République Démocratique du Congo",
  countryCode: "CD",
  email: "baraka@school.cd",
  phone: "+243 990 111 222",
};

const classified = classifySchoolDuplicates(baraka, [kanyosha]);
assert.equal(classified.length, 0, "un contact générique cross-country n'est pas un doublon");
assert.equal(findPotentialDuplicates(baraka, [kanyosha]).length, 0);

const uniqueContactCross = classifySchoolDuplicates(
  { ...baraka, email: "unique@school.cd", phone: "+243990111222" },
  [{ ...kanyosha, email: "unique@school.cd", phone: "+243990111222" }],
);
assert.equal(uniqueContactCross[0]?.level, CROSS_COUNTRY_CONTACT_MATCH);
assert.equal(findPotentialDuplicates({ ...baraka, email: "unique@school.cd" }, [{ ...kanyosha, email: "unique@school.cd" }]).length, 0);

const strong = findPotentialDuplicates(baraka, [bukavu]);
assert.equal(strong.length, 1);
assert.equal(strong[0].level, DUPLICATE_STRONG);
assert.ok(strong[0].reasons.includes("Même nom et ville dans ce pays"));

const sameCountryContact = findPotentialDuplicates(
  { ...baraka, name: "Autre Institut", city: "Goma", email: "unique@school.cd", phone: "+243990000111" },
  [{ ...bukavu, email: "unique@school.cd", phone: "+243990000111" }],
);
assert.equal(sameCountryContact[0]?.level, DUPLICATE_CONTACT);

assert.equal(
  generateSchoolCode("CD", [{ code: "CD-2026-0001" }]),
  "",
  "generateSchoolCode n'alloue plus CD-YYYY-NNNN — PostgreSQL seul produit login_code V2",
);

const nuru = {
  id: "school-cd-nuru",
  code: "SCH-CD-NURU",
  loginCode: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  name: "Institut Nuru",
};
const counted = withActiveStudentCounts(
  [nuru, kanyosha],
  [
    { id: "stu-1", schoolId: "school-cd-nuru", status: "active" },
    { id: "stu-2", schoolCode: "SCH-CD-NURU", status: "Actif" },
    { id: "stu-3", schoolCode: "CD-IN-26-001", status: "active" },
    { id: "stu-4", schoolCode: "CD-IN-26-001", archived: true },
    { id: "stu-5", schoolCode: "BI-EK-26-001", status: "active" },
    { id: "stu-6", schoolId: "school-bi", status: "deleted" },
    { id: "stu-7", schoolId: "school-cd-nuru", status: "archived" },
  ],
);
assert.equal(counted[0].studentCount, 2, "NURU compte les élèves actifs via UUID et login_code uniquement");
assert.equal(counted[1].studentCount, 1, "Kanyosha exclut les élèves supprimés");
assert.equal(nuru.studentCount, undefined, "l'agrégation ne mute pas la source établissement");

console.log("schoolModule.test.js OK");
