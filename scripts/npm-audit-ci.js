/**
 * S2.4 — Audit npm production : signaler tout, bloquer les critiques.
 *
 * Usage : npm run audit:ci
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PACKAGES = [
  { label: "root", cwd: ROOT, prefix: null },
  { label: "backend", cwd: path.join(ROOT, "backend"), prefix: "backend" },
  { label: "web", cwd: path.join(ROOT, "web"), prefix: "web" },
  { label: "Mobile", cwd: path.join(ROOT, "Mobile"), prefix: "Mobile" },
];

function runAudit(cwd, extraArgs) {
  return spawnSync("npm", ["audit", "--omit=dev", ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function summarize(label, reportResult) {
  if (reportResult.status === 0) {
    console.log(`[${label}] 0 vulnérabilités (omit=dev)`);
    return { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  }

  let payload = null;
  try {
    payload = JSON.parse(reportResult.stdout || "{}");
  } catch {
    console.log(`[${label}] audit non-JSON (exit ${reportResult.status})`);
    console.log(reportResult.stdout || reportResult.stderr || "");
    return null;
  }

  const vulns = payload.metadata?.vulnerabilities ?? {};
  const summary = {
    critical: Number(vulns.critical ?? 0),
    high: Number(vulns.high ?? 0),
    moderate: Number(vulns.moderate ?? 0),
    low: Number(vulns.low ?? 0),
    info: Number(vulns.info ?? 0),
  };

  console.log(
    `[${label}] critical=${summary.critical} high=${summary.high} moderate=${summary.moderate} low=${summary.low} info=${summary.info}`,
  );

  if (summary.moderate > 0 || summary.low > 0 || summary.info > 0 || summary.high > 0) {
    console.log(`[${label}] avis (non bloquant hors critical) : vulnérabilités signalées ci-dessus`);
  }

  return summary;
}

function main() {
  let failed = false;

  for (const pkg of PACKAGES) {
    console.log(`\n=== npm audit --omit=dev (${pkg.label}) ===`);
    const report = runAudit(pkg.cwd, ["--json"]);
    summarize(pkg.label, report);

    // Seules les vulnérabilités critical font échouer la CI.
    const blocking = runAudit(pkg.cwd, ["--audit-level=critical"]);
    if (blocking.status !== 0) {
      failed = true;
      console.error(`[${pkg.label}] ÉCHEC : vulnérabilité(s) critical détectée(s)`);
      if (blocking.stdout) console.error(blocking.stdout);
      if (blocking.stderr) console.error(blocking.stderr);
    } else {
      console.log(`[${pkg.label}] OK : aucune vulnérabilité critical`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log("\naudit:ci SUCCESS");
}

main();
