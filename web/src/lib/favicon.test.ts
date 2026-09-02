import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(webRoot, "public");
const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");

const LEGACY_TAB_ICON_SHA256 =
  "28dc5b632b3bb5872c52ac594c1ce7915fbdaa299b56a755e1c66051c88bda61";
const LEGACY_FAVICON_PNG_SHA256 =
  "79242492319dce59483acbe463226391b45bac371e1c6e73a9d948a70effad3b";

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function pngSize(filePath: string): { width: number; height: number } {
  const header = fs.readFileSync(filePath);
  assert.equal(header.subarray(0, 8).toString("binary"), "\x89PNG\r\n\x1a\n");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

describe("favicon Web Somafrik", () => {
  it("pointe les onglets vers les assets racine, pas un PNG relatif", () => {
    assert.match(html, /rel="icon" href="%BASE_URL%favicon\.ico"/);
    assert.match(html, /rel="icon" type="image\/png" sizes="32x32" href="%BASE_URL%favicon-32\.png"/);
    assert.match(html, /rel="icon" type="image\/png" sizes="192x192" href="%BASE_URL%favicon\.png"/);
    assert.match(html, /rel="apple-touch-icon" href="%BASE_URL%somafrik-icon\.png"/);
    assert.doesNotMatch(html, /href="somafrik-icon\.png"/);
  });

  it("sert le pictogramme livre / toque / stylo, pas le favicon école + famille", () => {
    const icon = path.join(publicDir, "somafrik-icon.png");
    const png192 = path.join(publicDir, "favicon.png");
    const png32 = path.join(publicDir, "favicon-32.png");
    const ico = path.join(publicDir, "favicon.ico");

    assert.notEqual(sha256(icon), LEGACY_TAB_ICON_SHA256);
    assert.notEqual(sha256(png192), LEGACY_FAVICON_PNG_SHA256);
    assert.equal(pngSize(icon).width, 512);
    assert.equal(pngSize(icon).height, 512);
    assert.equal(pngSize(png192).width, 192);
    assert.equal(pngSize(png192).height, 192);
    assert.equal(pngSize(png32).width, 32);
    assert.equal(pngSize(png32).height, 32);

    const icoBytes = fs.readFileSync(ico);
    assert.equal(icoBytes.readUInt16LE(0), 0);
    assert.equal(icoBytes.readUInt16LE(2), 1);
    assert.equal(icoBytes.readUInt16LE(4), 3);
  });

  it("ne laisse aucune référence HTML active vers l'ancien pictogramme d'onglet", () => {
    const source = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
    assert.doesNotMatch(source, /href="somafrik-icon\.png"/);
    assert.doesNotMatch(source, /schoollink-logo/);
  });
});
