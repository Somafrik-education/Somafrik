const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function runTsx(relative) {
  const result = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", relative)], {
    encoding: "utf8",
    cwd: MOBILE,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${relative} failed`);
  }
  process.stdout.write(result.stdout || "");
}

function main() {
  const spec = read("docs/mobile/UX_UI_MOBILE_V1.md");
  const tabs = read("Mobile/src/navigation/BottomTabsNavigator.tsx");
  const roleTabs = read("Mobile/src/navigation/roleTabPreferences.ts");
  const header = read("Mobile/src/components/MobileAppHeader.tsx");
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  const dashboard = read("Mobile/src/components/RoleDashboardLayout.tsx");
  const roleHome = read("Mobile/src/lib/roleHomeConfig.ts");
  const navSpec = read("Mobile/src/lib/mobileNavigationSpec.ts");
  const loginSpec = read("Mobile/src/lib/loginScreenSpec.ts");
  const drawer = read("Mobile/src/components/RoleNavigationDrawer.tsx");
  const drawerPrefs = read("Mobile/src/navigation/roleDrawerPreferences.ts");
  const layout = read("Mobile/src/lib/mobileUxV1Layout.ts");
  const screenLayout = read("Mobile/src/lib/screenLayout.ts");
  const badge = read("Mobile/src/components/EnvironmentBadge.tsx");

  assert.match(spec, /V2/);
  assert.match(spec, /RoleDashboardLayout|coque unique/i);
  assert.match(spec, /aucun onglet « Menu »/i);
  assert.match(spec, /Accueil \+ 4 onglets métier maximum/i);
  assert.match(spec, /Header compact/i);
  assert.match(spec, /Accueil \/ Classes \/ Frais \/ Comptes \/ Profs/);
  assert.match(spec, /Espace administrateur/);
  assert.match(spec, /Vue métier/);

  assert.match(layout, /UX_V1_SPEC_VERSION = "2\.0"/);
  assert.match(layout, /SCHOOL_ADMIN_BOTTOM_LABELS/);
  assert.match(layout, /MAX_TAB_LABEL_CHARS = 8/);
  assert.match(layout, /HEADER_ACTIONS_SLOT_DP/);
  assert.match(layout, /HEADER_MENU_SLOT_DP/);
  assert.match(layout, /HEADER_BADGE_BAND_DP/);
  assert.match(layout, /IDENTITY_CARD_MIN_DP/);
  assert.match(layout, /MISSION_BANNER_MIN_DP/);
  assert.match(layout, /shortBottomTabLabel/);
  assert.match(layout, /KPI_ROW_MIN_DP = 92/);
  assert.match(layout, /TAB_BAR_CONTENT_HEIGHT = 52/);
  assert.match(layout, /measureHomeShell/);
  assert.match(layout, /homeAboveFoldFitsAllViewports/);

  runTsx("mobileUxV1Layout.test.ts");
  runTsx("roleHomeConfig.test.ts");
  runTsx("homeShellPermissions.test.ts");

  assert.match(tabs, /MobileAppHeader/);
  assert.match(tabs, /headerStatusBarHeight:\s*0/);
  assert.match(tabs, /CompactTabLabel/);
  assert.match(tabs, /TAB_LABEL_FONT_SIZE/);
  assert.match(tabs, /shortBottomTabLabel/);
  assert.match(tabs, /size=\{20\}/);
  assert.doesNotMatch(tabs, /adjustsFontSizeToFit/);
  assert.doesNotMatch(tabs, /minimumFontScale/);
  assert.doesNotMatch(tabs, /name="Menu"/);
  assert.doesNotMatch(tabs, /import MenuScreen/);
  assert.match(roleTabs, /MAX_FLOATING_ROLE_TABS = 4/);
  assert.match(roleTabs, /label: "Comptes"/);
  assert.match(roleTabs, /label: "Profs"/);
  assert.doesNotMatch(roleTabs, /^\s*label: "Utilisateurs"/m);
  assert.doesNotMatch(roleTabs, /^\s*label: "Enseignants"/m);

  assert.match(screenLayout, /TAB_BAR_CONTENT_HEIGHT/);
  assert.match(screenLayout, /borderTopLeftRadius/);
  assert.doesNotMatch(screenLayout, /borderRadius:\s*20/);

  assert.match(header, /SafeAreaView/);
  assert.match(header, /edges=\{\["top"\]\}/);
  assert.match(header, /HEADER_ACTIONS_SLOT_DP/);
  assert.match(header, /HEADER_MENU_SLOT_DP/);
  assert.match(header, /badgeBand/);
  assert.match(header, /styles\.menuSlot/);
  assert.doesNotMatch(header, /schoolCity|roleLabel|Uvira/);
  assert.match(header, /mobile-header-menu/);
  assert.match(header, /mobile-header-school-name/);
  assert.match(header, /mobile-header-sync/);
  assert.match(header, /mobile-header-search/);
  assert.match(header, /mobile-header-notifications/);
  assert.match(header, /RoleNavigationDrawer/);
  assert.doesNotMatch(header, /globe/i);
  assert.doesNotMatch(header, /roleLabel/);

  assert.match(dashboard, /identityCard/);
  assert.match(dashboard, /Vue métier/);
  assert.match(dashboard, /Matrice sécurité/);
  assert.match(dashboard, /Actions rapides/);
  assert.match(dashboard, /MAX_HOME_KPIS/);
  assert.match(roleHome, /Espace administrateur/);
  assert.match(roleHome, /Espace préfet des études/);
  assert.match(roleHome, /Espace enseignant/);
  assert.match(home, /RoleDashboardLayout/);
  assert.match(home, /getRoleHomeShell/);
  assert.match(home, /canShowHomeCoursesKpi/);
  assert.match(home, /canShowHomeStudentAction/);
  assert.match(home, /canReadRoute\(session, "Timetable"\)/);
  assert.match(home, /studentPayments/);
  assert.match(roleHome, /fail-closed/);
  assert.doesNotMatch(home, /CommunicationHeaderIcons/);
  assert.doesNotMatch(home, /welcomeQuiet/);
  assert.match(home, /home-admin-dashboard|HOME_TEST_IDS\.adminDashboard/);
  assert.doesNotMatch(home, /style=\{styles\.welcomeCard\}/);
  assert.doesNotMatch(home, /style=\{styles\.schoolCard\}/);

  assert.match(badge, /testID="environment-badge"/);
  assert.match(badge, /UX_V1_SPEC_VERSION/);
  assert.match(badge, /insets\.top \+ 2/);

  assert.doesNotMatch(navSpec, /tabMenu/);
  assert.doesNotMatch(navSpec, /tab-menu/);
  assert.doesNotMatch(loginSpec, /tab-menu/);
  assert.match(navSpec, /tab-frais/);
  assert.match(navSpec, /tab-comptes/);

  assert.match(drawer, /Modal/);
  assert.match(drawer, /mobile-role-drawer/);
  assert.match(drawer, /mobile-role-drawer-logout/);
  assert.match(drawer, /getAllowedRoleDrawerItems/);
  assert.match(drawer, /Déconnexion/);
  assert.match(drawerPrefs, /canReadRoute/);
  assert.match(drawerPrefs, /canReadView/);
  assert.match(drawerPrefs, /canReadEntity/);

  for (const [name, source] of [
    ["header", header],
    ["drawer", drawer],
    ["drawer preferences", drawerPrefs],
    ["bottom tabs", tabs],
    ["home", home],
    ["role dashboard", dashboard],
  ]) {
    assert.doesNotMatch(source, /refreshBackOfficeState|backoffice_state/i, `${name}: legacy interdit`);
  }

  console.log("verify:mobile-ux-v1 OK");
}

main();
