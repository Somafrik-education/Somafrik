import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { readHelpNavigationSnapshot } from "./resolveMobileHelpRoute";

const helpHostSource = fs.readFileSync(path.join(__dirname, "HelpHost.tsx"), "utf8");
const navigatorSource = fs.readFileSync(
  path.join(__dirname, "../navigation/AppNavigator.tsx"),
  "utf8",
);

assert.equal(
  /useNavigation(?:State)?\s*\(/.test(helpHostSource),
  false,
  "HelpHost ne doit plus appeler useNavigation / useNavigationState",
);
assert.equal(
  /from\s+["']@react-navigation\/native["']/.test(helpHostSource),
  false,
  "HelpHost ne doit pas importer @react-navigation/native (pas de NavigationContext)",
);
assert.match(helpHostSource, /routeName:\s*string\s*\|\s*null/);
assert.match(helpHostSource, /rootName:\s*string\s*\|\s*null/);
assert.match(helpHostSource, /navigationRef/);
assert.match(helpHostSource, /navigationRef\.navigate/);

assert.match(navigatorSource, /onReady=/);
assert.match(navigatorSource, /onStateChange=/);
assert.match(navigatorSource, /readHelpNavigationSnapshot/);
assert.match(
  navigatorSource,
  /<HelpHost\s+routeName=\{helpNav\.routeName\}\s+rootName=\{helpNav\.rootName\}\s*\/>/,
);
assert.match(
  navigatorSource,
  /<\/Stack\.Navigator>\s*<HelpHost/,
  "HelpHost reste un overlay global, frère de Stack.Navigator",
);

/**
 * Régression P0 : HelpHost est frère de Stack.Navigator, donc hors NavigationContext.
 * Le contrat de montage est un élément React alimenté par routeName / rootName,
 * jamais par useNavigationState().
 */
function HelpHostWithoutNavigationContext(props: {
  routeName: string | null;
  rootName: string | null;
}) {
  const snapshot = readHelpNavigationSnapshot(null);
  assert.equal(typeof props.routeName === "string" || props.routeName === null, true);
  assert.equal(typeof props.rootName === "string" || props.rootName === null, true);
  return createElement("help-host", {
    routeName: props.routeName ?? snapshot.routeName,
    rootName: props.rootName ?? snapshot.rootName,
  });
}

const mounted = createElement(HelpHostWithoutNavigationContext, {
  routeName: "Home",
  rootName: "Home",
});
assert.equal(mounted.type, HelpHostWithoutNavigationContext);
assert.deepEqual(mounted.props, { routeName: "Home", rootName: "Home" });

console.log("HelpHost.isolation.test.ts OK");
