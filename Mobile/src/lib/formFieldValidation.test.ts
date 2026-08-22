import assert from "node:assert/strict";
import { formatFieldLabel } from "./formFieldTokens";
import {
  firstErrorKey,
  hasFieldErrors,
  resolvePreferredClassCode,
  trimField,
  validateAnnouncementDraft,
  validateDate,
  validateEmail,
  validatePaymentDraft,
  validatePhone,
  validateStudentEnrollmentDraft,
  validateTeacherIdentityDraft,
  validateUserIdentityDraft,
} from "./formFieldValidation";

assert.equal(formatFieldLabel("Prénom", { required: true }), "Prénom *");
assert.equal(formatFieldLabel("Nom", { required: true }), "Nom *");
assert.equal(
  formatFieldLabel("Téléphone du parent", { optional: true }),
  "Téléphone du parent — facultatif",
);
assert.equal(trimField("  Esther  "), "Esther");

assert.equal(validatePhone("", "Téléphone du parent"), "", "téléphone parent facultatif si vide");
assert.equal(validatePhone("   ", "Téléphone du parent"), "", "trim → vide = facultatif");
assert.match(validatePhone("12", "Téléphone du parent"), /numéro valide/);
assert.equal(validatePhone("+243 812 345 678", "Téléphone du parent"), "");
assert.equal(validatePhone("0812345678", "Téléphone du parent"), "");

const siblingA = validateStudentEnrollmentDraft({
  firstName: "Esther",
  lastName: "Okito",
  parentPhone: "+243 812 345 678",
  classCode: "CLS-6A",
  editing: false,
});
const siblingB = validateStudentEnrollmentDraft({
  firstName: "Joel",
  lastName: "Okito",
  parentPhone: "+243 812 345 678",
  classCode: "CLS-6A",
  editing: false,
});
assert.equal(hasFieldErrors(siblingA), false, "frère A : même n° parent accepté");
assert.equal(hasFieldErrors(siblingB), false, "frère B : pas d'unicité téléphone parent");

const missingName = validateStudentEnrollmentDraft({
  firstName: "  ",
  lastName: "Okito",
  parentPhone: "",
  classCode: "CLS-6A",
  editing: false,
});
assert.equal(missingName.firstName, "Prénom est obligatoire.");
assert.equal(missingName.lastName, undefined);
assert.equal(firstErrorKey(["firstName", "lastName", "parentPhone"], missingName), "firstName");

const missingLast = validateStudentEnrollmentDraft({
  firstName: "Esther",
  lastName: "",
  parentPhone: "",
  classCode: "CLS-6A",
  editing: false,
});
assert.equal(missingLast.lastName, "Nom est obligatoire.");
assert.equal(missingLast.firstName, undefined);

const badPhone = validateStudentEnrollmentDraft({
  firstName: "Esther",
  lastName: "Okito",
  parentPhone: "abc",
  classCode: "CLS-6A",
  editing: false,
});
assert.match(badPhone.parentPhone, /numéro valide/);

const noClass = validateStudentEnrollmentDraft({
  firstName: "Esther",
  lastName: "Okito",
  parentPhone: "",
  classCode: "",
  editing: false,
});
assert.equal(noClass.classCode, "Classe est obligatoire.");

const editNoClass = validateStudentEnrollmentDraft({
  firstName: "Esther",
  lastName: "Okito",
  parentPhone: "",
  classCode: "",
  editing: true,
});
assert.equal(editNoClass.classCode, undefined, "édition : classe non exigée");

const classes = [
  { id: "CLS-6A", label: "6e A" },
  { id: "CLS-5B", label: "5e B" },
];
assert.equal(resolvePreferredClassCode("6e A", classes), "CLS-6A");
assert.equal(resolvePreferredClassCode("Inconnue", classes), "", "pas de fallback 1re classe");
assert.equal(resolvePreferredClassCode("", classes), "", "pas de préselection sans contexte");
assert.equal(resolvePreferredClassCode(undefined, classes), "");

assert.equal(validateEmail("", "Email"), "");
assert.match(validateEmail("pas-un-email", "Email"), /email valide/);
assert.equal(validateEmail("enseignant@ecole.cd", "Email"), "");
assert.equal(validateDate("1990-05-01", "Naissance"), "");
assert.match(validateDate("1990-02-30", "Naissance"), /AAAA-MM-JJ/);
assert.equal(validateDate("01-05-1990", "Naissance"), "");

const teacherInvalid = validateTeacherIdentityDraft({
  firstName: "Amina",
  lastName: "Kabila",
  phone: "99",
  email: "x",
  birthDate: "2020-13-40",
  temporaryPassword: "",
  editing: false,
});
assert.equal(hasFieldErrors(teacherInvalid), true);
assert.match(teacherInvalid.phone, /numéro valide/);
assert.match(teacherInvalid.email, /email valide/);
assert.match(teacherInvalid.birthDate, /AAAA-MM-JJ/);
assert.equal(teacherInvalid.temporaryPassword, "Mot de passe temporaire est obligatoire.");

const teacherOk = validateTeacherIdentityDraft({
  firstName: " Amina ",
  lastName: " Kabila ",
  phone: "+243 899 111 222",
  email: "amina@ecole.cd",
  birthDate: "1990-05-01",
  temporaryPassword: "Temp#1",
  editing: false,
});
assert.equal(hasFieldErrors(teacherOk), false);

const userInvalid = validateUserIdentityDraft({
  firstName: "",
  lastName: "Mbala",
  email: "x",
  phone: "1",
  temporaryPassword: "   ",
  editing: false,
});
assert.equal(userInvalid.firstName, "Prénom est obligatoire.");
assert.match(userInvalid.email, /email valide/);
assert.match(userInvalid.phone, /numéro valide/);
assert.equal(userInvalid.temporaryPassword, "Mot de passe temporaire est obligatoire.");

const payment = validatePaymentDraft({ studentId: "", amount: "0" });
assert.equal(payment.studentId, "Élève est obligatoire.");
assert.match(payment.amount, /montant positif/);
assert.equal(payment.classId, undefined, "pas de classe tant que l'élève n'est pas choisi");

const noEnrollment = validatePaymentDraft({ studentId: "st-1", amount: "25000", classId: "", classOptions: [] });
assert.equal(noEnrollment.classId, "Cet élève n'a aucune inscription active.");

const missingClass = validatePaymentDraft({
  studentId: "st-1",
  amount: "25000",
  classId: "",
  classOptions: [{ classId: "class-6a" }],
});
assert.equal(missingClass.classId, "Classe est obligatoire.");

const foreignClass = validatePaymentDraft({
  studentId: "st-1",
  amount: "25000",
  classId: "class-other",
  classOptions: [{ classId: "class-6a" }],
});
assert.equal(foreignClass.classId, "Classe invalide pour cet élève.");

assert.equal(
  hasFieldErrors(
    validatePaymentDraft({
      studentId: "st-1",
      amount: "25000",
      classId: "class-6a",
      classOptions: [{ classId: "class-6a" }],
    }),
  ),
  false,
);

const announcement = validateAnnouncementDraft({ title: "  ", message: "Hello" });
assert.equal(announcement.title, "Titre est obligatoire.");
assert.equal(announcement.message, undefined);

console.log("OK formFieldValidation: labels, trim, erreurs par champ, pas de fallback classe, pas d'unicité téléphone parent");
