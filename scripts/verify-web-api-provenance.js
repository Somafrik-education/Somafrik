#!/usr/bin/env node
/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 5 — cohérence Web / API d'un environnement déployé.
 *
 * Usage :
 *   node scripts/verify-web-api-provenance.js --web https://preprod.somafrik.app \
 *     --api https://api-preprod.somafrik.app [--expect <sha40>] [--marker "texte attendu"]...
 *
 * Contrôles :
 *  1. le Web publie build-info.json avec un SHA complet ;
 *  2. l'API publie gitSha dans /api/health ;
 *  3. Web et API ont le même SHA (sinon : écart de version, cf. audit #1193 / #1189) ;
 *  4. si --expect : les deux égalent le commit validé ;
 *  5. si --marker : chaque texte attendu figure dans le bundle Web servi.
 * Sortie non nulle au premier écart. Aucune écriture, aucun déploiement.
 */
"use strict";

const FULL_SHA = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
  const out = { markers: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--web") { out.web = value; i += 1; }
    else if (key === "--api") { out.api = value; i += 1; }
    else if (key === "--expect") { out.expect = String(value || "").toLowerCase(); i += 1; }
    else if (key === "--marker") { out.markers.push(value); i += 1; }
  }
  return out;
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

async function getText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);
  return response.text();
}

/** Extrait les URLs de scripts JS référencés (index.html puis imports des chunks, un niveau à la fois). */
function scriptRefs(text) {
  const refs = new Set();
  for (const match of text.matchAll(/["'](?:\.\/|\/)?(?:assets\/)?([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.js)["']/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

async function collectBundleText(fetchImpl, web, maxFiles = 400) {
  const html = await getText(fetchImpl, `${web}/`);
  const seen = new Set();
  const queue = scriptRefs(html);
  let text = "";
  while (queue.length && seen.size < maxFiles) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      const chunk = await getText(fetchImpl, `${web}/assets/${name}`);
      text += `\n${chunk}`;
      for (const ref of scriptRefs(chunk)) if (!seen.has(ref)) queue.push(ref);
    } catch {
      // Un chunk introuvable n'invalide pas le contrôle des autres ; le marqueur absent le signalera.
    }
  }
  return { text, files: seen.size };
}

async function verifyWebApiProvenance({ web, api, expect, markers = [] }, fetchImpl = globalThis.fetch) {
  const errors = [];
  const report = { web: trimSlash(web), api: trimSlash(api) };
  if (!report.web || !report.api) throw new Error("--web et --api sont obligatoires.");

  try {
    const info = JSON.parse(await getText(fetchImpl, `${report.web}/build-info.json`));
    report.webSha = FULL_SHA.test(String(info.gitSha || "")) ? info.gitSha : null;
    report.webBranch = info.gitBranch || null;
    if (!report.webSha) errors.push("WEB_SHA_ABSENT : build-info.json sans SHA complet (build antérieur à LOT 5 ?)");
  } catch (error) {
    report.webSha = null;
    errors.push(`WEB_BUILD_INFO_INDISPONIBLE : ${error.message}`);
  }

  try {
    const health = JSON.parse(await getText(fetchImpl, `${report.api}/api/health`));
    report.apiSha = FULL_SHA.test(String(health.gitSha || "")) ? health.gitSha : null;
    if (!report.apiSha) errors.push("API_SHA_ABSENT : /api/health sans gitSha (RENDER_GIT_COMMIT ?)");
  } catch (error) {
    report.apiSha = null;
    errors.push(`API_HEALTH_INDISPONIBLE : ${error.message}`);
  }

  if (report.webSha && report.apiSha && report.webSha !== report.apiSha) {
    errors.push(`VERSION_SKEW : Web ${report.webSha} ≠ API ${report.apiSha}`);
  }
  if (expect) {
    if (report.webSha && report.webSha !== expect) errors.push(`WEB_NON_VALIDE : ${report.webSha} ≠ attendu ${expect}`);
    if (report.apiSha && report.apiSha !== expect) errors.push(`API_NON_VALIDE : ${report.apiSha} ≠ attendu ${expect}`);
  }

  if (markers.length) {
    const bundle = await collectBundleText(fetchImpl, report.web);
    report.bundleFiles = bundle.files;
    report.markers = markers.map((marker) => ({ marker, present: bundle.text.includes(marker) }));
    for (const item of report.markers) {
      if (!item.present) errors.push(`MARQUEUR_ABSENT : « ${item.marker} »`);
    }
  }

  return { ok: errors.length === 0, errors, report };
}

module.exports = { parseArgs, scriptRefs, verifyWebApiProvenance };

if (require.main === module) {
  verifyWebApiProvenance(parseArgs(process.argv.slice(2)))
    .then(({ ok, errors, report }) => {
      console.log(JSON.stringify(report, null, 2));
      if (!ok) {
        for (const error of errors) console.error(`✗ ${error}`);
        process.exit(1);
      }
      console.log("✔ Web et API cohérents.");
    })
    .catch((error) => {
      console.error(`✗ ${error.message}`);
      process.exit(2);
    });
}
