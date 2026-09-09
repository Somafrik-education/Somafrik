/**
 * PR #577 — Lot L0 Hygiène Mobile — tests ROUGES causaux.
 *   npx --yes tsx src/lib/pariteL0Hygiene.red.test.ts
 *
 * Critères uniquement : PR #577 §4.11 L0 + P1-07, P1-08, P1-13.
 * Aucune correction applicative dans cette passe.
 *
 * Chaque cas affirme l'état cible. Il reste ROUGE tant que l'écart #577 existe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoleDrawerCatalog } from "../navigation/roleDrawerPreferences";
import { getRoleHomeShell } from "./roleHomeConfig";
import { UX_V1_VIEWPORTS } from "./mobileUxV1Layout";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

type Case = { id: string; title: string; run: () => void };

const cases: Case[] = [
  {
    id: "L0-01",
    title: "Mobile_hidden_platform_features_should_not_be_navigable — drawer Superadmin",
    run() {
      const labels = getRoleDrawerCatalog("super_admin").map((item) => item.label);
      for (const label of ["Établissements", "Abonnements", "Droits par rôle", "Audit"]) {
        assert.equal(
          labels.includes(label),
          false,
          `#577 L0 / P1-13 : « ${label} » ne doit plus être navigable sur Mobile (Web-only, à retirer, jamais à construire)`,
        );
      }
      assert.equal(
        getRoleDrawerCatalog("super_admin").some((item) => item.route === "PlatformNotifications"),
        false,
        "#577 L0 : Notifications plateforme drawer Superadmin à retirer, pas à construire",
      );
    },
  },
  {
    id: "L0-02",
    title: "Mobile_hidden_platform_features_should_not_be_navigable — drawer Admin Pays",
    run() {
      const labels = getRoleDrawerCatalog("country_admin").map((item) => item.label);
      for (const label of ["Établissements", "Abonnements", "Audit"]) {
        assert.equal(
          labels.includes(label),
          false,
          `#577 L0 : Admin Pays « ${label} » est Web-only — retirer du Mobile`,
        );
      }
    },
  },
  {
    id: "L0-03",
    title: "KPI Pays / Établissements ne doivent plus ouvrir AdminCrud",
    run() {
      const shell = getRoleHomeShell({ role: "super_admin" });
      assert.equal(shell.kpiKeys.includes("countries"), false, "#577 L0 : KPI Pays → AdminCrud à retirer");
      assert.equal(shell.kpiKeys.includes("schools"), false, "#577 L0 : KPI Établissements → AdminCrud à retirer");
      const home = read("screens/HomeScreen.tsx");
      assert.doesNotMatch(
        home,
        /navigate\("AdminCrud", \{ entity: "countries" \}\)/,
        "#577 L0 : HomeScreen ne doit plus router Pays vers AdminCrud",
      );
      assert.doesNotMatch(
        home,
        /navigate\("AdminCrud", \{ entity: "schools" \}\)/,
        "#577 L0 : HomeScreen ne doit plus router Établissements vers AdminCrud",
      );
    },
  },
  {
    id: "L0-04",
    title: "Documents / Rapports school_admin ne doivent plus paraître opérationnels",
    run() {
      const items = getRoleDrawerCatalog("school_admin");
      assert.equal(
        items.some((item) => item.route === "Documents" || item.label === "Documents"),
        false,
        "#577 L0 / P1-07 : Documents MVP absent du drawer school_admin (ou explicitement non opérationnel — aujourd'hui CTA standard)",
      );
      assert.equal(
        items.some((item) => item.route === "Reports" || item.label === "Rapports"),
        false,
        "#577 L0 / P1-08 : Rapports MVP à retirer du drawer school_admin",
      );
    },
  },
  {
    id: "L0-05",
    title: "DocumentsScreen ne doit pas afficher un faux succès MVP",
    run() {
      const src = read("screens/MvpUtilityScreens.tsx");
      assert.doesNotMatch(
        src,
        /Centre MVP/,
        "#577 P1-07 : Documents ne doit pas se présenter comme un centre opérationnel MVP",
      );
      assert.doesNotMatch(
        src,
        /value="Disponible"/,
        "#577 P1-07 : « Disponible » est un faux succès — /school-documents n'est pas consommé",
      );
    },
  },
  {
    id: "L0-06",
    title: "ReportsScreen ne doit pas agréger le cache local comme rapport canonique",
    run() {
      const src = read("screens/MvpUtilityScreens.tsx");
      assert.doesNotMatch(
        src,
        /title="Rapports MVP"/,
        "#577 P1-08 : Rapports MVP à retirer plutôt qu'à parité pixel",
      );
      assert.doesNotMatch(
        src,
        /getPaymentStats\(paymentsData/,
        "#577 P1-08 : Rapports ne doit pas compter le cache client comme vérité métier",
      );
    },
  },
  {
    id: "L0-07",
    title: "AuditScreen MVP ne doit plus être un écran live",
    run() {
      const navigator = read("navigation/AppNavigator.tsx");
      const mvp = read("screens/MvpUtilityScreens.tsx");
      assert.doesNotMatch(
        navigator,
        /name="Audit"/,
        "#577 L0 : Stack.Screen Audit MVP à retirer du graphe live",
      );
      assert.doesNotMatch(
        mvp,
        /Journal MVP des actions sensibles/,
        "#577 L0 : Audit MVP n'est pas un journal canonique",
      );
    },
  },
  {
    id: "L0-08",
    title: "AdminCrud ne doit plus être monté dès Teachers/Users/Payments",
    run() {
      const navigator = read("navigation/AppNavigator.tsx");
      assert.doesNotMatch(
        navigator,
        /name="AdminCrud"/,
        "#577 P1-13 : AdminCrud ne doit plus être dans le graphe live (deep-link fail-closed encore possible dès Paiements/Users/Teachers)",
      );
    },
  },
  {
    id: "L0-09",
    title: "SchoolManagement ne doit plus offrir de cartes fail-closed vers AdminCrud",
    run() {
      const src = read("screens/SchoolManagementScreen.tsx");
      assert.doesNotMatch(src, /entity:\s*"schools"/, "#577 L0 : carte Établissements → AdminCrud à retirer");
      assert.doesNotMatch(src, /entity:\s*"courses"/, "#577 L0 : carte Cours → AdminCrud fail-closed à retirer");
      assert.doesNotMatch(src, /entity:\s*"assignments"/, "#577 L0 : carte Affectations → AdminCrud fail-closed à retirer");
      assert.doesNotMatch(src, /navigate\("AdminCrud"/, "#577 L0 : SchoolManagement ne doit plus router vers AdminCrud");
    },
  },
  {
    id: "L0-10",
    title: "MenuScreen mort ne doit plus contenir de CTA AdminCrud",
    run() {
      const src = read("screens/MenuScreen.tsx");
      assert.doesNotMatch(
        src,
        /navigate\("AdminCrud"/,
        "#577 L0 : MenuScreen (hors graphe live) doit être isolé — plus de CTA AdminCrud",
      );
      assert.doesNotMatch(
        src,
        /route: "Documents"/,
        "#577 L0 : MenuScreen ne doit plus exposer Documents/Rapports/Audit comme routes opérationnelles",
      );
    },
  },
  {
    id: "L0-11",
    title: "KPI Accueil L0/L1 — accessibilité bouton + libellé",
    run() {
      const layout = read("components/RoleDashboardLayout.tsx");
      const start = layout.indexOf("visibleKpis.map");
      const kpiBlock = layout.slice(start, start + 900);
      assert.match(
        kpiBlock,
        /accessibilityRole="button"/,
        "Mandat Lots 0-1 : chaque KPI Accueil cliquable doit exposer accessibilityRole=button",
      );
      assert.match(
        kpiBlock,
        /accessibilityLabel/,
        "Mandat Lots 0-1 : chaque KPI Accueil doit exposer accessibilityLabel (libellé métier, pas la couleur seule)",
      );
    },
  },
  {
    id: "L0-12",
    title: "Viewports 360 / 390 / 430 dp inclus dans le contrat Accueil",
    run() {
      for (const width of [360, 390, 430] as const) {
        assert.equal(
          (UX_V1_VIEWPORTS as readonly number[]).includes(width),
          true,
          `Mandat Lots 0-1 : viewport ${width} dp absent de UX_V1_VIEWPORTS=${JSON.stringify(UX_V1_VIEWPORTS)}`,
        );
      }
    },
  },
];

const failures: { id: string; title: string; message: string }[] = [];
const passed: string[] = [];

for (const testCase of cases) {
  try {
    testCase.run();
    passed.push(testCase.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id: testCase.id, title: testCase.title, message });
  }
}

console.log(`parite L0 hygiene — ${passed.length} vert / ${failures.length} rouge / ${cases.length} cas`);
for (const id of passed) console.log(`  PASS ${id}`);
for (const failure of failures) {
  console.error(`  FAIL [${failure.id}] ${failure.title}\n    ${failure.message}`);
}

if (failures.length) process.exit(1);
console.log("OK: L0 hygiene (tous les écarts #577 L0 sont clos)");
