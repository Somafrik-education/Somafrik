"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CACHE_DIR = path.resolve(__dirname, "../../.cache/puppeteer");

function findPdfBrowserExecutable({ cacheDirectory = CACHE_DIR, platform = process.platform, env = process.env } = {}) {
  if (env.PUPPETEER_EXECUTABLE_PATH) return env.PUPPETEER_EXECUTABLE_PATH;
  const platformFolders = {
    linux: ["linux-", "chrome-linux64", "chrome"],
    darwin: ["mac-", "chrome-mac-x64", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
    win32: ["win64-", "chrome-win64", "chrome.exe"],
  };
  const parts = platformFolders[platform];
  if (!parts) return null;
  const chromeCache = path.join(cacheDirectory, "chrome");
  if (!fs.existsSync(chromeCache)) return null;
  const versions = fs.readdirSync(chromeCache).filter((name) => name.startsWith(parts[0])).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(chromeCache, version, parts[1], parts[2]);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

module.exports = { CACHE_DIR, findPdfBrowserExecutable };
