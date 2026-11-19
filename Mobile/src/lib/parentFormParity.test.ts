/**
 * npx tsx Mobile/src/lib/parentFormParity.test.ts — PARITE-WEB-MOBILE-RECOVERY-01 / LOT 3.
 * Formulaires Parent : mêmes libellés, mêmes champs, même validation sur Web et Mobile.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PARENT_FORM_COPY,
  buildParentLinkPayload,
  isPrincipalRelation,
  sortRelationsPrincipalFirst,
  validateParentLinkDraft,
} from "./parentFormCopy";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function copyBlock(source: string): string {
  const match = source.match(/export const PARENT_FORM_COPY = \{([\s\S]*?)\} as const;/);
  assert.ok(match, "PARENT_FORM_COPY introuvable");
  return match[1].split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("/**") && !line.startsWith("*")).join("\n");
}

// 1. Vocabulaire identique Web / Mobile (terminologie CTO #1192).
assert.equal(copyBlock(read("web/src/lib/parentFormCopy.ts")), copyBlock(read("Mobile/src/lib/parentFormCopy.ts")));
assert.equal(PARENT_FORM_COPY.sectionTitle, "Parents et responsables");
assert.equal(PARENT_FORM_COPY.linkAction, "Créer ou lier un parent");
assert.deepEqual(
  [PARENT_FORM_COPY.firstName, PARENT_FORM_COPY.lastName, PARENT_FORM_COPY.phone, PARENT_FORM_COPY.email],
  ["Prénom", "Nom", "Téléphone", "E-mail"],
);
assert.equal(PARENT_FORM_COPY.principalBadge, "Principal");

// 2. Validation locale : téléphone OU e-mail (même message que le Web).
assert.equal(validateParentLinkDraft({ phone: "", email: "" }), PARENT_FORM_COPY.missingContact);
assert.equal(validateParentLinkDraft({ phone: "  ", email: " " }), PARENT_FORM_COPY.missingContact);
assert.equal(validateParentLinkDraft({ phone: "", email: "parent@exemple.cd" }), null, "e-mail seul accepté");
assert.equal(validateParentLinkDraft({ phone: "+243820000001", email: "" }), null);

// 3. Charge utile POST /parents/link : e-mail transmis, noms vides omis (identique au Web).
assert.deepEqual(buildParentLinkPayload("S-1", { firstName: " Aline ", lastName: "", phone: "", email: " parent@exemple.cd " }), {
  studentId: "S-1",
  firstName: "Aline",
  phone: "",
  email: "parent@exemple.cd",
});

// 4. Responsable principal : même lecture que web/src/lib/studentParentRelations.ts.
assert.equal(isPrincipalRelation({ isPrincipal: true }), true);
assert.equal(isPrincipalRelation({ isPrincipal: "Oui" }), true);
assert.equal(isPrincipalRelation({ isPrincipal: false }), false);
assert.equal(isPrincipalRelation({}), false);
assert.deepEqual(sortRelationsPrincipalFirst([{ id: "a" }, { id: "b", isPrincipal: true }]).map((row) => row.id), ["b", "a"]);
assert.match(read("web/src/lib/studentParentRelations.ts"), /isPrincipal: row\.isPrincipal === true \|\| string\(row\.isPrincipal\)\.toLowerCase\(\) === "oui"/);

// 5. Les écrans utilisent le vocabulaire partagé, plus aucun libellé divergent.
const mobileFiche = read("Mobile/src/screens/StudentDetailScreen.tsx");
assert.match(mobileFiche, /title=\{PARENT_FORM_COPY\.sectionTitle\}/);
assert.match(mobileFiche, /label=\{PARENT_FORM_COPY\.email\}[^\n]*keyboardType="email-address"/);
assert.match(mobileFiche, /validateParentLinkDraft\(\{ phone, email \}\)/);
assert.match(mobileFiche, /buildParentLinkPayload\(/);
assert.match(mobileFiche, /isPrincipalRelation\(guardian\)/);
assert.doesNotMatch(mobileFiche, /Lier un responsable|Prénom du parent|Nom du parent/);

const mobileEnroll = read("Mobile/src/components/StudentMutationControls.tsx");
assert.match(mobileEnroll, /label=\{PARENT_FORM_COPY\.enrollmentEmail\}/);
assert.match(mobileEnroll, /parentEmail: email \|\| undefined/);
// Modification : l'e-mail n'est envoyé que s'il a changé (jamais d'effacement involontaire).
assert.match(mobileEnroll, /email !== trimField\(row\.parentEmail \?\? ""\) \? \{ parentEmail: email \} : \{\}/);

const webTab = read("web/src/components/students/StudentGuardiansTab.tsx");
assert.match(webTab, /title=\{PARENT_FORM_COPY\.sectionTitle\}/);
assert.match(webTab, /title=\{PARENT_FORM_COPY\.linkAction\}/);
assert.doesNotMatch(webTab, /Parents et tuteurs liés|"Lier un parent"|Créer ou lier le parent/);
const webEnroll = read("web/src/pages/etablissement/ClassStudentsPage.tsx");
assert.match(webEnroll, /label=\{PARENT_FORM_COPY\.enrollmentPhone\}/);
assert.match(webEnroll, /label=\{PARENT_FORM_COPY\.enrollmentEmail\}/);
assert.doesNotMatch(read("web/src/pages/EntityPage.tsx"), /"Lier un parent"/);

console.log("OK parentFormParity: vocabulaire, champs, validation, badge Principal identiques Web/Mobile");
