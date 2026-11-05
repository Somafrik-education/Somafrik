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
 * | `disabled`, `insecure-local`   | insecure-local  | Sans sandbox, poste local uniquement (garde ci-dessous). |
 * | `pdf-disabled`                 | pdf-disabled    | Génération PDF désactivée (retour arrière contrôlé). |
 * | toute autre valeur             | invalid         | Génération PDF refusée.                              |
 *
 * Garde locale du mode sans sandbox — toutes les conditions sont requises :
 * - NODE_ENV vaut exactement `development` ou `test` (vide ou autre → refus) ;
 * - APP_ENV absent ou `local` / `development` / `test` / `ci`
 *   (`preproduction`, `production`, `demo` ou toute autre valeur → refus) ;
 * - variable `RENDER` absente (Render la définit sur ses services).
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

const LOCAL_NODE_ENVS = new Set(["development", "test"]);
const LOCAL_APP_ENVS = new Set(["", "local", "development", "test", "ci"]);

/** Raison du refus du mode sans sandbox, ou null si l'environnement est local. */
function insecureLocalRefusal(env) {
  if (!LOCAL_NODE_ENVS.has(normalize(env.NODE_ENV))) return "insecure_requires_local_node_env";
  if (!LOCAL_APP_ENVS.has(normalize(env.APP_ENV))) return "insecure_forbidden_app_env";
  if (normalize(env.RENDER) !== "") return "insecure_forbidden_on_render";
  return null;
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
    const refusal = insecureLocalRefusal(env);
    if (refusal) {
      return { mode: PDF_SANDBOX_MODES.INVALID, source: "explicit", reason: refusal };
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
