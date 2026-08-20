const assert = require("assert");
const fs = require("fs");
const path = require("path");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function main() {
  const spec = read("docs/mobile/UX_UI_MOBILE_V1.md");
  const tabs = read("Mobile/src/navigation/BottomTabsNavigator.tsx");
  const roleTabs = read("Mobile/src/navigation/roleTabPreferences.ts");
  const header = read("Mobile/src/components/MobileAppHeader.tsx");
  const drawer = read("Mobile/src/components/RoleNavigationDrawer.tsx");
  const drawerPrefs = read("Mobile/src/navigation/roleDrawerPreferences.ts");

  assert.match(spec, /aucun onglet « Menu »/i);
  assert.match(spec, /Accueil \+ 4 onglets métier maximum/i);

  assert.match(tabs, /MobileAppHeader/);
  assert.doesNotMatch(tabs, /name="Menu"/);
  assert.doesNotMatch(tabs, /import MenuScreen/);
  assert.match(roleTabs, /MAX_FLOATING_ROLE_TABS = 4/);

  assert.match(header, /mobile-header-menu/);
  assert.match(header, /mobile-header-school-name/);
  assert.match(header, /mobile-header-sync/);
  assert.match(header, /mobile-header-search/);
  assert.match(header, /mobile-header-notifications/);
  assert.match(header, /RoleNavigationDrawer/);
  assert.doesNotMatch(header, /globe/i);

  assert.match(drawer, /Modal/);
  assert.match(drawer, /mobile-role-drawer/);
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
  ]) {
    assert.doesNotMatch(source, /refreshBackOfficeState|backoffice_state/i, `${name}: legacy interdit`);
  }

  console.log("verify:mobile-ux-v1 OK");
}

main();
