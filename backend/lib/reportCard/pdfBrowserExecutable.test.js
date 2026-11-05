"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findPdfBrowserExecutable } = require("./pdfBrowserExecutable");

test("locates installed Chrome and refuses missing installs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-chrome-"));
  try {
    assert.equal(findPdfBrowserExecutable({ cacheDirectory: dir, platform: "linux", env: {} }), null);
    const binary = path.join(dir, "chrome", "linux-155.0.8059.39", "chrome-linux64", "chrome");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "fixture");
    assert.equal(findPdfBrowserExecutable({ cacheDirectory: dir, platform: "linux", env: {} }), binary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit Chromium override remains honored", () => {
  assert.equal(findPdfBrowserExecutable({ env: { PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium" } }), "/usr/bin/chromium");
});
