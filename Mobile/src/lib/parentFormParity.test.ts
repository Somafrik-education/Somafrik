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

// 1. Vocabulaire identique Web / Mobile.
assert.equal(copyBlock(read("web/src/lib/parentFormCopy.ts")), copyBlock(read("Mobile/src/lib/parentFormCopy.ts")));
assert.equal(PARENT_FORM_COPY.sectionTitle, "Responsables");
assert.equal(PARENT_FORM_COPY.linkAction, "Lier un responsable");
assert.deepEqual(
  [PARENT_FORM_COPY.firstName, PARENT_FORM_COPY.lastName, PARENT_FORM_COPY.phone, PARENT_FORM_COPY.email],
  ["Prénom", "Nom", "Téléphone", "E-mail"],
);
assert.equal(PARENT_FORM_COPY.principalBadge, "Principal");
// Décision CTO définitive PARITÉ-SAFE-02 : libellés explicites du formulaire de liaison.
assert.deepEqual(
  [PARENT_FORM_COPY.linkFirstName, PARENT_FORM_COPY.linkLastName, PARENT_FORM_COPY.linkPhone, PARENT_FORM_COPY.linkEmail],
  ["Prénom du parent", "Nom du parent", "Téléphone du parent", "E-mail du parent"],
);

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
// PARITÉ-SAFE-02 (finale) : bouton « Lier un responsable » restauré (texte + accessibilityLabel).
assert.match(mobileFiche, /accessibilityLabel=\{PARENT_FORM_COPY\.linkAction\}/);
assert.match(mobileFiche, /<Text style=\{styles\.createText\}>\{PARENT_FORM_COPY\.linkAction\}<\/Text>/);
assert.doesNotMatch(mobileFiche, /Créer ou lier un parent|Parents et responsables/);
assert.match(mobileFiche, /label=\{PARENT_FORM_COPY\.linkEmail\}[^\n]*keyboardType="email-address"/);
assert.match(mobileFiche, /validateParentLinkDraft\(\{ phone, email \}\)/);
assert.match(mobileFiche, /buildParentLinkPayload\(/);
assert.match(mobileFiche, /isPrincipalRelation\(guardian\)/);
// PARITÉ-SAFE-02 — non-régression : les trois champs de liaison restent présents, étiquetés
// explicitement (label visible + accessibilityLabel) et reliés à leur état ; l'e-mail reste additif.
for (const [key, state, setter] of [
  ["linkFirstName", "firstName", "setFirstName"],
  ["linkLastName", "lastName", "setLastName"],
  ["linkPhone", "phone", "setPhone"],
  ["linkEmail", "email", "setEmail"],
] as const) {
  const field = mobileFiche.split("\n").find((line) => line.includes(`label={PARENT_FORM_COPY.${key}}`));
  assert.ok(field, `champ de liaison ${key} absent de la fiche Élève Mobile`);
  assert.match(field, /<FormField /);
  assert.ok(field.includes(`accessibilityLabel={PARENT_FORM_COPY.${key}}`), `${key} : accessibilityLabel explicite manquant`);
  assert.ok(field.includes(`value={${state}}`), `${key} : champ non relié à l'état ${state}`);
  assert.ok(field.includes(setter), `${key} : saisie non enregistrée (${setter})`);
  assert.doesNotMatch(field, /hideVisibleLabel/, `${key} : libellé non visible`);
}
// Le formulaire reste rendu pour les rôles autorisés (canLinkParentMobile), dans la carte Responsables.
assert.match(mobileFiche, /const canLink = canLinkParentMobile\(session\);/);
assert.match(mobileFiche, /\{canLink \? \(\s*<View>\s*<Text style=\{styles\.fieldLabel\}>\{PARENT_FORM_COPY\.linkAction\}/);

const mobileEnroll = read("Mobile/src/components/StudentMutationControls.tsx");
assert.match(mobileEnroll, /label=\{PARENT_FORM_COPY\.enrollmentEmail\}/);
assert.match(mobileEnroll, /parentEmail: email \|\| undefined/);
// Modification : l'e-mail n'est envoyé que s'il a changé (jamais d'effacement involontaire).
assert.match(mobileEnroll, /email !== trimField\(row\.parentEmail \?\? ""\) \? \{ parentEmail: email \} : \{\}/);

const webTab = read("web/src/components/students/StudentGuardiansTab.tsx");
assert.match(webTab, /title=\{PARENT_FORM_COPY\.sectionTitle\}/);
assert.match(webTab, /title=\{PARENT_FORM_COPY\.linkAction\}/);
assert.doesNotMatch(webTab, /Parents et tuteurs liés|"Lier un parent"|Créer ou lier le parent|Créer ou lier un parent/);
for (const key of ["linkFirstName", "linkLastName", "linkPhone", "linkEmail"]) {
  assert.ok(webTab.includes(`{PARENT_FORM_COPY.${key}}`), `Web : libellé ${key} absent du formulaire de liaison`);
}
const webEnroll = read("web/src/pages/etablissement/ClassStudentsPage.tsx");
assert.match(webEnroll, /label=\{PARENT_FORM_COPY\.enrollmentPhone\}/);
assert.match(webEnroll, /label=\{PARENT_FORM_COPY\.enrollmentEmail\}/);
assert.doesNotMatch(read("web/src/pages/EntityPage.tsx"), /"Lier un parent"/);

console.log("OK parentFormParity: vocabulaire, champs, validation, badge Principal identiques Web/Mobile");
