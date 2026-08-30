import assert from "node:assert/strict";
import {
  filterHelpArticles,
  navigationIsAllowed,
  searchHelpArticles,
  suggestHelpArticles,
} from "@somafrik/help-catalog";
import { buildHelpContextFromSession } from "./helpAvailability";
import { helpMobileRoute } from "./helpNavigation";

function ids(articles: readonly { id: string }[]) {
  return articles.map((article) => article.id);
}

function school(permissions: string[], routeName: string) {
  return buildHelpContextFromSession(
    {
      role: "school_admin",
      permissions,
      user: { role: "Admin School" },
    },
    routeName,
  );
}

const teacher = buildHelpContextFromSession(
  {
    role: "teacher",
    permissions: [
      "Classes:READ",
      "Élèves:READ",
      "Présences:READ",
      "Notes:READ",
      "Notes:CREATE",
      "Notes:UPDATE",
      "Paramètres Établissement:READ",
      "Paramètres Établissement:UPDATE",
      "Utilisateurs:CREATE",
    ],
    user: { role: "Enseignant" },
  },
  "TeacherGrades",
);

{
  const teacherIds = ids(filterHelpArticles(teacher));
  assert.equal(teacherIds.some((id) => id.startsWith("help/settings/")), false, "enseignant → pas d’aide Admin établissement");
  assert.equal(teacherIds.includes("help/users/create"), false);
  const hits = searchHelpArticles(teacher, "créer utilisateur");
  assert.equal(hits.some((article) => article.id === "help/users/create"), false);
}

{
  const context = school(["Classes:READ"], "Classes");
  const list = ids(filterHelpArticles(context));
  assert.equal(list.includes("help/classes/list"), true);
  assert.equal(list.includes("help/classes/create"), false, "READ sans CREATE → aucune procédure CREATE");
}

{
  const context = school(["Paramètres Établissement:READ"], "EstablishmentProfile");
  const list = ids(filterHelpArticles(context));
  assert.equal(list.includes("help/settings/profile"), true, "profil READ = consulter");
  assert.equal(list.includes("help/settings/profile-edit"), false, "profil READ ≠ edit");
  const profile = filterHelpArticles(context).find((article) => article.id === "help/settings/profile");
  assert.match(profile?.title ?? "", /Consulter le profil/);
  assert.doesNotMatch(`${profile?.title}\n${profile?.steps.join("\n")}`, /Enregistrez/);
}

{
  const context = school(["Paramètres Établissement:READ", "Années Académiques:READ"], "SchoolYearSettings");
  const list = ids(filterHelpArticles(context));
  assert.equal(list.includes("help/settings/academic-year"), true);
  assert.equal(list.includes("help/settings/academic-year-create"), false, "année READ ≠ create");
  assert.equal(list.includes("help/settings/academic-year-current"), false);
  assert.equal(list.includes("help/settings/academic-periods-edit"), false);
  assert.equal(list.includes("help/settings/grading-configuration-edit"), false);
}

{
  const context = school(["Paramètres Établissement:READ"], "SchoolPedagogicalStructure");
  const list = ids(filterHelpArticles(context));
  assert.equal(list.includes("help/settings/pedagogical-structure"), true);
  assert.equal(list.includes("help/settings/pedagogical-structure-activate"), false, "structure READ ≠ activate");
  assert.equal(list.includes("help/settings/school-courses-create"), false);
}

{
  const context = school(["Paramètres Établissement:READ"], "SchoolAssignableRoles");
  const article = filterHelpArticles(context).find((item) => item.id === "help/settings/roles-permissions");
  assert.ok(article);
  const blob = `${article.title}\n${article.summary}\n${article.steps.join("\n")}`;
  assert.match(blob, /lecture seule/i);
  assert.match(blob, /Super administrateur/i);
  assert.match(blob, /Comptes utilisateurs → Attribuer/);
  assert.equal(article.permissions.includes("Paramètres Établissement:UPDATE"), false);
}

{
  const superadmin = buildHelpContextFromSession(
    {
      role: "super_admin",
      permissions: ["ALL_PRIVILEGES"],
      user: { role: "Super Administrateur Somafrik" },
    },
    "Home",
  );
  const list = ids(filterHelpArticles(superadmin));
  assert.equal(list.includes("help/classes/create"), false, "ALL_PRIVILEGES ne contourne pas l’allowlist de rôle");
  assert.equal(list.includes("help/users/create"), false);
  assert.equal(list.includes("help/settings/profile-edit"), false);
}

{
  const catalogIds = filterHelpArticles(teacher).map((article) => article.id);
  assert.equal(catalogIds.includes("help/grades/create-evaluation"), false);
  assert.equal(catalogIds.includes("help/grades/enter"), false);
  assert.equal(catalogIds.includes("help/grades/evaluations"), true);
  const searchHits = searchHelpArticles(teacher, "saisir les notes");
  assert.equal(searchHits.some((article) => article.id === "help/grades/enter"), false);
}

{
  const context = school(
    ["Classes:READ", "Classes:CREATE", "Paramètres Établissement:READ"],
    "Classes",
  );
  const suggestions = suggestHelpArticles(context);
  assert.ok(suggestions.length <= 3);
  const create = filterHelpArticles(context).find((article) => article.id === "help/classes/create");
  assert.ok(create);
  assert.equal(helpMobileRoute(create, context), "Classes");
  assert.equal(navigationIsAllowed(create, context), true);

  const readOnly = school(["Classes:READ"], "Classes");
  const createHidden = filterHelpArticles(readOnly).find((article) => article.id === "help/classes/create");
  assert.equal(createHidden, undefined);
}

{
  const fetchWasCalled = { value: false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchWasCalled.value = true;
    throw new Error("network should not be used");
  }) as typeof fetch;
  try {
    const context = school(["Classes:READ"], "Classes");
    searchHelpArticles(context, "classe");
    filterHelpArticles(context);
    suggestHelpArticles(context);
    assert.equal(fetchWasCalled.value, false, "catalogue embarqué : aucune requête réseau");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("helpRbac.test.ts OK");
