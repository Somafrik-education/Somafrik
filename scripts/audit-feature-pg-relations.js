"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DOMAIN_LOADERS = fs.readFileSync(path.join(ROOT, "web", "src", "lib", "domainLoaders.ts"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");

function walkSql(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkSql(full));
    else if (/\.sql$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const SQL_FILES = [...walkSql(path.join(ROOT, "backend", "db")), ...walkSql(path.join(ROOT, "backend", "migrations"))];
const SQL_CORPUS = [...new Set(SQL_FILES)]
  .map((file) => `\n-- ${path.relative(ROOT, file)}\n${fs.readFileSync(file, "utf8")}`)
  .join("\n");

const manifest = [
  ["schools", ["/backoffice/establishments"], ["schools", "countries"]],
  ["countries", ["/backoffice/countries"], ["countries"]],
  ["subscriptions", ["/backoffice/subscriptions"], ["subscriptions"]],
  ["notifications", ["/backoffice/notifications"], ["notifications"]],
  ["rolePermissions", ["/backoffice/role-permissions"], ["role_permissions"]],
  ["dashboardChartConfig", ["/backoffice/dashboard-chart-config"], ["dashboard_chart_config"]],
  ["users", ["/backoffice/users"], ["users", "user_roles", "schools"]],
  ["contacts", ["/backoffice/contacts"], ["contacts", "users", "schools"]],
  ["relations", ["/backoffice/relations"], ["contact_relations", "contacts", "students"]],
  ["messages", ["/backoffice/messages"], ["school_messages", "school_conversations", "school_conversation_participants"]],
  ["announcements", ["/backoffice/announcements"], ["announcements", "schools"]],
  ["students", ["/students"], ["students", "enrollments", "schools"]],
  ["teachers", ["/teachers"], ["teachers", "users", "teacher_assignments"]],
  ["classes", ["/classes"], ["classes", "academic_years", "schools"]],
  ["courses", ["/courses"], ["school_courses", "subjects", "teachers"]],
  ["courseSchedules", ["/course-schedules"], ["course_schedule_slots", "classes", "teachers"]],
  ["assignments", ["/assignments"], ["teacher_assignments", "teachers", "classes"]],
  ["payments", ["/payments"], ["payments", "payment_allocations", "students"]],
  ["paymentStatuses", ["/finance/payment-statuses"], ["payment_statuses"]],
  ["feeGrids", ["/finance/fee-grids"], ["fee_grids", "school_fee_items"]],
  ["studentFees", ["/finance/student-fees"], ["student_fee_obligations", "students"]],
  ["notes", ["/notes"], ["grades", "evaluations", "students"]],
  ["evaluations", ["/evaluations"], ["evaluations", "classes", "subjects", "terms", "teacher_assignments"]],
  ["presences", ["/presences"], ["attendance", "students"]],
  ["academicConfigs", ["/academic-config", "/backoffice/establishments/:schoolCode/academic-config"], ["school_academic_configs", "schools"]],
  ["exams", ["/exams"], ["exams", "classes", "subjects"]],
  ["bulletins", ["/report-cards"], ["report_cards", "students"]],
  ["documents", ["/school-documents"], ["school_documents", "schools"]],
];

function hasRouteToken(token) {
  const variants = [token, `/api${token}`];
  return variants.some((variant) => DOMAIN_LOADERS.includes(variant) || SERVER.includes(variant));
}

function tableDeclared(table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${escaped}\\b`, "i").test(SQL_CORPUS) || new RegExp(`CREATE\\s+TABLE\\s+${escaped}\\b`, "i").test(SQL_CORPUS);
}

function foreignKeyEvidence(table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`REFERENCES\\s+${escaped}\\s*\\(`, "i").test(SQL_CORPUS);
}

const rows = manifest.map(([domain, routes, tables]) => {
  const routeEvidence = routes.map((route) => ({ route, found: hasRouteToken(route) }));
  const tableEvidence = tables.map((table) => ({ table, declared: tableDeclared(table), referencedByForeignKey: foreignKeyEvidence(table) }));
  const missingRoutes = routeEvidence.filter((entry) => !entry.found).map((entry) => entry.route);
  const missingTables = tableEvidence.filter((entry) => !entry.declared).map((entry) => entry.table);
  let verdict = "CANONICAL_CANDIDATE";
  if (missingRoutes.length && missingTables.length) verdict = "NO_API_NO_TABLE";
  else if (missingRoutes.length) verdict = "NO_API_EVIDENCE";
  else if (missingTables.length) verdict = "NO_SCHEMA_EVIDENCE";
  return { domain, routes: routeEvidence, tables: tableEvidence, missingRoutes, missingTables, verdict };
});

const result = {
  generatedAt: new Date().toISOString(),
  sqlFilesScanned: SQL_FILES.map((file) => path.relative(ROOT, file)),
  rows,
  caveats: [
    "La présence d'une table ne prouve pas à elle seule qu'une mutation est transactionnelle ni que la FK métier attendue est complète.",
    "Le scanner parcourt schema.sql et les migrations SQL sous backend/db et backend/migrations.",
    "Les routes sont recherchées avec et sans le préfixe de transport /api.",
    "Les tables créées dynamiquement uniquement en JavaScript de boot restent à vérifier manuellement.",
    "CANONICAL_CANDIDATE signifie API + schéma détectés statiquement, pas validation métier finale.",
  ],
};

const output = process.argv[2];
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
