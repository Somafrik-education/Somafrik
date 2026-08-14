"use strict";

/**
 * LOT 8 — BackOffice autonome retiré.
 * Plus de snapshot global côté client, plus de polling.
 */

const WEB_APP_PATH = "/web/";

function redirectToWebApp() {
  const path = window.location.pathname.toLowerCase();
  if (path === "/" || path.endsWith("/backoffice/") || path.endsWith("/backoffice")) {
    window.location.replace(WEB_APP_PATH);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", redirectToWebApp);
} else {
  redirectToWebApp();
}
