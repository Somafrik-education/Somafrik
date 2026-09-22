import { L1_LOCAL_SCHEMA_VERSION } from "./types";
import { L1_CLASSES_HEAD_TEACHER_COLUMNS, SCHEMA_MIGRATION_V1 } from "./schema";

export type MigrationExecutor = {
  exec(sql: string): Promise<void>;
  get(sql: string): Promise<{ version: number } | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
};

async function addColumnIgnoreDuplicate(db: MigrationExecutor, sql: string): Promise<void> {
  try {
    await db.exec(sql);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (!/duplicate column name|already exists/i.test(message)) {
      throw error;
    }
  }
}

export async function applyL1Migrations(db: MigrationExecutor): Promise<void> {
  await db.exec(SCHEMA_MIGRATION_V1);
  const current = await db.get(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const version = Number(current?.version ?? 0);
  if (version < 2) {
    for (const column of L1_CLASSES_HEAD_TEACHER_COLUMNS) {
      await addColumnIgnoreDuplicate(db, `ALTER TABLE l1_classes ADD COLUMN ${column} TEXT`);
    }
  }
  if (version === L1_LOCAL_SCHEMA_VERSION) {
    return;
  }
  await db.run("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
    L1_LOCAL_SCHEMA_VERSION,
    new Date().toISOString(),
  ]);
}
