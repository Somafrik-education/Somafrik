import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readWeb(relative: string): string {
  return readFileSync(join(here, relative), "utf8");
}

function readRepo(relative: string): string {
  return readFileSync(join(here, "../../..", relative), "utf8");
}

describe("audit tuiles Vue d'ensemble + écrans détail (SAFE / BUG)", () => {
  it("Élèves : annuaire et vue d'ensemble observent le même snapshot DataContext + scopedStudents", () => {
    const list = readWeb("../pages/etablissement/StudentsListPage.tsx");
    const overview = readWeb("../pages/etablissement/EtablissementOverviewPage.tsx");
    expect(list).toContain("useData()");
    expect(list).toContain("scopedStudents(");
    expect(list).toContain('refresh(["students"])');
    expect(list).not.toMatch(/studentsApi\.list\(/);
    expect(overview).toContain("useData()");
    expect(overview).toContain("scopedStudents(");
    expect(overview).toContain("projectScopedStudents(");
  });

  it("Utilisateurs : SAFE — UsersPage + tuile utilisent DataContext / scopedUsers (schoolId)", () => {
    const users = readWeb("../pages/UsersPage.tsx");
    const overview = readWeb("../pages/etablissement/EtablissementOverviewPage.tsx");
    expect(users).toContain("useData()");
    expect(users).toContain("projectScopedUsers");
    expect(overview).toContain("scopedUsers(");
    expect(overview).toContain("metrics.activeUsers");
  });

  it("Classes : BUG latent — ClassesListPage fetch local distinct du DataContext/KPI", () => {
    const classes = readWeb("../pages/etablissement/ClassesListPage.tsx");
    const overview = readWeb("../pages/etablissement/EtablissementOverviewPage.tsx");
    expect(classes).toMatch(/classesApi\.list\(/);
    expect(classes).toMatch(/useState<SchoolClass\[\]>\(\[\]\)/);
    expect(classes).not.toContain("useData()");
    expect(overview).toContain("scopedClasses(");
  });

  it("Enseignants : BUG latent — TeachersListPage fetch local distinct du DataContext/KPI", () => {
    const teachers = readWeb("../pages/etablissement/TeachersListPage.tsx");
    const overview = readWeb("../pages/etablissement/EtablissementOverviewPage.tsx");
    expect(teachers).toMatch(/teachersApi\.list\(/);
    expect(teachers).toMatch(/useState<SchoolTeacher\[\]>\(\[\]\)/);
    expect(teachers).not.toContain("useData()");
    expect(overview).toContain("scopedTeachers(");
  });

  it("Parents & élèves : SAFE source DataContext — EntityPage / relations, pas un second fetch local", () => {
    const relations = readWeb("../pages/etablissement/ParentChildRelationsPage.tsx");
    const overview = readWeb("../pages/etablissement/EtablissementOverviewPage.tsx");
    expect(relations).toContain('entity="relations"');
    expect(overview).toContain("scopedRelations(");
  });

  it("scopedTeachers / scopedClasses / scopedRelations comparent encore schoolCode (dette leftover, hors scope)", () => {
    const establishment = readWeb("establishment.ts");
    expect(establishment).toMatch(/normalize\(teacher\.schoolCode\) === normalize\(schoolCode\)/);
    expect(establishment).toMatch(/normalize\(item\.schoolCode\) === normalize\(schoolCode\)/);
    expect(establishment).toMatch(/normalize\(row\.schoolCode\) === normalize\(schoolCode\)/);
    expect(establishment).toContain("projectScopedStudents");
  });
});

describe("audit Mobile — dashboard vs liste Élèves", () => {
  it("SAFE snapshot : HomeScreen et StudentsScreen consomment establishmentStudents du context", () => {
    const home = readRepo("Mobile/src/screens/HomeScreen.tsx");
    const list = readRepo("Mobile/src/screens/StudentsScreen.tsx");
    expect(home).toContain("useAdminData()");
    expect(home).toContain("establishmentStudents");
    expect(home).toContain("studentsSnapshot");
    expect(list).toContain("useAdminData()");
    expect(list).toContain("establishmentStudents");
    expect(list).toContain("studentsProjection");
    expect(list).not.toContain("scopedStudentsForSession");
    expect(list).not.toMatch(/studentsApi\.list\(/);
  });

  it("KPI Home et isolation établissement : schoolId, plus leftover schoolCode", () => {
    const home = readRepo("Mobile/src/screens/HomeScreen.tsx");
    const establishment = readRepo("Mobile/src/lib/establishment.ts");
    expect(home).toContain("metricLabelFromSnapshot(studentsSnapshot, () => String(visibleStudents.length))");
    expect(establishment).toContain("projectScopedStudentsForSession");
    expect(establishment).not.toMatch(/normalize\(student\.schoolCode\) === normalize\(schoolCode\)/);
  });
});
