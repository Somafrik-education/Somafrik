"use strict";

// Render native Node builds: ~/.cache/puppeteer is not part of the deployed build.
// Keep the downloaded Chrome beside the backend so the runtime can resolve it.
// Docker deployments can still use PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium.
const path = require("node:path");

module.exports = {
  cacheDirectory: path.join(__dirname, ".cache", "puppeteer"),
};
