/**
 * LOT 7 — contrats d'environnement Mobile (source unique, sans secrets).
 * URLs issues du dépôt (README / docs/preproduction.md / eas.json historique).
 */
"use strict";

const RELEASE_PROFILES = ["development", "preview", "preproduction", "production"];

/** API HTTPS réellement utilisées par Somafrik — ne pas inventer. */
const CANONICAL_API_URLS = {
  preview: "https://api-preprod.somafrik.app",
  preproduction: "https://api-preprod.somafrik.app",
  production: "https://api.somafrik.app",
};

const ANDROID_PACKAGE = "com.somafrik.app";
const IOS_BUNDLE_IDENTIFIER = "com.somafrik.app";
const APP_SLUG = "somafrik";
const APP_SCHEME = "somafrik";
const APP_VERSION = "1.2.1";
const ANDROID_VERSION_CODE = 13;

/** Nom launcher identique partout. L'environnement se distingue par le badge in-app. */
const DISPLAY_NAMES = {
  development: "Somafrik",
  preview: "Somafrik",
  preproduction: "Somafrik",
  production: "Somafrik",
};

const STORE_PROFILES = ["preproduction", "production"];
const HTTPS_ONLY_PROFILES = ["preview", "preproduction", "production"];

function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function isHttpsUrl(url) {
  return /^https:\/\//i.test(url);
}

function isForbiddenReleaseHost(url) {
  return /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i.test(url);
}

function resolveReleaseProfile(env = process.env) {
  const raw = String(
    env.EXPO_PUBLIC_RELEASE_PROFILE
      || env.EAS_BUILD_PROFILE
      || env.APP_ENV
      || "",
  )
    .trim()
    .toLowerCase();
  if (RELEASE_PROFILES.includes(raw)) return raw;
  return "development";
}

function resolveApiUrlForProfile(profile, env = process.env) {
  const explicit = {
    development: env.EXPO_PUBLIC_API_URL_DEV || env.EXPO_PUBLIC_API_URL,
    preview: env.EXPO_PUBLIC_API_URL_PREVIEW || env.EXPO_PUBLIC_API_URL,
    preproduction: env.EXPO_PUBLIC_API_URL_PREPRODUCTION || env.EXPO_PUBLIC_API_URL,
    production: env.EXPO_PUBLIC_API_URL_PRODUCTION || env.EXPO_PUBLIC_API_URL,
  }[profile];
  const normalized = normalizeBaseUrl(explicit);
  if (normalized) return normalized;
  if (profile === "development") return "";
  return CANONICAL_API_URLS[profile] || "";
}

function assertReleaseApiUrl(profile, url) {
  const normalized = normalizeBaseUrl(url);
  if (HTTPS_ONLY_PROFILES.includes(profile)) {
    if (!normalized) {
      throw new Error(`EXPO_PUBLIC_API_URL manquante pour le profil ${profile}.`);
    }
    if (!isHttpsUrl(normalized)) {
      throw new Error(`Le profil ${profile} exige une API HTTPS (reçu: ${normalized}).`);
    }
    if (isForbiddenReleaseHost(normalized)) {
      throw new Error(`Le profil ${profile} refuse localhost / émulateur / LAN (${normalized}).`);
    }
  }
  if (profile === "production" && normalized === CANONICAL_API_URLS.preproduction) {
    throw new Error("Le profil production ne peut pas utiliser l'API préproduction.");
  }
  if (
    (profile === "preproduction" || profile === "preview")
    && normalized === CANONICAL_API_URLS.production
  ) {
    throw new Error(`Le profil ${profile} ne peut pas utiliser l'API production.`);
  }
  if (profile === "preview" && normalized && normalized !== CANONICAL_API_URLS.preview) {
    throw new Error(
      `Le profil preview doit cibler ${CANONICAL_API_URLS.preview} (reçu: ${normalized}).`,
    );
  }
  return normalized;
}

function profileAllowsCleartext(profile) {
  return profile === "development";
}

function profileShowsEnvironmentBadge(profile) {
  return profile !== "production";
}

function artifactForProfile(profile) {
  if (profile === "development") return "apk-devclient";
  if (profile === "preview") return "apk";
  return "aab";
}

function distributionForProfile(profile) {
  if (profile === "development" || profile === "preview") return "internal";
  return "store";
}

module.exports = {
  RELEASE_PROFILES,
  CANONICAL_API_URLS,
  ANDROID_PACKAGE,
  IOS_BUNDLE_IDENTIFIER,
  APP_SLUG,
  APP_SCHEME,
  APP_VERSION,
  ANDROID_VERSION_CODE,
  DISPLAY_NAMES,
  STORE_PROFILES,
  HTTPS_ONLY_PROFILES,
  normalizeBaseUrl,
  isHttpsUrl,
  isForbiddenReleaseHost,
  resolveReleaseProfile,
  resolveApiUrlForProfile,
  assertReleaseApiUrl,
  profileAllowsCleartext,
  profileShowsEnvironmentBadge,
  artifactForProfile,
  distributionForProfile,
};
