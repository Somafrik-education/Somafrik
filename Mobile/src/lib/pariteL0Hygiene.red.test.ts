/**
 * PR #577 — Lot L0 Hygiène Mobile — tests ROUGES causaux.
 *   npx --yes tsx src/lib/pariteL0Hygiene.red.test.ts
 *
 * #577 L0 : retirer / cacher / marquer non opérationnel.
 * L0-04 n'exige plus l'absence stricte du drawer (retrait OU état explicite non opérationnel).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoleDrawerCatalog, type RoleDrawerItem } from "../navigation/roleDrawerPreferences";
import { getRoleHomeShell } from "./roleHomeConfig";
import { UX_V1_VIEWPORTS } from "./mobileUxV1Layout";
import { MAQUETTE_L0_L1_VIEWPORTS_DP, NON_OPERATIONAL_LABEL_RE } from "./pariteL0L1UxContract";
import { L0_EXPECTED_IDS, runRedCases, type RedCase } from "./pariteL0L1RedReport";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

function isExplicitlyNonOperational(item: RoleDrawerItem) {
  const extra = item as RoleDrawerItem & { operational?: boolean; status?: string };
  if (extra.operational === false) return true;
  if (String(extra.status ?? "").toLowerCase() === "non-operational") return true;
  return NON_OPERATIONAL_LABEL_RE.test(`${item.label} ${item.view ?? ""} ${item.route ?? ""}`);
}

function operationalDrawerItems(role: string, match: (item: RoleDrawerItem) => boolean) {
  return getRoleDrawerCatalog(role).filter((item) => match(item) && !isExplicitlyNonOperational(item));
}

const cases: RedCase[] = [
  {
    id: "L0-01",
    title: "Mobile_hidden_platform_features_should_not_be_navigable — drawer Superadmin",
    run() {
      const operational = operationalDrawerItems("super_admin", (item) =>
        ["Établissements", "Abonnements", "Droits par rôle", "Audit"].includes(item.label) ||
        item.route === "PlatformNotifications",
      );
      assert.equal(
        operational.length,
        0,
        `#577 L0 / P1-13 : fonctions plateforme encore opérationnelles sur Mobile (${operational.map((item) => item.label).join(", ")}) — retirer, cacher ou marquer non opérationnel, jamais construire`,
      );
    },
  },
  {
    id: "L0-02",
    title: "Mobile_hidden_platform_features_should_not_be_navigable — drawer Admin Pays",
    run() {
      const operational = operationalDrawerItems("country_admin", (item) =>
        ["Établissements", "Abonnements", "Audit"].includes(item.label),
      );
      assert.equal(
        operational.length,
        0,
        `#577 L0 : Admin Pays encore opérationnel (${operational.map((item) => item.label).join(", ")})`,
      );
    },
  },
  {
    id: "L0-03",
    title: "KPI Pays / Établissements ne doivent plus ouvrir AdminCrud",
    run() {
      const shell = getRoleHomeShell({ role: "super_admin" });
      const home = read("screens/HomeScreen.tsx");
      const countriesToCrud = shell.kpiKeys.includes("countries") && /entity:\s*"countries"/.test(home);
      const schoolsToCrud = shell.kpiKeys.includes("schools") && /entity:\s*"schools"/.test(home);
      assert.equal(
        countriesToCrud || schoolsToCrud,
        false,
        "#577 L0 : KPI Pays/Établissements routent encore vers AdminCrud — retirer le KPI ou cesser d'ouvrir le CRUD générique",
      );
    },
  },
  {
    id: "L0-04",
    title: "Documents / Rapports school_admin : pas d'entrée opérationnelle (retrait, masquage ou non opérationnel)",
    run() {
      const documents = operationalDrawerItems(
        "school_admin",
        (item) => item.route === "Documents" || item.label === "Documents",
      );
      const reports = operationalDrawerItems(
        "school_admin",
        (item) => item.route === "Reports" || item.label === "Rapports",
      );
      assert.equal(
        documents.length,
        0,
        "#577 L0 / P1-07 : Documents encore présenté comme opérationnel dans le drawer (la #577 autorise retrait, masquage ou état explicitement non opérationnel)",
      );
      assert.equal(
        reports.length,
        0,
        "#577 L0 / P1-08 : Rapports encore présenté comme opérationnel dans le drawer (retrait, masquage ou non opérationnel)",
      );
    },
  },
  {
    id: "L0-05",
    title: "DocumentsScreen ne doit pas afficher un faux succès opérationnel",
    run() {
      const src = read("screens/MvpUtilityScreens.tsx");
      const start = src.indexOf("export function DocumentsScreen");
      const next = src.indexOf("export function ReportsScreen");
      const block = start >= 0 ? src.slice(start, next > start ? next : start + 2500) : src;
      const markedNonOperational = NON_OPERATIONAL_LABEL_RE.test(block);
      const fakeSuccess = /value="Disponible"/.test(block) || /Centre MVP/.test(block);
      assert.equal(
        fakeSuccess && !markedNonOperational,
        false,
        "#577 P1-07 : DocumentsScreen se présente encore comme un centre opérationnel (« Disponible » / Centre MVP) sans /school-documents",
      );
    },
  },
  {
    id: "L0-06",
    title: "ReportsScreen ne doit pas agréger le cache local comme rapport canonique",
    run() {
      const src = read("screens/MvpUtilityScreens.tsx");
      const start = src.indexOf("export function ReportsScreen");
      const next = src.indexOf("export function AuditScreen");
      const block = start >= 0 ? src.slice(start, next > start ? next : start + 2000) : src;
      const markedNonOperational = NON_OPERATIONAL_LABEL_RE.test(block);
      const localAsCanon = /title="Rapports MVP"/.test(block) || /getPaymentStats\(paymentsData/.test(block);
      assert.equal(
        localAsCanon && !markedNonOperational,
        false,
        "#577 P1-08 : Rapports MVP compte encore le cache client comme vérité métier",
      );
    },
  },
  {
    id: "L0-07",
    title: "AuditScreen MVP ne doit plus être un écran live opérationnel",
    run() {
      const navigator = read("navigation/AppNavigator.tsx");
      const mvp = read("screens/MvpUtilityScreens.tsx");
      const live = /name="Audit"/.test(navigator);
      const journalMvp = /Journal MVP des actions sensibles/.test(mvp) && !NON_OPERATIONAL_LABEL_RE.test(mvp);
      assert.equal(
        live && journalMvp,
        false,
        "#577 L0 : Audit MVP encore au graphe live comme journal opérationnel",
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
        "#577 P1-13 : AdminCrud encore dans le graphe live (deep-link fail-closed dès Paiements/Users/Teachers)",
      );
    },
  },
  {
    id: "L0-09",
    title: "SchoolManagement ne doit plus offrir de cartes fail-closed vers AdminCrud",
    run() {
      const src = read("screens/SchoolManagementScreen.tsx");
      assert.doesNotMatch(src, /navigate\("AdminCrud"/, "#577 L0 : SchoolManagement route encore vers AdminCrud");
    },
  },
  {
    id: "L0-10",
    title: "MenuScreen mort ne doit plus contenir de CTA AdminCrud opérationnels",
    run() {
      const src = read("screens/MenuScreen.tsx");
      assert.doesNotMatch(
        src,
        /navigate\("AdminCrud"/,
        "#577 L0 : MenuScreen (hors graphe live) n'est pas isolé — CTA AdminCrud encore présents",
      );
    },
  },
  {
    id: "L0-11",
    title: "KPI Accueil L0/L1 — accessibilité bouton + libellé (maquette)",
    run() {
      const layout = read("components/RoleDashboardLayout.tsx");
      const start = layout.indexOf("visibleKpis.map");
      const kpiBlock = layout.slice(start, start + 900);
      assert.match(
        kpiBlock,
        /accessibilityRole="button"/,
        "Maquette L0/L1 / P12 : KPI Accueil cliquable sans accessibilityRole=button",
      );
      assert.match(
        kpiBlock,
        /accessibilityLabel/,
        "Maquette L0/L1 / AP-005 : KPI Accueil sans accessibilityLabel (la couleur ne suffit pas)",
      );
    },
  },
  {
    id: "L0-12",
    title: "Viewports maquette 360 / 390 / 430 dp sur la coque Accueil",
    run() {
      for (const width of MAQUETTE_L0_L1_VIEWPORTS_DP) {
        assert.equal(
          (UX_V1_VIEWPORTS as readonly number[]).includes(width),
          true,
          `Maquette L0/L1 : viewport ${width} dp absent de UX_V1_VIEWPORTS=${JSON.stringify(UX_V1_VIEWPORTS)}`,
        );
      }
    },
  },
];

const report = runRedCases("L0", L0_EXPECTED_IDS, cases);
if (report.failedIds.length) process.exit(1);
console.log("OK: L0 hygiene (tous les écarts #577 L0 sont clos)");
