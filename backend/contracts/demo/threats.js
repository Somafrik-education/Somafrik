"use strict";

/**
 * Modèle de menaces Démo — DEMO-0.
 * Les lots suivants doivent conserver ces mitigations ; ils ne les affaiblissent pas.
 */

const THREATS = Object.freeze([
  Object.freeze({
    id: "T1_JWT_IN_URL",
    title: "JWT ou access token dans l’URL d’entrée Demo",
    impact: "Fuite via logs proxy, Referer, historique, analytics.",
    mitigation: "Code opaque one-shot nommé `code` ; rejet inchangé de `token` / `access_token`.",
    gate: "jwt-never-in-url",
  }),
  Object.freeze({
    id: "T2_DEMO_ON_PROD_CORS",
    title: "Origine Demo ajoutée au CORS production",
    impact: "Le navigateur Demo peut appeler l’API PROD.",
    mitigation: "APP_ENV=demo isolé ; production n’autorise jamais demo.somafrik.app.",
    gate: "cors-demo-not-on-production",
  }),
  Object.freeze({
    id: "T3_LEGACY_SEED_REUSED",
    title: "Réactivation de demoSeedPolicy sur le serveur Demo",
    impact: "Comptes techniques locaux exposés, collision avec la protection production.",
    mitigation: "SOMAFRIK_SKIP_DEMO_SEED=true reste obligatoire si NODE_ENV=production ; reset = demo:reset.",
    gate: "legacy-seed-never-reused",
  }),
  Object.freeze({
    id: "T4_SHARED_SECRETS",
    title: "JWT_SECRET / stockage / webhooks partagés avec PROD",
    impact: "Confusion de tokens, fuite de données réelles.",
    mitigation: "Secrets, DB, stockage et webhooks dédiés à APP_ENV=demo.",
    gate: "no-shared-secrets-with-prod",
  }),
  Object.freeze({
    id: "T5_DEMO_INDEXED",
    title: "Indexation de demo.somafrik.app",
    impact: "Données scolaires fictives et écrans métier dans Google.",
    mitigation: "noindex,nofollow + X-Robots-Tag à l’hébergement Demo.",
    gate: "demo-app-noindex",
  }),
  Object.freeze({
    id: "T6_IFRAME_EMBED",
    title: "Embarquement de la Demo dans un site tiers",
    impact: "Usurpation de marque, clickjacking.",
    mitigation: "CSP frame-ancestors 'none' + X-Frame-Options DENY.",
    gate: "csp-frame-ancestors-none",
  }),
  Object.freeze({
    id: "T7_REAL_EXTERNALITIES",
    title: "SMS, e-mail, paiement, WhatsApp ou webhooks réels",
    impact: "Coûts, messages à de vrais destinataires, flux financiers.",
    mitigation: "Sandbox / simulation obligatoire en SOMAFRIK_DEMO_MODE.",
    gate: "sandbox-externalities",
  }),
  Object.freeze({
    id: "T8_PLATFORM_SUPERADMIN",
    title: "Accès Superadmin plateforme depuis la Demo publique",
    impact: "Contrôle de la plateforme Demo, confusion avec la prod.",
    mitigation: "Rôle Superadmin plateforme inaccessible dans le dataset public.",
    gate: "sandbox-externalities",
  }),
  Object.freeze({
    id: "T9_CAPTURE_AS_REAL",
    title: "Capture d’écran présentée comme des données réelles",
    impact: "Désinformation ; les données Demo sont fictives.",
    mitigation: "Watermark sans PII ; FLAG_SECURE Android ; iOS honnête (pas de faux blocage).",
    gate: "watermark-no-pii",
  }),
  Object.freeze({
    id: "T10_TRIAL_FRICTION_ON_DEMO",
    title: "Téléphone / e-mail obligatoires sur /demo",
    impact: "Friction inutile, collecte de PII sans besoin pour une découverte.",
    mitigation: "Qualification courte : profil, rôle de découverte, pays. Essai 30 jours reste /demande-essai.",
    gate: "qualification-no-required-phone-email",
  }),
  Object.freeze({
    id: "T11_DEV_ACCOUNTS_FLAG",
    title: "Réutilisation de VITE_SHOW_DEMO_ACCOUNTS",
    impact: "Confusion comptes techniques locaux / environnement public Démo.",
    mitigation: "VITE_DEMO_ENV_URL + APP_ENV=demo + SOMAFRIK_DEMO_MODE.",
    gate: "vite-show-demo-accounts-not-reused",
  }),
  Object.freeze({
    id: "T12_LONG_LIVED_SESSION",
    title: "Session Demo longue ou non révocable",
    impact: "Mutations persistantes, abus, bots.",
    mitigation: "Sessions courtes, révocables, rate-limit et anti-bot sur le mint.",
    gate: "opaque-code-not-jwt",
  }),
  Object.freeze({
    id: "T13_SHARED_DATABASE",
    title: "PostgreSQL partagé avec PROD ou PREPROD",
    impact: "Fuite ou corruption de données réelles.",
    mitigation: "Base Demo dédiée ; aucune connexion PROD/PREPROD.",
    gate: "dedicated-demo-database",
  }),
  Object.freeze({
    id: "T14_PREPROD_AS_DEMO",
    title: "Bouton vitrine vers une copie de préproduction",
    impact: "Mélange des frontières, données de test internes exposées.",
    mitigation: "Frontière Demo autonome ; PREPROD n’est pas l’environnement public.",
    gate: "demo-not-preprod-copy",
  }),
]);

const THREAT_IDS = Object.freeze(THREATS.map((threat) => threat.id));

module.exports = {
  THREATS,
  THREAT_IDS,
};
