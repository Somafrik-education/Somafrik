import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET = path.join(WEB_ROOT, "src/assets/somafrik-login-background.webp");
const PUBLIC_COPY = path.join(WEB_ROOT, "public/somafrik-login-background.webp");
const LOGIN_PAGE = path.join(WEB_ROOT, "src/pages/LoginPage.tsx");

describe("login background asset", () => {
  it("is a complete decodable WebP referenced via Vite import", () => {
    const bytes = fs.readFileSync(ASSET);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    const riffSize = bytes.readUInt32LE(4);
    assert.equal(
      bytes.length,
      riffSize + 8,
      `WebP tronqué : fichier=${bytes.length} octets, RIFF annonce ${riffSize + 8}`,
    );
    assert.ok(bytes.length > 40_000, `asset trop petit pour une photo (${bytes.length})`);
    assert.equal(fs.existsSync(PUBLIC_COPY), false, "public/ ne doit plus dupliquer l'asset");

    const source = fs.readFileSync(LOGIN_PAGE, "utf8");
    assert.match(source, /import loginBackground from "\.\.\/assets\/somafrik-login-background\.webp"/);
    assert.doesNotMatch(source, /new URL\(\s*["'].*somafrik-login-background/);
    assert.doesNotMatch(source, /url\(['"]\/somafrik-login-background\.webp['"]\)/);
    assert.match(source, /data-testid="login-background"/);
    assert.match(source, /onError=/);
  });
});
