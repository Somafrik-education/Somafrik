/**
 * LOT 4 RED — Issue #695 — complétude optionnelle du school setup.
 *
 * Contrats L4-01 → L4-09. Réutilise LOT 0 (`deriveSchoolSetupStatus`)
 * et LOT 1/2 (widget / auto-open / progression). Aucun runtime LOT 4.
 *
 * Les invariants READY déjà satisfaits peuvent être verts.
 * La section « Complétude recommandée » absente doit rester rouge.
 * Ne pas inverser d'assertion pour forcer du rouge.
 *
 *   npx --yes tsx scripts/verify-school-setup-lot4-red.ts
 *   npm run verify:school-setup-lot4-red
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendStatusPath = path.join(repoRoot, "backend/lib/schoolSetupStatus.js");
const webApiPath = path.join(repoRoot, "web/src/lib/schoolSetupStatusApi.ts");
const mobileApiPath = path.join(repoRoot, "Mobile/src/lib/schoolSetupStatusApi.ts");
const webContractPath = path.join(repoRoot, "web/src/lib/schoolSetupWeb.ts");
const mobileContractPath = path.join(repoRoot, "Mobile/src/lib/schoolSetupMobile.ts");
const webSettingsPagePath = path.join(repoRoot, "web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
const mobileSettingsPath = path.join(repoRoot, "Mobile/src/screens/SchoolSetupSettingsScreen.tsx");
const webSettingsHubPath = path.join(repoRoot, "web/src/pages/parametres/SettingsHubPage.tsx");
const mobileConfigPath = path.join(repoRoot, "Mobile/src/screens/ConfigurationScreen.tsx");

const OPTIONAL_LOT4 = ["periods", "teachers", "students", "feeGrids", "notifications"] as const;
const OPTIONAL_PAYLOAD_KEYS = [
  "periods",
  "subjects",
  "teachers",
  "students",
  "feeGrids",
  "notifications",
] as const;
const SECTION_HEADING = /Complétude recommandée|Pour aller plus loin/;
const CORE_TOTAL = 3;

type SetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "READY";
interface SchoolSetupPayload {
  status: SetupStatus;
  core: { academicYear: boolean; structure: boolean; classes: boolean };
  optional?: Record<string, boolean>;
  progress: { coreDone: number; coreTotal: number };
}

function read(abs: string) {
  return fs.readFileSync(abs, "utf8");
}

function exists(abs: string) {
  return fs.existsSync(abs);
}

function assertHas(source: string, needle: string | RegExp, message: string) {
  const ok = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(ok, message);
}

function assertLacks(source: string, needle: string | RegExp, message: string) {
  const found = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(!found, message);
}

function walkSchoolSetupFiles(dir: string, acc: string[] = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSchoolSetupFiles(full, acc);
      continue;
    }
    if (/schoolSetup/i.test(entry.name) && !/\.test\./.test(entry.name) && !/lot4/i.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function schoolSetupModuleSources() {
  return ["backend", path.join("web", "src"), path.join("Mobile", "src")]
    .flatMap((rel) => walkSchoolSetupFiles(path.join(repoRoot, rel)))
    .map((file) => ({ file, source: read(file) }));
}

function readyAllOptionalFalse(): SchoolSetupPayload {
  return {
    status: "READY",
    core: { academicYear: true, structure: true, classes: true },
    optional: {
      periods: false,
      teachers: false,
      students: false,
      feeGrids: false,
      notifications: false,
    },
    progress: { coreDone: 3, coreTotal: CORE_TOTAL },
  };
}

function mixedOptional(): SchoolSetupPayload {
  return {
    status: "READY",
    core: { academicYear: true, structure: true, classes: true },
    optional: {
      periods: true,
      teachers: false,
      students: true,
      feeGrids: false,
      notifications: false,
    },
    progress: { coreDone: 3, coreTotal: CORE_TOTAL },
  };
}

async function loadWebContract() {
  assert.ok(exists(webContractPath), "web/src/lib/schoolSetupWeb.ts manquant");
  return import(pathToFileURL(webContractPath).href);
}

async function loadMobileContract() {
  assert.ok(exists(mobileContractPath), "Mobile/src/lib/schoolSetupMobile.ts manquant");
  return import(pathToFileURL(mobileContractPath).href);
}

function loadBackendContract() {
  assert.ok(exists(backendStatusPath), "backend/lib/schoolSetupStatus.js manquant");
  return require(backendStatusPath) as {
    deriveSchoolSetupStatus: (raw?: Record<string, unknown>) => SchoolSetupPayload;
  };
}

function assertNamedOptionalType(source: string, client: string) {
  for (const key of OPTIONAL_PAYLOAD_KEYS) {
    assertHas(
      source,
      new RegExp(`${key}\\s*\\??\\s*:\\s*boolean`),
      `${client}: le type optional n'expose pas ${key} (L4-01${key === "subjects" ? ", conserver subjects du contrat backend" : ""})`,
    );
  }
  assertLacks(
    source,
    /optional\?\s*:\s*Record<\s*string\s*,\s*boolean\s*>/,
    `${client}: optional ne doit pas rester un Record<string, boolean> anonyme — nommer periods/subjects/teachers/students/feeGrids/notifications`,
  );
}

function completenessClientSources(pagePath: string, extraDir: string) {
  const parts = [read(pagePath)];
  if (exists(extraDir)) {
    for (const file of walkSchoolSetupFiles(extraDir)) {
      if (/optional|complet|recommend/i.test(path.basename(file))) {
        parts.push(read(file));
      }
    }
  }
  return parts.join("\n");
}

function assertCompletenessSection(source: string, client: string) {
  assertHas(
    source,
    SECTION_HEADING,
    `${client}: section Complétude recommandée / Pour aller plus loin absente`,
  );
  assertHas(source, "payload.optional", `${client}: la section ne lit pas payload.optional`);
  for (const key of OPTIONAL_LOT4) {
    assertHas(source, key, `${client}: élément optionnel ${key} absent de l'écran permanent`);
  }
  assertHas(source, "Configuré", `${client}: état Configuré absent`);
  assertHas(source, "À compléter", `${client}: état À compléter absent`);
}

function isLot4ForbiddenPath(file: string) {
  if (file === "backend/lib/schoolSetupStatus.js") return true;
  if (file.startsWith("backend/")) return true;
  if (file.startsWith("apps/")) return true;
  if (/(^|\/)migrations?\//.test(file) || /\.sql$/.test(file)) return true;
  if (/permissions\.ts$|rbac/i.test(file)) return true;
  return false;
}

function isLot4AllowedFile(file: string) {
  // L4-09 must stay green in RED (tests only) and after a conforming GREEN.
  // Allow planned school-setup Web/Mobile types, helpers, permanent screens,
  // and dedicated components. Keep backend métier, READY formula, SQL, RBAC,
  // CRUD and legacy out of LOT 4.
  if (isLot4ForbiddenPath(file)) return false;
  if (/\.test\./.test(file) || /\.red\.test\.tsx?$/.test(file)) {
    return file.startsWith("web/") || file.startsWith("Mobile/") || file.startsWith("scripts/");
  }
  if (file === "package.json" || file === "Mobile/package.json" || file === "web/package.json") return true;
  if (file === "scripts/verify-school-setup-lot4-red.ts") return true;
  if (file === ".github/workflows/pr-gates.yml") return true;
  const allowedExact = new Set([
    "web/src/lib/schoolSetupStatusApi.ts",
    "web/src/lib/schoolSetupWeb.ts",
    "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
    "Mobile/src/lib/schoolSetupStatusApi.ts",
    "Mobile/src/lib/schoolSetupMobile.ts",
    "Mobile/src/screens/SchoolSetupSettingsScreen.tsx",
  ]);
  if (allowedExact.has(file)) return true;
  if (file.startsWith("web/src/components/schoolSetup/") && /\.(ts|tsx)$/.test(file)) return true;
  if (file.startsWith("Mobile/src/components/schoolSetup/") && /\.(ts|tsx)$/.test(file)) return true;
  if (/^web\/src\/lib\/schoolSetup[^/]*\.(ts|tsx)$/.test(file)) return true;
  if (/^Mobile\/src\/lib\/schoolSetup[^/]*\.(ts|tsx)$/.test(file)) return true;
  return false;
}

function isLot4GateMetaFile(file: string) {
  return (
    file === "scripts/verify-school-setup-lot4-red.ts" ||
    file === ".github/workflows/pr-gates.yml" ||
    file === "package.json" ||
    file === "Mobile/package.json" ||
    file === "web/package.json"
  );
}

function isLot4ChantierFile(file: string) {
  // PR-wide L4-09 s'applique seulement au chantier « complétude optionnelle ».
  // Un helper school-setup partagé (auto-open, widget) utilisé par un autre lot
  // ne déclenche pas le contrôle de périmètre backend/RBAC.
  if (isLot4GateMetaFile(file)) return false;
  if (file === "backend/lib/schoolSetupStatus.js") return true;
  if (file === "web/src/pages/parametres/SchoolSetupSettingsPage.tsx") return true;
  if (file === "Mobile/src/screens/SchoolSetupSettingsScreen.tsx") return true;
  if (/OptionalCompleteness/i.test(file)) return true;
  if (/schoolSetupOptional/i.test(file)) return true;
  if (/\.lot4\./i.test(file)) return true;
  if (
    (/(^|\/)migrations?\//.test(file) || /\.sql$/.test(file)) &&
    /schoolSetup|school-setup|school_setup/i.test(file)
  ) {
    return true;
  }
  if (file.startsWith("packages/help-catalog/") || file.startsWith("docs/") || file.startsWith("scripts/verify-help")) {
    return false;
  }
  return false;
}

type Lot409Verdict = { kind: "na" | "ok" | "fail"; message: string };

function isGuidedDedicatedFile(file: string) {
  return /schoolSetupGuided/i.test(file);
}

function isLot4ExclusiveChantierFile(file: string) {
  return (
    isLot4ChantierFile(file) &&
    file !== "web/src/pages/parametres/SchoolSetupSettingsPage.tsx" &&
    file !== "Mobile/src/screens/SchoolSetupSettingsScreen.tsx"
  );
}

function evaluateLot4Scope(changed: readonly string[]): Lot409Verdict {
  const guidedDedicated = changed.filter(isGuidedDedicatedFile);
  const exclusiveLot4 = changed.filter(isLot4ExclusiveChantierFile);
  if (guidedDedicated.length > 0 && exclusiveLot4.length === 0) {
    return {
      kind: "na",
      message:
        "L4-09 N/A: chantier guidé distinct (schoolSetupGuided); SchoolSetupSettingsPage peut être orchestré sans activer le périmètre LOT 4.",
    };
  }
  const chantier = changed.filter(isLot4ChantierFile);
  if (chantier.length === 0) {
    return {
      kind: "na",
      message:
        "L4-09 N/A: aucun fichier school-setup LOT 4 dans le diff; le contrôle de périmètre ne s'applique pas à ce PR.",
    };
  }
  const forbidden = changed.filter((file) => !isLot4AllowedFile(file));
  if (forbidden.length > 0) {
    return {
      kind: "fail",
      message: `LOT 4 hors périmètre (backend/READY/RBAC/CRUD/legacy interdit): ${forbidden.join(", ")}`,
    };
  }
  if (changed.includes("backend/lib/schoolSetupStatus.js")) {
    return {
      kind: "fail",
      message: "deriveSchoolSetupStatus / schoolSetupStatus.js hors LOT 4",
    };
  }
  return {
    kind: "ok",
    message: `L4-09: chantier LOT 4 détecté (${chantier.join(", ")})`,
  };
}

function gitNameOnly(args: string[]) {
  return execFileSync("git", ["diff", "--name-only", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function lot4CommittedFiles() {
  const baseRef = String(process.env.GITHUB_BASE_REF || "develop").replace(/^origin\//, "");
  const bases = [process.env.GITHUB_BASE_SHA, `origin/${baseRef}`, "origin/develop"].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  const attempts = bases.flatMap((base) => [[`${base}...HEAD`], [base, "HEAD"]]);
  const errors: string[] = [];
  for (const args of attempts) {
    try {
      return gitNameOnly(args);
    } catch (error) {
      errors.push(`${args.join(" ")}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  throw new Error(`L4-09: diff vs base indisponible (${errors[0] ?? "aucune base"})`);
}

function lot4ChangedFiles() {
  const committed = lot4CommittedFiles();
  const unstaged = execSync("git diff --name-only", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const staged = execSync("git diff --cached --name-only", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const untracked = execSync("git ls-files --others --exclude-standard", {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set([...committed, ...unstaged, ...staged, ...untracked])];
}

const cases: { id: string; title: string; run: () => void | Promise<void> }[] = [
  {
    id: "L4-01",
    title: "types Web et Mobile exposent periods, subjects, teachers, students, feeGrids, notifications",
    run() {
      assert.ok(exists(webApiPath), "web/src/lib/schoolSetupStatusApi.ts manquant");
      assert.ok(exists(mobileApiPath), "Mobile/src/lib/schoolSetupStatusApi.ts manquant");
      assertNamedOptionalType(read(webApiPath), "Web");
      assertNamedOptionalType(read(mobileApiPath), "Mobile");
    },
  },
  {
    id: "L4-02",
    title: "READY + cinq optionnels false → status READY, progress 3/3",
    run() {
      const { deriveSchoolSetupStatus } = loadBackendContract();
      const derived = deriveSchoolSetupStatus({
        hasCurrentOrOpenAcademicYear: true,
        activatedLevelCount: 1,
        activatedGroupCount: 1,
        classCount: 1,
        termCount: 0,
        teacherCount: 0,
        studentCount: 0,
        feeGridCount: 0,
        notificationsConfigured: false,
      });
      assert.equal(derived.status, "READY");
      assert.equal(derived.progress.coreDone, 3);
      assert.equal(derived.progress.coreTotal, CORE_TOTAL);
      for (const key of OPTIONAL_LOT4) {
        assert.equal(derived.optional?.[key], false, `${key} doit rester false sans modifier READY`);
      }
    },
  },
  {
    id: "L4-03",
    title: "Web SchoolSetupSettingsPage affiche la complétude recommandée depuis payload.optional",
    run() {
      assert.ok(exists(webSettingsPagePath), "SchoolSetupSettingsPage.tsx manquant");
      assertCompletenessSection(
        completenessClientSources(webSettingsPagePath, path.join(repoRoot, "web/src/components/schoolSetup")),
        "Web",
      );
    },
  },
  {
    id: "L4-04",
    title: "Mobile SchoolSetupSettingsScreen affiche la même complétude depuis payload.optional",
    run() {
      assert.ok(exists(mobileSettingsPath), "SchoolSetupSettingsScreen.tsx manquant");
      assertCompletenessSection(
        completenessClientSources(
          mobileSettingsPath,
          path.join(repoRoot, "Mobile/src/components/schoolSetup"),
        ),
        "Mobile",
      );
    },
  },
  {
    id: "L4-05",
    title: "parité Web/Mobile : même payload → mêmes done/missing, sans autre API",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      assert.equal(
        typeof web.schoolSetupOptionalCompleteness,
        "function",
        "Web: schoolSetupOptionalCompleteness manquant — mapping optional.* LOT 4",
      );
      assert.equal(
        typeof mobile.schoolSetupOptionalCompleteness,
        "function",
        "Mobile: schoolSetupOptionalCompleteness manquant — mapping optional.* LOT 4",
      );
      const snap = mixedOptional();
      const webItems = web.schoolSetupOptionalCompleteness(snap);
      const mobileItems = mobile.schoolSetupOptionalCompleteness(snap);
      const asMap = (items: Array<{ id?: string; done?: boolean }>) => {
        const map = new Map<string, boolean>();
        for (const item of items ?? []) {
          if (item?.id) map.set(item.id, Boolean(item.done));
        }
        return map;
      };
      const webMap = asMap(webItems);
      const mobileMap = asMap(mobileItems);
      for (const key of OPTIONAL_LOT4) {
        assert.equal(webMap.get(key), Boolean(snap.optional?.[key]), `Web: ${key} mal classé`);
        assert.equal(mobileMap.get(key), webMap.get(key), `parité Web/Mobile cassée pour ${key}`);
      }
      const joined = `${read(webContractPath)}\n${read(mobileContractPath)}`;
      assertLacks(
        joined,
        /listAcademicYears|getAcademicYears|getEducationCatalog|feeGridsApi|teachersApi/,
        "pas d'agrégation locale pour la complétude optionnelle",
      );
    },
  },
  {
    id: "L4-06",
    title: "READY + optionnels incomplets → pas de widget/auto-open, Paramètres conservé",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const snap = readyAllOptionalFalse();
      const input = { payload: snap, role: "Admin School", mustChangePassword: false };
      assert.equal(web.shouldShowDashboardSetupWidget(input), false, "Web: widget interdit si READY");
      assert.equal(web.shouldAutoOpenSchoolSetupWizard(input), false, "Web: auto-open interdit si READY");
      assert.equal(
        mobile.shouldShowDashboardSetupWidget({ payload: snap, role: "school_admin" }),
        false,
        "Mobile: widget interdit si READY",
      );
      assertHas(read(webSettingsHubPath), "Configuration de l'établissement");
      assertHas(read(mobileConfigPath), /title:\s*["']Configuration de l['’]établissement["']/);
    },
  },
  {
    id: "L4-07",
    title: "progression essentielle = coreDone/coreTotal uniquement",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const snap = mixedOptional();
      assert.equal(web.dashboardSetupProgressLabel(snap), "3 / 3");
      assert.equal(mobile.dashboardSetupProgressLabel(snap), "3 / 3");
      const screens = `${read(webSettingsPagePath)}\n${read(mobileSettingsPath)}`;
      assertHas(screens, "dashboardSetupProgressLabel", "libellé de progression essentielle absent");
      assertLacks(
        screens,
        /coreDone\s*\+\s*|coreTotal\s*\+\s*|optionalDone|\/\s*8|3 \+ /,
        "interdit de mélanger core et optional dans la progression X/3",
      );
    },
  },
  {
    id: "L4-08",
    title: "aucune persistance / snooze serveur pour les états optionnels",
    run() {
      const rows = schoolSetupModuleSources();
      assert.ok(rows.length > 0, "aucun module school setup à inspecter");
      for (const { file, source } of rows) {
        const rel = path.relative(repoRoot, file);
        assertLacks(
          source,
          /localStorage|sessionStorage|AsyncStorage|SecureStore/,
          `${rel}: persistance client des états optionnels interdite`,
        );
        assertLacks(
          source,
          /snooze|dismissed_until|setup_status|optional_status/,
          `${rel}: snooze / setup_status / optional_status interdit`,
        );
      }
    },
  },
  {
    id: "L4-09",
    title: "périmètre LOT 4 : school setup Web/Mobile prévu, pas backend/READY/RBAC",
    run() {
      const forbiddenOnly = evaluateLot4Scope(["backend/lib/schoolSetupStatus.js"]);
      assert.equal(forbiddenOnly.kind, "fail", forbiddenOnly.message);
      const forbiddenSql = evaluateLot4Scope([
        "backend/db/migrations/20260918_school_setup_optional.sql",
      ]);
      assert.equal(forbiddenSql.kind, "fail", forbiddenSql.message);
      const helpSettings = evaluateLot4Scope([
        "packages/help-catalog/src/articles-refresh.js",
        "packages/help-catalog/test/settings.test.js",
        "scripts/verify-help-settings.js",
        "scripts/verify-school-setup-lot4-red.ts",
      ]);
      assert.equal(helpSettings.kind, "na", helpSettings.message);
      const allowedLot4 = evaluateLot4Scope([
        "web/src/lib/schoolSetupWeb.ts",
        "Mobile/src/lib/schoolSetupMobile.ts",
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
      ]);
      assert.equal(allowedLot4.kind, "ok", allowedLot4.message);
      const mixed = evaluateLot4Scope([
        "web/src/lib/schoolSetupWeb.ts",
        "backend/lib/schoolSetupStatus.js",
      ]);
      assert.equal(mixed.kind, "fail", mixed.message);

      const otherLotSharedHelper = evaluateLot4Scope([
        "Mobile/src/lib/schoolSetupMobile.ts",
        "web/src/lib/schoolSetupWeb.ts",
        "backend/lib/educationSchoolCatalogScope.js",
        "backend/server.js",
        "docs/audits/parite-web-mobile-lot1-referentiels-etablissement.md",
      ]);
      assert.equal(
        otherLotSharedHelper.kind,
        "na",
        "un autre lot peut toucher le helper school-setup partagé + son backend hors LOT 4",
      );

      const lot4PlusForeignBackend = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "backend/server.js",
      ]);
      assert.equal(lot4PlusForeignBackend.kind, "fail", lot4PlusForeignBackend.message);

      const guidedDistinctChantier = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "Mobile/src/screens/SchoolSetupSettingsScreen.tsx",
        "web/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx",
        "web/src/lib/schoolSetupGuidedWeb.ts",
        "Mobile/src/lib/schoolSetupGuidedMobile.ts",
        "backend/lib/schoolSetupGuided.js",
        "backend/db/schoolSetupGuidedSchema.js",
        "backend/services/rbacService.js",
        "backend/server.js",
      ]);
      assert.equal(
        guidedDistinctChantier.kind,
        "na",
        "L4-09: chantier guidé distinct (schoolSetupGuided) doit être N/A même s'il orchestre SchoolSetupSettingsPage",
      );
      assert.equal(lot4PlusForeignBackend.kind, "fail", "vrai LOT 4 + backend doit rester FAIL");

      const live = evaluateLot4Scope(lot4ChangedFiles());
      console.log(live.message);
      assert.notEqual(live.kind, "fail", live.message);
    },
  },
];

async function main() {
  const failed: { id: string; title: string; message: string }[] = [];
  const passedIds: string[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      passedIds.push(testCase.id);
    } catch (error) {
      failed.push({
        id: testCase.id,
        title: testCase.title,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `LOT 4 school-setup RED — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
  );
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.log(`  FAIL [${item.id}] ${item.title}`);
    console.log(`    ${item.message}`);
  }
  console.log(
    `SCHOOL_SETUP_LOT4_RED ${JSON.stringify({
      passedIds,
      failedIds: failed.map((item) => item.id),
      expectedIds: cases.map((item) => item.id),
    })}`,
  );
  if (failed.length) process.exitCode = 1;
  else console.log("OK: LOT 4 school-setup (contrats GREEN)");
}

void main();
