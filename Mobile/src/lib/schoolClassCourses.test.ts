import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeClassNames,
  activeCoursesForClass,
  assignableSubjectsForClass,
} from "./schoolClassCourses";

function readRepoFile(relative: string): string {
  const candidates = [join(process.cwd(), relative), join(process.cwd(), "..", relative)];
  const path = candidates.find((candidate) => existsSync(candidate));
  assert.ok(path, `${relative} introuvable`);
  return readFileSync(path, "utf8");
}

function run() {
  const classes = [
    { name: "2ème A", status: "active" },
    { name: "1ère B", status: "active" },
    { name: "Ancienne", status: "archived" },
  ];
  assert.deepEqual(activeClassNames(classes), ["1ère B", "2ème A"]);

  const courses = [
    { id: "c1", className: "2ème A", name: "Mathématiques", status: "active" },
    { id: "c2", className: "2ème A", name: "Histoire", status: "archived" },
    { id: "c3", className: "1ère B", name: "Mathématiques", status: "active" },
  ];
  assert.deepEqual(
    activeCoursesForClass(courses, "2EME A").map((row) => row.id),
    ["c1"],
    "une autre classe et les cours archivés ne doivent pas contaminer le scope",
  );

  const subjects = [
    { code: "MATH", name: "Mathématiques", status: "active" },
    { code: "FR", name: "Français", status: "active" },
    { code: "HIST", name: "Histoire", status: "archived" },
  ];
  assert.deepEqual(
    assignableSubjectsForClass(subjects, courses, "2ème A").map((row) => row.code),
    ["FR"],
    "un cours déjà rattaché et un cours archivé ne doivent pas être proposés",
  );
  assert.deepEqual(
    assignableSubjectsForClass(subjects, courses, "1ère B").map((row) => row.code),
    ["FR"],
    "le rattachement reste propre à chaque classe",
  );

  const screen = readRepoFile("Mobile/src/screens/SchoolPedagogicalStructureScreen.tsx");
  const api = readRepoFile("Mobile/src/services/schoolSettingsApi.ts");

  assert.match(screen, /Cours des classes/);
  assert.match(screen, /hasSecurityPermission\(session, "Matières", "CREATE"\)/);
  assert.match(screen, /getEffectivePermissionsForSession\(session\)/);
  assert.match(screen, /effectivePermissions\.includes\("Gérer cours"\)/);
  assert.match(screen, /effectivePermissions\.includes\("Voir classes"\)/);
  assert.doesNotMatch(
    screen,
    /hasSecurityPermission\(session, "Classes", "READ"\)/,
    "Classes:READ seul n'ouvre pas GET /api/courses côté backend",
  );
  assert.match(screen, /createSchoolClassCourse/);
  assert.match(screen, /createSchoolSubject/);
  assert.match(screen, /school-class-course-add/);
  assert.doesNotMatch(screen, /createItem\([^\n]*courses/);
  assert.doesNotMatch(screen, /DEFAULT_SUBJECTS/);

  assert.match(api, /httpRequest<unknown>\("\/v2\/subjects"\)/);
  assert.match(api, /httpRequest<unknown>\("\/courses"\)/);
  assert.match(api, /httpRequest<SchoolClassCourseRecord>\("\/courses"/);
  assert.doesNotMatch(api, /backoffice\/state/);

  console.log("schoolClassCourses.test.ts OK");
}

run();
