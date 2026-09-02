import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, acc);
    } else if (/\.(tsx|ts)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe("required mark contract", () => {
  it("does not bake a non-red asterisk into Field labels", () => {
    const files = walk(WEB_SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (/label=(?:\{\s*)?["'][^"'*\n]+\s\*["']/.test(source)) {
        offenders.push(path.relative(WEB_SRC, file));
      }
    }
    assert.deepEqual(offenders, [], `libellés avec * collé au texte :\n${offenders.join("\n")}`);
  });

  it("shared Field and FormField use RequiredMark", () => {
    const field = fs.readFileSync(path.join(WEB_SRC, "components/ui/Field.tsx"), "utf8");
    const formField = fs.readFileSync(path.join(WEB_SRC, "design-system/forms/FormField.tsx"), "utf8");
    const formLabel = fs.readFileSync(path.join(WEB_SRC, "components/ui/shadcn/form.tsx"), "utf8");
    assert.match(field, /RequiredMark/);
    assert.match(formField, /RequiredMark/);
    assert.match(formLabel, /required \? <RequiredMark \/>/);
    assert.doesNotMatch(field, /required \? <span className="text-danger"> \*<\/span>/);
  });

  it("critical create/edit forms pass required to shared labels", () => {
    const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), "utf8");
    const users = read("pages/UsersPage.tsx");
    const teachers = read("pages/etablissement/TeachersListPage.tsx");
    const classes = read("pages/etablissement/ClassesListPage.tsx");
    const students = read("pages/etablissement/ClassStudentsPage.tsx");
    const login = read("pages/LoginPage.tsx");
    const education = read("pages/EducationReferencePage.tsx");
    const payments = read("pages/abonnements/SubscriptionPaymentsPage.tsx");
    const evalTypes = read("components/EvaluationTypesPanel.tsx");

    assert.match(users, /label="Prénom" required/);
    assert.match(users, /label="Nom" required/);
    assert.match(teachers, /label="Prénom"[^>]*required/);
    assert.match(teachers, /label="Nom"[^>]*required/);
    assert.match(classes, /htmlFor="class-year" required/);
    assert.match(students, /htmlFor="enroll-first-name" required/);
    assert.match(login, /<FormLabel required>Identifiant<\/FormLabel>/);
    assert.match(login, /<FormLabel required>Mot de passe<\/FormLabel>/);
    assert.match(education, /label="Nom" htmlFor="edu-level-name" required/);
    assert.match(education, /label="Code" htmlFor="edu-level-code" required/);
    assert.match(education, /label="Libellé niveau"[^>]*required/);
    assert.match(payments, /label="Établissement" required/);
    assert.match(payments, /label="Montant" required/);
    assert.match(evalTypes, /label="Nouveau type"[^>]*required/);
  });
});
