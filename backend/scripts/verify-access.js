const assert = require("assert");

const baseUrl = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";

const accounts = {
  superadmin: {
    loginPath: "/backoffice/login",
    payload: { identifier: "superadmin", password: "1234" },
  },
  countryAdmin: {
    loginPath: "/backoffice/login",
    payload: { identifier: "admin-rdc", password: "1234" },
  },
  countryAdminBi: {
    loginPath: "/backoffice/login",
    payload: { identifier: "admin-bi", password: "1234" },
  },
  schoolAdmin: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "admin", password: "1234" },
  },
  secretary: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "secretaire", password: "1234" },
  },
  prefet: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "prefet", password: "1234" },
  },
  teacherWeb: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "ENS-0001", password: "1234" },
  },
  parentWeb: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", password: "1234" },
  },
  studentWeb: {
    loginPath: "/backoffice/login",
    payload: { schoolCode: "CD-2026-0001", identifier: "CD-IN-EL-26-001", password: "1234" },
  },
  teacher: {
    loginPath: "/login",
    payload: { role: "teacher", schoolCode: "CD-2026-0001", identifier: "ENS-0001", pin: "1234" },
  },
  parent: {
    loginPath: "/login",
    payload: { role: "parent_student", schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", pin: "1234" },
  },
  student: {
    loginPath: "/login",
    payload: { role: "student", schoolCode: "CD-2026-0001", identifier: "CD-IN-EL-26-001", pin: "1234" },
  },
};

const routes = [
  { method: "GET", path: "/backoffice/state", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb"] },
  { method: "GET", path: "/school", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb", "teacher", "parent", "student"] },
  { method: "GET", path: "/classes", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb", "teacher", "parent", "student"] },
  { method: "GET", path: "/students?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb", "teacher", "parent", "student"] },
  { method: "GET", path: "/teachers?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet"] },
  { method: "GET", path: "/users?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "prefet"] },
  { method: "GET", path: "/payments?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "parentWeb", "studentWeb", "parent", "student"] },
  { method: "GET", path: "/backoffice/countries", allow: ["superadmin", "countryAdmin", "countryAdminBi"] },
  { method: "GET", path: "/backoffice/subscriptions?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi"] },
  { method: "GET", path: "/backoffice/notifications?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi"] },
  { method: "GET", path: "/audit?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi"] },
  { method: "GET", path: "/v2/subjects?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "prefet", "teacherWeb", "teacher"] },
  { method: "GET", path: "/v2/academic-years?page=1&limit=5", allow: ["superadmin", "schoolAdmin", "prefet", "teacherWeb", "teacher"] },
  { method: "GET", path: "/v2/exams?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "prefet", "teacherWeb", "teacher"] },
  { method: "GET", path: "/v2/documents?page=1&limit=5", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb", "teacher", "parent", "student"] },
  { method: "GET", path: "/v2/reports/advanced", allow: ["superadmin", "countryAdmin", "countryAdminBi", "schoolAdmin", "secretary", "prefet", "teacherWeb", "parentWeb", "studentWeb", "teacher", "parent", "student"] },
];

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, payload };
}

async function login(account) {
  const result = await request(account.loginPath, { method: "POST", body: account.payload });
  assert.strictEqual(result.status, 200, JSON.stringify(result.payload));
  assert.ok(result.payload.accessToken, "accessToken manquant");
  return result.payload.accessToken;
}

async function main() {
  const tokens = {};
  for (const [name, account] of Object.entries(accounts)) {
    tokens[name] = await login(account);
  }

  const results = [];
  for (const route of routes) {
    for (const name of Object.keys(accounts)) {
      const result = await request(route.path, { method: route.method, token: tokens[name] });
      const shouldAllow = route.allow.includes(name);
      const ok = shouldAllow ? result.status >= 200 && result.status < 300 : result.status === 403;
      results.push({
        account: name,
        route: `${route.method} ${route.path}`,
        expected: shouldAllow ? "allow" : "deny",
        status: result.status,
        ok,
      });
    }
  }

  const failures = results.filter((result) => !result.ok);
  console.table(results);
  if (failures.length) {
    console.error("Access matrix failures:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
