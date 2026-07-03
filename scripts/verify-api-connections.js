const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${JSON.stringify(data)}`);
  }

  return data;
}

function report(rows) {
  console.table(rows.map((row) => ({
    API: row.name,
    Statut: "OK",
    Detail: typeof row.detail === "object" ? JSON.stringify(row.detail) : row.detail,
  })));
}

async function main() {
  const checks = [];
  const health = await request("/health");
  checks.push({ name: "GET /health", detail: health.database });

  const session = await request("/backoffice/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: process.env.SOMAFRIK_TEST_USER || "superadmin@somafrik.app",
      password: process.env.SOMAFRIK_TEST_PASSWORD || "1234",
      ...(process.env.SOMAFRIK_TEST_SCHOOL_CODE ? { schoolCode: process.env.SOMAFRIK_TEST_SCHOOL_CODE } : {}),
    }),
  });
  const token = session.accessToken;
  checks.push({ name: "POST /backoffice/login", detail: session.user?.role });

  const state = await request("/backoffice/state", { token });
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

  // Vérifie que le PUT accepte une mise à jour ciblée (matrice de droits) sans tronquer l'état.
  const synced = await request("/backoffice/state", {
    method: "PUT",
    token,
    body: JSON.stringify({
      rolePermissions: state.rolePermissions ?? {},
    }),
  });
  checks.push({
    name: "PUT /backoffice/state (rolePermissions)",
    detail: { schools: synced.schools?.length ?? 0, users: synced.users?.length ?? 0 },
  });

  checks.push({ name: "GET /students", detail: (await request("/students", { token })).length });
  checks.push({ name: "GET /classes", detail: (await request("/classes", { token })).length });
  checks.push({ name: "GET /courses", detail: (await request("/courses", { token })).length });
  checks.push({ name: "GET /notes", detail: (await request("/notes", { token })).length });
  checks.push({ name: "GET /presences", detail: (await request("/presences", { token })).length });

  const code = `SMOKE-${Date.now()}`;
  const created = await request("/v2/subjects", {
    method: "POST",
    token,
    body: JSON.stringify({
      schoolCode: "CD-2026-0001",
      code,
      name: `Test API ${code}`,
      level: "MVP",
      description: "Création temporaire pour vérifier POST puis DELETE.",
      coefficient: 1,
      status: "Actif",
    }),
  });
  checks.push({ name: "POST /v2/subjects", detail: created.code || code });

  const deleted = await request(`/v2/subjects/${encodeURIComponent(code)}`, {
    method: "DELETE",
    token,
  });
  checks.push({ name: "DELETE /v2/subjects/:code", detail: deleted.deleted || deleted.code || code });

  report(checks);

  const demoLogins = [
    { label: "Super Admin", payload: { identifier: "superadmin", password: "1234" } },
    { label: "Admin Pays RDC", payload: { identifier: "admin-rdc", password: "1234" } },
    { label: "Admin Pays BI", payload: { identifier: "admin-bi", password: "1234" } },
    { label: "Admin école", payload: { schoolCode: "CD-2026-0001", identifier: "admin", password: "1234" } },
    { label: "Secrétaire", payload: { schoolCode: "CD-2026-0001", identifier: "secretaire", password: "1234" } },
    { label: "Préfet", payload: { schoolCode: "CD-2026-0001", identifier: "prefet", password: "1234" } },
    { label: "Enseignant", payload: { schoolCode: "CD-2026-0001", identifier: "ENS-0001", password: "1234" } },
    { label: "Parent", payload: { schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", password: "1234" } },
    { label: "Élève", payload: { schoolCode: "CD-2026-0001", identifier: "ELE-0001", password: "1234" } },
  ];

  const loginChecks = [];
  for (const demo of demoLogins) {
    const result = await request("/backoffice/login", {
      method: "POST",
      body: JSON.stringify(demo.payload),
    });
    loginChecks.push({ name: `POST /backoffice/login (${demo.label})`, detail: result.user?.role ?? "ok" });
  }
  report(loginChecks);
}

main().catch((error) => {
  console.error(`Verification API echouee: ${error.message}`);
  process.exitCode = 1;
});
