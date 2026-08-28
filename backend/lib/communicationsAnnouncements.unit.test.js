"use strict";

const assert = require("node:assert/strict");
const { parseAudience, canManageAnnouncements } = require("./communicationsAnnouncementsService");

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

console.log("OK communicationsAnnouncements.unit.test.js");
