const fs = require("fs");
const path = require("path");
const assert = require("assert");

const target = path.join(__dirname, "verify-e2e-0012-parent-student-journey.js");
const source = fs.readFileSync(target, "utf8");

assert.match(
  source,
  /const PARENT_PASSWORD = "[^"]{8,}";/,
  "Le scénario Parent E2E doit déclarer un mot de passe de test canonique.",
);
assert.doesNotMatch(
  source,
  /PARENT_PIN|\bPIN\b/,
  "Le scénario Parent E2E ne doit plus contenir de contrat PIN.",
);
assert.match(
  source,
  /mobileLoginFull\("parent_student",[\s\S]*PARENT_PASSWORD/,
  "Le login Parent E2E doit utiliser PARENT_PASSWORD.",
);
assert.doesNotMatch(
  source,
  /\$\{PARENT_PASSWORD\}/,
  "Le mot de passe Parent E2E ne doit jamais être interpolé dans les logs.",
);
assert.match(
  source,
  /Liste des enfants du parent/,
  "Le smoke Parent doit conserver la vérification multi-enfants.",
);
assert.match(
  source,
  /Paiements limités aux enfants liés/,
  "Le smoke Parent doit conserver le contrôle d'isolation paiements.",
);

console.log("OK: contrat E2E Parent — password, multi-enfants, isolation");
