"use strict";

const PRODUCTION_HOSTS = Object.freeze(["api.somafrik.app", "somafrik.app", "www.somafrik.app"]);
const INTERNAL_PATH_MARKERS = Object.freeze([
  "backend/",
  "Mobile/src",
  "postgresRepository",
  "/api/debug",
]);
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g;

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function assertNotProductionUrl(url, label = "url") {
  const host = hostnameOf(url);
  if (!host) {
    const error = new Error(`${label} invalide`);
    error.code = "PREPROD_URL_INVALID";
    throw error;
  }
  const blocked = PRODUCTION_HOSTS.includes(host);
  if (blocked) {
    const error = new Error(`${label} pointe vers la production (${host})`);
    error.code = "PREPROD_PRODUCTION_URL";
    throw error;
  }
  return host;
}

function maskSecret(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (text.length <= 6) return "***";
  return `${text.slice(0, 2)}…${text.slice(-2)}`;
}

function redactValue(value, key = "") {
  if (value == null) return value;
  const lower = String(key).toLowerCase();
  if (
    /password|secret|token|authorization|pin|jwt|cookie/i.test(lower) ||
    lower === "refreshtoken" ||
    lower === "accesstoken"
  ) {
    return typeof value === "string" ? maskSecret(value) : "[redacted]";
  }
  if (typeof value === "string") {
    return value.replace(JWT_RE, (match) => maskSecret(match));
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    const out = {};
    for (const [nextKey, nextValue] of Object.entries(value)) {
      out[nextKey] = redactValue(nextValue, nextKey);
    }
    return out;
  }
  return value;
}

function findLegalChunkName(indexJs) {
  const match = String(indexJs ?? "").match(/LegalPages-[A-Za-z0-9_-]+\.js/);
  return match ? match[0] : "";
}

function legalPageFindings(html, chunkJs) {
  const haystack = `${html || ""}\n${chunkJs || ""}`;
  const internal = INTERNAL_PATH_MARKERS.filter((marker) => haystack.includes(marker));
  return {
    hasOregon: haystack.includes("Oregon"),
    hasOperator: haystack.includes("Baudouin Okito"),
    hasContact: haystack.includes("contact@somafrik.app"),
    internalPaths: internal,
  };
}

function isPresentRouteStatus(status) {
  return Number(status) !== 404 && Number(status) !== 0;
}

module.exports = {
  PRODUCTION_HOSTS,
  INTERNAL_PATH_MARKERS,
  assertNotProductionUrl,
  maskSecret,
  redactValue,
  findLegalChunkName,
  legalPageFindings,
  isPresentRouteStatus,
};
