import { L1_LOCAL_SCHEMA_VERSION } from "./types";
import { SCHEMA_MIGRATION_V1, SCHEMA_MIGRATION_V2 } from "./schema";

export type MigrationExecutor = {
  exec(sql: string): Promise<void>;
  get(sql: string): Promise<{ version: number } | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
};

export async function applyL1Migrations(db: MigrationExecutor): Promise<void> {
  await db.exec(SCHEMA_MIGRATION_V1);
  const current = await db.get(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const version = Number(current?.version ?? 0);
  if (version < 2) {
    await db.exec(SCHEMA_MIGRATION_V2);
  }
  if (version === L1_LOCAL_SCHEMA_VERSION) {
    return;
  }
  await db.run("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
    L1_LOCAL_SCHEMA_VERSION,
    new Date().toISOString(),
  ]);
}
