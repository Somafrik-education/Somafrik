const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "apps/api/README.md",
  "apps/web/README.md",
  "apps/mobile/README.md",
  "packages/auth/README.md",
  "packages/database/README.md",
  "packages/domain/package.json",
  "packages/shared/README.md",
  "tests/v2/README.md",
  "docs/project/V2-RECONSTRUCTION.md",
];
const sourceExtensions = new Set([".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx"]);
const forbiddenPatterns = [
  {
    label: "legacy source import",
    expression:
      /(?:from\s+|require\s*\(|import\s*\()\s*["'][^"']*(?:backend|web|Mobile|BackOffice)(?:\/|["'])/,
  },
  {
    label: "legacy state endpoint",
    expression: /\/(?:api\/)?backoffice\/state/,
  },
  {
    label: "legacy state table",
    expression: /\bbackoffice_state\b/,
  },
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return [target];
  });
}

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missingFiles.length > 0) {
  throw new Error(`V2 foundation is incomplete:\n- ${missingFiles.join("\n- ")}`);
}

const violations = [];
for (const file of [...walk(path.join(root, "apps")), ...walk(path.join(root, "packages"))]) {
  if (!sourceExtensions.has(path.extname(file))) continue;
  const contents = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.expression.test(contents)) {
      violations.push(`${path.relative(root, file)}: ${pattern.label}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`V2 boundary violations:\n- ${violations.join("\n- ")}`);
}

console.log("V2 foundation verified: required roots present and legacy boundaries respected.");
