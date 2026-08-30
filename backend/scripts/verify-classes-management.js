"use strict";

/**
 * Vérification API Classes (mémoire) :
 * Admin School crée / liste / patch ;
 * isolation réelle entre deux établissements (CD + BI) ;
 * PATCH cross-tenant → 404.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19551;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);

    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");

    const cd = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-IN-26-001",
      countryCode: "CD",
      levelName: "6ème",
    });
    const bi = await prepareCanonicalClassContext(request, {
      schoolCode: "BI-ESB-26-001",
      countryCode: "BI",
      levelName: "5ème",
    });

    const createdCd = await postCanonicalClass(request, cd.schoolToken, {
      academicYearId: cd.academicYear.id,
      levelId: cd.level.id,
      groupId: cd.group.id,
      status: "active",
    });
    assert.equal(createdCd.status, 201, JSON.stringify(createdCd.data));
    assert.match(createdCd.data.classCode, /^CLS-/);
    assert.equal(createdCd.data.status, "active");
    assert.equal(createdCd.data.schoolCode, "CD-IN-26-001");
    assert.equal(createdCd.data.name, "6ème");

    const createdBi = await postCanonicalClass(request, bi.schoolToken, {
      academicYearId: bi.academicYear.id,
      levelId: bi.level.id,
      groupId: bi.group.id,
      status: "active",
    });
    assert.equal(createdBi.status, 201, JSON.stringify(createdBi.data));
    assert.equal(createdBi.data.schoolCode, "BI-ESB-26-001");

    const listedCd = await request("/classes", { token: cd.schoolToken });
    assert.equal(listedCd.status, 200);
    assert.ok(listedCd.data.some((row) => row.classCode === createdCd.data.classCode));
    assert.ok(!listedCd.data.some((row) => row.classCode === createdBi.data.classCode));

    const listedBi = await request("/classes", { token: bi.schoolToken });
    assert.equal(listedBi.status, 200);
    assert.ok(listedBi.data.some((row) => row.classCode === createdBi.data.classCode));
    assert.ok(!listedBi.data.some((row) => row.classCode === createdCd.data.classCode));

    const patched = await request(`/classes/${encodeURIComponent(createdCd.data.classCode)}`, {
      method: "PATCH",
      token: cd.schoolToken,
      body: { status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.status, "inactive");

    const crossPatch = await request(`/classes/${encodeURIComponent(createdCd.data.classCode)}`, {
      method: "PATCH",
      token: bi.schoolToken,
      body: { status: "active" },
    });
    assert.equal(crossPatch.status, 404, JSON.stringify(crossPatch.data));

    const duplicate = await postCanonicalClass(request, cd.schoolToken, {
      academicYearId: cd.academicYear.id,
      levelId: cd.level.id,
      groupId: cd.group.id,
      status: "active",
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));

    const groupB = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-IN-26-001",
      countryCode: "CD",
      groupCode: "B",
    });
    const createdCdB = await postCanonicalClass(request, cd.schoolToken, {
      academicYearId: groupB.academicYear.id,
      levelId: groupB.level.id,
      groupId: groupB.group.id,
      status: "active",
    });
    assert.equal(createdCdB.status, 201, JSON.stringify(createdCdB.data));
    assert.equal(createdCdB.data.groupCode, "B");
    assert.equal(createdCdB.data.name, createdCd.data.name);

    const freeGroupCode = await request("/classes", {
      method: "POST",
      token: cd.schoolToken,
      body: {
        academicYearId: cd.academicYear.id,
        levelId: cd.level.id,
        groupCode: "XYZ",
        status: "active",
      },
    });
    assert.equal(freeGroupCode.status, 400, JSON.stringify(freeGroupCode.data));
    assert.equal(freeGroupCode.data?.code, "CLASS_FREE_TEXT_FORBIDDEN");

    const unknownGroup = await request("/classes", {
      method: "POST",
      token: cd.schoolToken,
      body: {
        academicYearId: cd.academicYear.id,
        levelId: cd.level.id,
        groupId: "00000000-0000-4000-8000-000000000xyz".replace("xyz", "001"),
        status: "active",
      },
    });
    assert.ok([400, 403].includes(unknownGroup.status), JSON.stringify(unknownGroup.data));

    const crossCountryGroup = await request("/classes", {
      method: "POST",
      token: bi.schoolToken,
      body: {
        academicYearId: bi.academicYear.id,
        levelId: bi.level.id,
        groupId: cd.group.id,
        status: "active",
      },
    });
    assert.ok([400, 403].includes(crossCountryGroup.status), JSON.stringify(crossCountryGroup.data));

    const adminCreateGroup = await request("/backoffice/education-class-groups", {
      method: "POST",
      token: cd.schoolToken,
      body: { countryCode: "CD", code: "Z", name: "Z" },
    });
    assert.equal(adminCreateGroup.status, 403, JSON.stringify(adminCreateGroup.data));

    const freeText = await request("/classes", {
      method: "POST",
      token: cd.schoolToken,
      body: {
        name: "Toto classe",
        academicYearName: "2025-2026",
        level: "NIVEAU INVENTÉ",
        section: "XYZ",
      },
    });
    assert.equal(freeText.status, 400);

    const forbiddenStatus = await postCanonicalClass(request, cd.schoolToken, {
      academicYearId: cd.academicYear.id,
      levelId: cd.level.id,
      groupId: cd.group.id,
      status: "Active",
    });
    assert.equal(forbiddenStatus.status, 400);

    console.log("verify-classes-management: SUCCESS");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
    if (stderr && process.env.DEBUG_CLASSES_VERIFY) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
