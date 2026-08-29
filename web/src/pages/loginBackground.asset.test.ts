import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET = path.join(WEB_ROOT, "src/assets/somafrik-login-background.png");
const WEBP = path.join(WEB_ROOT, "src/assets/somafrik-login-background.webp");
const PUBLIC_COPY = path.join(WEB_ROOT, "public/somafrik-login-background.webp");
const LOGIN_PAGE = path.join(WEB_ROOT, "src/pages/LoginPage.tsx");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("login background asset", () => {
  it("keeps the original PNG binary and imports it through Vite", () => {
    const bytes = fs.readFileSync(ASSET);
    assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "signature PNG invalide");
    assert.equal(bytes.length, 1_878_786, `taille inattendue: ${bytes.length}`);
    assert.equal(fs.existsSync(WEBP), false, "ne pas reconvertir en WebP pour ce correctif");
    assert.equal(fs.existsSync(PUBLIC_COPY), false, "public/ ne doit plus dupliquer l'asset");

    const source = fs.readFileSync(LOGIN_PAGE, "utf8");
    assert.match(source, /import loginBackground from "\.\.\/assets\/somafrik-login-background\.png"/);
    assert.doesNotMatch(source, /somafrik-login-background\.webp/);
    assert.doesNotMatch(source, /new URL\(\s*["'].*somafrik-login-background/);
    assert.match(source, /data-testid="login-background"/);
    assert.match(source, /onError=/);
    assert.match(source, /profile: "school"/);
  });
});
