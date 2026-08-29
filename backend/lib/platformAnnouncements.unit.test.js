"use strict";

const assert = require("node:assert/strict");
const { parsePlatformAudience, SYSTEM_SENDER_DISPLAY_NAME } = require("./platformAnnouncementsService");

function throwsStatus(fn, status) {
  assert.throws(fn, (error) => error.statusCode === status);
}

function main() {
  const admin = parsePlatformAudience({ announcementType: "administrative", audienceKey: "country_admins" });
  assert.equal(admin.announcementType, "administrative");
  assert.equal(admin.audienceKey, "country_admins");
  assert.equal(
    parsePlatformAudience({ announcementType: "administrative", audienceKey: "school_admins" }).audienceKey,
    "school_admins",
  );
  assert.equal(
    parsePlatformAudience({ announcementType: "administrative", audienceKey: "all_admins" }).audienceKey,
    "all_admins",
  );
  assert.equal(parsePlatformAudience({ announcementType: "system" }).audienceKey, "all_active_users");
  assert.equal(SYSTEM_SENDER_DISPLAY_NAME, "Somafrik");
  throwsStatus(() => parsePlatformAudience({ announcementType: "administrative", audienceKey: "all_active_users" }), 400);
  throwsStatus(() => parsePlatformAudience({ announcementType: "system", audienceKey: "country_admins" }), 400);
  throwsStatus(() => parsePlatformAudience({ announcementType: "school", audienceKey: "parents" }), 400);
  console.log("platformAnnouncements.unit.test.js OK");
}

main();
