"use strict";

const fs = require("node:fs");

function patchFile(path, replacements) {
  let content = fs.readFileSync(path, "utf8");
  for (const [before, after] of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Patch anchor missing in ${path}: ${before.slice(0, 100)}`);
    }
    content = content.replace(before, after);
  }
  fs.writeFileSync(path, content);
}

patchFile("backend/services/authService.js", [
  [
`    this.assertSchoolCanConnect(schoolCode);\n\n    const managedUser = this.findManagedUser(identifier, schoolCode);`,
`    const schoolContext = this.assertSchoolCanConnect(schoolCode);\n    const accountSchoolCode = this.resolveSchoolAccountCode(schoolContext);\n\n    const managedUser = this.findManagedUser(identifier, accountSchoolCode);`,
  ],
  [
`    const schoolContext = this.assertSchoolCanConnect(schoolCode);\n\n    const loginKey = getLoginAttemptKey(schoolCode, identifier);`,
`    const schoolContext = this.assertSchoolCanConnect(schoolCode);\n    const accountSchoolCode = this.resolveSchoolAccountCode(schoolContext);\n    const canonicalSchoolCode = schoolContext.loginCode || schoolCode;\n\n    const loginKey = getLoginAttemptKey(canonicalSchoolCode, identifier);`,
  ],
  [
`    const managedUser = this.findManagedUser(identifier, schoolCode, role);`,
`    const managedUser = this.findManagedUser(identifier, accountSchoolCode, role);`,
  ],
  [
`    const { assertSchoolCanConnect } = require("./schoolSubscriptionAccessService");\n    assertSchoolCanConnect(schoolCode, {`,
`    const { assertSchoolCanConnect } = require("./schoolSubscriptionAccessService");\n    assertSchoolCanConnect(this.resolveSchoolAccountCode(school), {`,
  ],
  [
`  matchesSchoolCode(schoolCode) {\n    return Boolean(this.findSchoolByCode(schoolCode));\n  }`,
`  resolveSchoolAccountCode(school) {\n    return String(school?.code ?? school?.legacySchoolCode ?? school?.publicId ?? "").trim().toUpperCase();\n  }\n\n  matchesSchoolCode(schoolCode) {\n    return Boolean(this.findSchoolByCode(schoolCode));\n  }`,
  ],
  [
`      [school.code, school.publicId].some(`,
`      [school.loginCode, school.code, school.publicId, school.legacySchoolCode].some(`,
  ],
]);

patchFile("backend/services/backOfficeAccessService.js", [
  [
`    const normalizedSchoolCode = String(schoolCode ?? "").trim().toUpperCase();`,
`    const normalizedSchoolCode = this.resolveAccountSchoolCode(schoolCode);`,
  ],
  [
`  resolveSchoolContext(schoolCode, { forPlatformAdmin = false } = {}) {\n    const normalizedCode = String(schoolCode).trim().toUpperCase();\n    const school = this.schools.find((item) =>\n      [item.code, item.publicId].some(\n        (value) => String(value ?? "").trim().toUpperCase() === normalizedCode\n      )\n    );`,
`  findSchoolByAnyCode(schoolCode) {\n    const normalizedCode = String(schoolCode ?? "").trim().toUpperCase();\n    if (!normalizedCode) return undefined;\n    return this.schools.find((item) =>\n      [item.loginCode, item.code, item.publicId, item.legacySchoolCode].some(\n        (value) => String(value ?? "").trim().toUpperCase() === normalizedCode\n      )\n    );\n  }\n\n  resolveAccountSchoolCode(schoolCode) {\n    const school = this.findSchoolByAnyCode(schoolCode);\n    return String(school?.code ?? schoolCode ?? "").trim().toUpperCase();\n  }\n\n  resolveSchoolContext(schoolCode, { forPlatformAdmin = false } = {}) {\n    const school = this.findSchoolByAnyCode(schoolCode);`,
  ],
  [
`    const scopedSchoolCode = resolvedSchoolCode || user.schoolCode || "";`,
`    const scopedSchoolCode = schoolContext?.code || resolvedSchoolCode || user.schoolCode || "";`,
  ],
]);

console.log("Canonical school login auth patch applied");
