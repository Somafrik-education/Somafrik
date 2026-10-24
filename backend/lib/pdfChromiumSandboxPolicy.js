"use strict";

/**
 * SEC-PDF-02 — politique explicite de sandbox Chromium pour le moteur PDF des
 * bulletins (`backend/services/bulletinPdfRenderer.js`).
 *
 * Variable : SOMAFRIK_PDF_CHROMIUM_SANDBOX
 *
 * | Valeur                         | Mode            | Effet                                                |
 * |--------------------------------|-----------------|------------------------------------------------------|
 * | (absente), `enabled`, `required` | required      | Sandbox exigée. Aucune relance sans sandbox.         |
 * | `disabled`, `insecure-local`   | insecure-local  | Sans sandbox. Refusé si NODE_ENV=production.         |
 * | `pdf-disabled`                 | pdf-disabled    | Génération PDF désactivée (retour arrière contrôlé). |
 * | toute autre valeur             | invalid         | Génération PDF refusée.                              |
 *
 * Changement de contrat (SEC-PDF-01 → SEC-PDF-02) : l'absence de la variable
 * signifiait « sans sandbox » ; elle signifie désormais « sandbox exigée ».
 * Un environnement incompatible (processus root, espaces de noms utilisateur
 * indisponibles) fait échouer la génération PDF explicitement, sans repli.
 */

const PDF_CHROMIUM_SANDBOX_ENV = "SOMAFRIK_PDF_CHROMIUM_SANDBOX";

const PDF_SANDBOX_MODES = Object.freeze({
  REQUIRED: "required",
  INSECURE_LOCAL: "insecure-local",
  PDF_DISABLED: "pdf-disabled",
  INVALID: "invalid",
});

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isProductionEnv(env) {
  return normalize(env.NODE_ENV) === "production";
}

/**
 * @returns {{ mode: string, source: "default" | "explicit", reason?: string }}
 */
function resolvePdfChromiumSandboxPolicy(env = process.env) {
  const raw = normalize(env[PDF_CHROMIUM_SANDBOX_ENV]);
  if (raw === "") {
    return { mode: PDF_SANDBOX_MODES.REQUIRED, source: "default" };
  }
  if (raw === "enabled" || raw === "required") {
    return { mode: PDF_SANDBOX_MODES.REQUIRED, source: "explicit" };
  }
  if (raw === "pdf-disabled") {
    return { mode: PDF_SANDBOX_MODES.PDF_DISABLED, source: "explicit" };
  }
  if (raw === "disabled" || raw === "insecure-local") {
    if (isProductionEnv(env)) {
      return { mode: PDF_SANDBOX_MODES.INVALID, source: "explicit", reason: "insecure_forbidden_in_production" };
    }
    return { mode: PDF_SANDBOX_MODES.INSECURE_LOCAL, source: "explicit" };
  }
  return { mode: PDF_SANDBOX_MODES.INVALID, source: "explicit", reason: "unknown_value" };
}

module.exports = {
  PDF_CHROMIUM_SANDBOX_ENV,
  PDF_SANDBOX_MODES,
  resolvePdfChromiumSandboxPolicy,
};
