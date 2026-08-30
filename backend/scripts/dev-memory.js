/**
 * Démarre le backend sans PostgreSQL (données en mémoire, rechargées à chaque run).
 * Usage: npm run dev:memory
 *
 * Le harnais CI isolé pose DATABASE_URL + SOMAFRIK_SKIP_DEMO_SEED=true.
 * Ce lanceur ignore ces variables : seed mémoire (superadmin/admin/prefet)
 * uniquement. Les suites PG HTTP lancent server.js, pas ce script.
 */
process.env.SOMAFRIK_DB_REQUIRED = "false";
process.env.SOMAFRIK_SKIP_DEMO_SEED = "false";
process.env.SOMAFRIK_FORCE_MEMORY = "true";
delete process.env.DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
require("../server.js");
