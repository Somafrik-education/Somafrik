"use strict";

const assert = require("node:assert/strict");
const {
  parseAudience,
  canManageAnnouncements,
  resolveAuthorInSchool,
} = require("./communicationsAnnouncementsService");

{
  const school = parseAudience({ audience: "Tous" });
  assert.equal(school.scope, "school");
}

{
  const roles = parseAudience({ audience: "Parents" });
  assert.equal(roles.scope, "roles");
  assert.deepEqual(roles.recipientKinds, ["parent"]);
}

{
  const classes = parseAudience({
    classIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91"],
    recipientKinds: ["parent", "student"],
  });
  assert.equal(classes.scope, "classes");
  assert.deepEqual(classes.recipientKinds, ["parent", "student"]);
}

{
  const c1 = parseAudience({
    audience: "Élèves",
    targetClassId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91",
  });
  assert.equal(c1.scope, "classes");
  assert.deepEqual(c1.recipientKinds, ["student"]);
}

assert.throws(() => parseAudience({ classIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb91"] }), /Catégories/);

assert.equal(canManageAnnouncements({ permissions: ["Announcements:UPDATE"] }), true);
assert.equal(canManageAnnouncements({ permissions: ["Announcements:READ"] }), false);
assert.equal(canManageAnnouncements({ permissions: ["Notifications:UPDATE"] }), false);
assert.equal(canManageAnnouncements({ permissions: ["ALL_PRIVILEGES"] }), true);

(async () => {
  const school = { id: "school-cd", school_code: "CD-2026-0001" };
  const pgUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

  {
    const author = await resolveAuthorInSchool(
      { getUserById: async () => ({ id: pgUuid, school_id: school.id, first_name: "Admin", last_name: "A" }) },
      { sub: pgUuid, schoolCode: "CD-2026-0001" },
      school,
    );
    assert.equal(author.id, pgUuid);
  }

  await assert.rejects(
    () =>
      resolveAuthorInSchool(
        { getUserById: async () => null },
        { sub: pgUuid, schoolCode: "CD-2026-0001" },
        school,
      ),
    /Auteur non autorisé/,
  );

  {
    const seed = await resolveAuthorInSchool(
      { getUserById: async () => null },
      { sub: "USER-ADMIN1", schoolCode: "CD-2026-0001", identifier: "admin" },
      school,
    );
    assert.equal(seed.id, "USER-ADMIN1");
    assert.equal(seed.school_id, school.id);
  }

  await assert.rejects(
    () =>
      resolveAuthorInSchool(
        { getUserById: async () => null },
        { sub: "USER-ADMIN-BI-SCHOOL", schoolCode: "BI-2026-0002", identifier: "admin" },
        school,
      ),
    /Auteur non autorisé/,
  );

  await assert.rejects(
    () =>
      resolveAuthorInSchool(
        { getUserById: async () => ({ id: pgUuid, school_id: "other-school" }) },
        { sub: pgUuid, schoolCode: "CD-2026-0001", role: "Admin School" },
        school,
      ),
    /Auteur non autorisé/,
  );

  console.log("OK communicationsAnnouncements.unit.test.js");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
