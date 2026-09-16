import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("DEMO-DATA — ClassesListPage progressive", () => {
  const source = readFileSync(resolve(__dirname, "./ClassesListPage.tsx"), "utf8");

  it("rend la liste des classes critique avant les référentiels secondaires en Démo", () => {
    expect(source).toMatch(/demoRuntimeEnabled/);
    expect(source).toMatch(/if \(demoRuntimeEnabled\)[\s\S]*?const classes = await classesApi\.list\(\);/);
    expect(source).toMatch(/setRows\(Array\.isArray\(classes\) \? classes : \[\]\);/);
    expect(source).toMatch(/void academicYearsApi[\s\S]*?\.list\(\)/);
    expect(source).toMatch(/void educationReferenceApi[\s\S]*?\.getSchoolCatalog\(\)/);
  });

  it("conserve le chargement atomique historique hors Démo", () => {
    expect(source).toMatch(/const \[classes, academicYears, schoolCatalog\] = await Promise\.all/);
  });
});
