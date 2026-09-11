/**
 * UX Scolarité Mobile — cartes synthétiques fermées par défaut (pattern Finance).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextExclusiveExpandedKey } from "./expandableEntity";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const entityCard = read("components/ExpandableEntityCard.tsx");
const financeCard = read("components/ExpandableFinanceCard.tsx");
const receiptCard = read("components/PaymentReceiptCard.tsx");
const unpaidScreen = read("screens/UnpaidScreen.tsx");
const classesScreen = read("screens/ClassesScreen.tsx");
const studentsScreen = read("screens/StudentsScreen.tsx");
const hubScreen = read("screens/SchoolingHubScreen.tsx");
const yearScreen = read("screens/SchoolYearSettingsScreen.tsx");
const classMutation = read("components/ClassMutationControls.tsx");
const studentMutation = read("components/StudentMutationControls.tsx");
const structureScreen = read("screens/SchoolPedagogicalStructureScreen.tsx");
const studentDetail = read("screens/StudentDetailScreen.tsx");

assert.equal(nextExclusiveExpandedKey(null, "a"), "a", "fermé par défaut : premier tap ouvre");
assert.equal(nextExclusiveExpandedKey("a", "a"), null, "second tap referme");
assert.equal(nextExclusiveExpandedKey("a", "b"), "b", "listes longues : une seule carte ouverte");

assert.match(entityCard, /defaultExpanded = false/);
assert.match(entityCard, /accessibilityState=\{\{ expanded: isExpanded \}\}/);
assert.match(entityCard, /minHeight:\s*Math\.max\(68,\s*MIN_TOUCH_TARGET_DP\)/);
assert.match(entityCard, /chevron-up/);
assert.match(entityCard, /chevron-down/);
assert.match(entityCard, /isExpanded \? <View style=\{styles\.detail\}>\{children\}<\/View> : null/);
assert.match(entityCard, /MIN_TOUCH_TARGET_DP/);
assert.doesNotMatch(entityCard, /navigate\(/);

assert.match(financeCard, /ExpandableEntityCard/);
assert.match(receiptCard, /ExpandableFinanceCard/);
assert.match(unpaidScreen, /ExpandableFinanceCard/);
assert.doesNotMatch(receiptCard, /ExpandableEntityCard/);

assert.match(classesScreen, /ExpandableEntityCard/);
assert.match(classesScreen, /expandedClassKey/);
assert.match(classesScreen, /CLASS_CARD_TEST_ID\(item\.name\)/);
assert.match(classesScreen, /SCOLARITE_COPY\.openClassStudents/);
assert.match(read("lib/schoolingTruth.ts"), /openClassStudents: "Voir les élèves"/);
assert.match(classesScreen, /CLASS_OPEN_STUDENTS_TEST_ID/);
assert.match(classesScreen, /<ClassMutationControls[\s\S]*row=\{item\}/);
assert.match(classesScreen, /Professeur principal/);
assert.match(classesScreen, /Code :/);
assert.doesNotMatch(
  classesScreen,
  /testID=\{CLASS_CARD_TEST_ID\(item\.name\)\}[\s\S]{0,400}navigate\("Students"/,
  "le tap de la carte Classe ne doit plus naviguer directement",
);

const classCardStart = classesScreen.indexOf("renderItem={({ item })");
const classCardBody = classesScreen.slice(classCardStart);
const mutationInCard = classCardBody.indexOf("<ClassMutationControls");
const entityOpen = classCardBody.indexOf("<ExpandableEntityCard");
const entityClose = classCardBody.indexOf("</ExpandableEntityCard>");
assert.ok(entityOpen >= 0 && entityClose > entityOpen, "carte Classe = ExpandableEntityCard");
assert.ok(
  mutationInCard > entityOpen && mutationInCard < entityClose,
  "ClassMutationControls ligne est dans la zone dépliée, pas dans le résumé",
);

assert.match(studentsScreen, /ExpandableEntityCard/);
assert.match(studentsScreen, /expandedStudentId/);
assert.match(studentsScreen, /STUDENT_ROW_TEST_ID\(student\.id\)/);
assert.match(studentsScreen, /SCOLARITE_COPY\.openStudentFiche/);
assert.match(read("lib/schoolingTruth.ts"), /openStudentFiche: "Ouvrir la fiche"/);
assert.match(studentsScreen, /STUDENT_OPEN_FICHE_TEST_ID/);
assert.match(studentsScreen, /student\.matricule/);
assert.match(studentsScreen, /StudentMutationControls/);
assert.doesNotMatch(
  studentsScreen,
  /testID=\{STUDENT_ROW_TEST_ID\(student\.id\)\}[\s\S]{0,280}openStudentDetail\(student\.id\)/,
  "le tap de la carte Élève ne doit plus ouvrir la fiche directement",
);

const studentRowFn = studentsScreen.slice(studentsScreen.indexOf("renderStudentRow"));
const studentEntityOpen = studentRowFn.indexOf("<ExpandableEntityCard");
const studentEntityClose = studentRowFn.indexOf("</ExpandableEntityCard>");
const studentMutationAt = studentRowFn.indexOf("<StudentMutationControls");
assert.ok(studentEntityOpen >= 0 && studentEntityClose > studentEntityOpen);
assert.ok(
  studentMutationAt > studentEntityOpen && studentMutationAt < studentEntityClose,
  "StudentMutationControls ligne est dans la zone dépliée",
);
assert.match(studentRowFn, /openStudentDetail\(student\.id\)/);

assert.match(hubScreen, /ExpandableEntityCard/);
assert.match(hubScreen, /schooling-kpi-students/);
assert.match(hubScreen, /schooling-kpi-classes/);
assert.match(hubScreen, /SCOLARITE_COPY\.openHubAction/);

assert.match(yearScreen, /ExpandableEntityCard/);
assert.match(yearScreen, /Définir comme courante/);
assert.doesNotMatch(
  yearScreen,
  /ExpandableEntityCard[\s\S]{0,200}Créer l’année/,
  "le formulaire de création d'année n'est pas un accordéon artificiel",
);

assert.doesNotMatch(structureScreen, /ExpandableEntityCard/, "structure pédagogique = formulaires, pas une liste d'entités");
assert.doesNotMatch(studentDetail, /ExpandableEntityCard/, "fiche élève = destination, pas une liste à replier");

assert.match(classMutation, /resolveEntityCrudAccess\(session, "classes"\)/);
assert.match(studentMutation, /resolveEntityCrudAccess\(session, "students"\)/);
assert.match(classesScreen, /canReadRoute\(session, session\?\.role === "teacher" \? "TeacherStudents" : "Students"\)/);
assert.match(studentsScreen, /canReadRoute\(session, "StudentDetail"\)/);

console.log("OK UX Scolarité expand/collapse : Classes, Élèves, hub, année — Finance inchangé");
