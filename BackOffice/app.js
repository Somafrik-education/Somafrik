"use strict";

/**
 * LOT 8 — BackOffice autonome retiré.
 * Plus de snapshot global côté client, plus de polling.
 */

const WEB_APP_PATH = "/web/";

function redirectToWebApp() {
  if (window.location.pathname === "/" || window.location.pathname.endsWith("/BackOffice/")) {
    window.location.replace(WEB_APP_PATH);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", redirectToWebApp);
} else {
  redirectToWebApp();
}
