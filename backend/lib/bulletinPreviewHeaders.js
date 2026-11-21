"use strict";

/**
 * SEC-XSS-01 — en-têtes de la réponse d'aperçu HTML d'un modèle de bulletin.
 *
 * Le corps est du HTML non fiable (modèle écrit par un établissement). Si la
 * réponse est un jour ouverte directement par un navigateur, la directive CSP
 * `sandbox` lui donne une origine opaque, sans script ni formulaire, et
 * `default-src 'none'` coupe tout chargement réseau. Le Web l'affiche par
 * ailleurs dans une iframe sandbox (BulletinPreviewFrame).
 */
const BULLETIN_PREVIEW_RESPONSE_CSP = [
  "sandbox",
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const BULLETIN_PREVIEW_HEADERS = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": BULLETIN_PREVIEW_RESPONSE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
});

function applyBulletinPreviewHeaders(res) {
  for (const [name, value] of Object.entries(BULLETIN_PREVIEW_HEADERS)) {
    res.setHeader(name, value);
  }
}

module.exports = {
  BULLETIN_PREVIEW_HEADERS,
  BULLETIN_PREVIEW_RESPONSE_CSP,
  applyBulletinPreviewHeaders,
};
