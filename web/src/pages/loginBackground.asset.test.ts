import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOGIN_PAGE = path.join(WEB_ROOT, "src/pages/LoginPage.tsx");

describe("login background", () => {
  it("uses the solid brand blue without a background image", () => {
    const source = fs.readFileSync(LOGIN_PAGE, "utf8");

    assert.match(
      source,
      /className="relative min-h-dvh overflow-x-hidden bg-brand md:overflow-hidden"/,
    );
    assert.doesNotMatch(source, /somafrik-login-background/);
    assert.doesNotMatch(source, /data-testid="login-background"/);
    assert.match(source, /profile: "school"/);
  });
});
