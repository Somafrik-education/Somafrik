"use strict";

async function ensureSchoolLoginCodeColumn(queryFn) {
  await queryFn(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS login_code TEXT`);
}

module.exports = { ensureSchoolLoginCodeColumn };
