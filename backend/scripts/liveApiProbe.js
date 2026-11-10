/**
 * RBAC-HTTP-MAINT-01 — disponibilité de l'API pour les vérifications HTTP « live ».
 *
 * Par défaut, une API absente fait sauter la partie HTTP (usage local). Avec
 * SOMAFRIK_HTTP_REQUIRED=true (job CI dédié), une API absente est un échec :
 * la couverture HTTP ne peut plus disparaître silencieusement.
 */
async function probeLiveApi(base, label) {
  let healthy = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const health = await fetch(`${base.replace(/\/api\/?$/, "")}/api/health`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    healthy = health.ok;
  } catch {
    healthy = false;
  }
  if (healthy) return true;
  if (process.env.SOMAFRIK_HTTP_REQUIRED === "true") {
    throw new Error(`${label}: API ${base} injoignable alors que SOMAFRIK_HTTP_REQUIRED=true`);
  }
  console.log("SKIP http: API non joignable");
  return false;
}

module.exports = { probeLiveApi };
