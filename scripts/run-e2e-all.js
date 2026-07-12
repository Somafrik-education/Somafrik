/**
 * Suite E2E complète : API puis mobile (mobile ignoré si serveur absent).
 *   npm run verify:e2e-all
 */
const { spawnSync } = require("child_process");

function run(script) {
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      SOMAFRIK_E2E: process.env.SOMAFRIK_E2E ?? "true",
    },
  });
  return result.status ?? 1;
}

function main() {
  const apiCode = run("verify:e2e-api");
  const mobileCode = run("verify:e2e-mobile");

  if (apiCode !== 0) {
    process.exit(apiCode);
  }
  process.exit(mobileCode);
}

main();
