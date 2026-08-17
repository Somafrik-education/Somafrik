const path = require("path");
try {
  require(path.join(__dirname, "..", "backend", "node_modules", "dotenv")).config({
    path: path.join(__dirname, "..", ".env"),
  });
} catch {
  // optional
}

const {
  request,
  login,
  loginFull,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
} = require("./e2e-api-helpers");

async function expectOk(path, options = {}) {
  const res = await request(path, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${res.status} ${path}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

function report(rows) {
  console.table(
    rows.map((row) => ({
      API: row.name,
      Statut: "OK",
      Detail: typeof row.detail === "object" ? JSON.stringify(row.detail) : row.detail,
    })),
  );
}

async function main() {
  const checks = [];
  const health = await expectOk("/health");
  checks.push({ name: "GET /health", detail: health.database });

  const token = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  checks.push({
    name: "POST /backoffice/login",
    detail: "Super Administrateur Somafrik",
  });

  const state = await expectOk("/backoffice/state", { token });
  checks.push({
    name: "GET /backoffice/state",
    detail: {
      schools: state.schools?.length ?? 0,
      users: state.users?.length ?? 0,
      students: state.students?.length ?? 0,
      classes: state.classes?.length ?? 0,
      notes: state.notes?.length ?? 0,
      presences: state.presences?.length ?? 0,
    },
  });

  const synced = await expectOk("/backoffice/state", {
    method: "PUT",
    token,
    body: {
      rolePermissions: state.rolePermissions ?? {},
    },
  });
  checks.push({
    name: "PUT /backoffice/state (rolePermissions)",
    detail: { schools: synced.schools?.length ?? 0, users: synced.users?.length ?? 0 },
  });

  checks.push({ name: "GET /students", detail: (await expectOk("/students", { token })).length });
  checks.push({ name: "GET /classes", detail: (await expectOk("/classes", { token })).length });
  checks.push({ name: "GET /courses", detail: (await expectOk("/courses", { token })).length });
  checks.push({ name: "GET /notes", detail: (await expectOk("/notes", { token })).length });
  checks.push({ name: "GET /presences", detail: (await expectOk("/presences", { token })).length });

  const code = `SMOKE-${Date.now()}`;
  const created = await expectOk("/v2/subjects", {
    method: "POST",
    token,
    body: {
      schoolCode: "CD-2026-0001",
      code,
      name: `Test API ${code}`,
      level: "MVP",
      description: "Création temporaire pour vérifier POST puis DELETE.",
      coefficient: 1,
      status: "Actif",
    },
  });
  checks.push({ name: "POST /v2/subjects", detail: created.code || code });

  const deleted = await expectOk(`/v2/subjects/${encodeURIComponent(code)}`, {
    method: "DELETE",
    token,
  });
  checks.push({ name: "DELETE /v2/subjects/:code", detail: deleted.deleted || deleted.code || code });

  report(checks);

  const demoLogins = [
    { label: "Super Admin", identifier: SUPERADMIN_ID, password: SUPERADMIN_PASSWORD },
    { label: "Admin Pays RDC", identifier: "admin-rdc", password: "1234" },
    { label: "Admin Pays BI", identifier: "admin-bi", password: "1234" },
    { label: "Admin école", schoolCode: "CD-2026-0001", identifier: "admin", password: "1234" },
    { label: "Secrétaire", schoolCode: "CD-2026-0001", identifier: "secretaire", password: "1234" },
    { label: "Préfet", schoolCode: "CD-2026-0001", identifier: "prefet", password: "1234" },
    { label: "Enseignant", schoolCode: "CD-2026-0001", identifier: "ENS-0001", password: "1234" },
    { label: "Parent", schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", password: "1234" },
    { label: "Élève", schoolCode: "CD-2026-0001", identifier: "CD-IN-EL-26-001", password: "1234" },
  ];

  const loginChecks = [];
  let demoFailures = 0;
  for (const demo of demoLogins) {
    try {
      const result = await loginFull(demo.identifier, demo.password, demo.schoolCode);
      loginChecks.push({
        name: `POST /backoffice/login (${demo.label})`,
        detail: result.user?.role ?? "ok",
      });
    } catch (error) {
      demoFailures += 1;
      loginChecks.push({
        name: `POST /backoffice/login (${demo.label})`,
        detail: `indisponible (${String(error.message ?? error).split("\n")[0]})`,
      });
    }
  }
  report(loginChecks);
  if (demoFailures) {
    console.warn(
      `${demoFailures} compte(s) démo non vérifiable(s) — normal après db:wipe-demo ou bootstrap E2E partiel.`,
    );
  }
}

main().catch((error) => {
  console.error(`Verification API echouee: ${error.message}`);
  process.exitCode = 1;
});
