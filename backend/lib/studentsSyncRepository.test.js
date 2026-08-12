/**
 * PR2 — syncStudentsDomainFromBackOffice est un no-op :
 * ne matérialise plus BO students[] → PG.
 * Les élèves se créent via POST /api/classes/:classCode/students.
 */
const assert = require("assert");
const { PostgresRepository } = require("../db/postgresRepository");

function createMinimalRepo() {
  const repo = Object.create(PostgresRepository.prototype);
  repo.ready = true;
  repo.cachedDataset = null;
  repo.engine = "postgresql";
  return repo;
}

async function run() {
  const repo = createMinimalRepo();
  const result = await repo.syncStudentsDomainFromBackOffice({
    schools: [{ code: "SCH-A", name: "École A" }],
    classes: [{ id: "CLS-A", name: "6e A", schoolCode: "SCH-A" }],
    students: [
      {
        id: "STUDENTS-A-1",
        matricule: "STUDENTS-A-1",
        publicId: "STUDENTS-A-1",
        firstName: "Mbuyi",
        name: "Mbuyi",
        className: "6e A",
        schoolCode: "SCH-A",
      },
    ],
  });

  assert.strictEqual(result.synced, true);
  assert.deepStrictEqual(result.accepted, { students: [], enrollments: [] });
  assert.deepStrictEqual(result.rejected, []);
  assert.strictEqual(result.studentCount, 0);
  assert.strictEqual(result.enrollmentCount, 0);

  console.log("studentsSyncRepository.test.js : OK (no-op)");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
