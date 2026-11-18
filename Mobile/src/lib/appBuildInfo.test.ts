/**
 * npx tsx Mobile/src/lib/appBuildInfo.test.ts — LOT 2 (binaire identifiable sans ADB).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describeAppBuild } from "./appBuildInfo";

const SHA = "8467944526563b956bfd50370079af9e9355b533";

assert.deepEqual(
  describeAppBuild({
    version: "1.2.1",
    android: { versionCode: 25 },
    extra: { releaseProfile: "preview", buildProvenance: { gitSha: SHA.toUpperCase(), profile: "preview" } },
  }),
  { value: "Version 1.2.1 (25)", detail: "Build 84679445 · profil preview. Communiquez ces informations au support." },
);

// Binaire antérieur au LOT 2 : jamais de SHA inventé.
assert.equal(
  describeAppBuild({ version: "1.2.1", android: { versionCode: 25 }, extra: { releaseProfile: "preview" } }).detail,
  "Build non identifié · profil preview. Communiquez ces informations au support.",
);
assert.equal(describeAppBuild(null).value, "Version ?");

// L'écran Support (accessible à tous les rôles) affiche la carte.
const screen = fs.readFileSync(path.join(__dirname, "..", "screens", "MvpUtilityScreens.tsx"), "utf8");
assert.match(screen, /describeAppBuild\(Constants\.expoConfig/);
assert.match(screen, /Version de l'application/);

console.log("OK appBuildInfo: version, versionCode, build et profil affichés dans Support");
