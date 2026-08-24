"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const { prepareDemoSeedData } = require("./demoSeedPolicy");

test("demo seed exposes exactly one subscription per platform school", () => {
  const subscriptionsRef = seedData.subscriptions;
  prepareDemoSeedData(seedData);

  const schoolCodes = seedData.platformSchools.map((school) => String(school.code).trim().toUpperCase());
  const subscriptionCodes = seedData.subscriptions.map((subscription) =>
    String(subscription.schoolCode).trim().toUpperCase(),
  );

  assert.equal(seedData.subscriptions, subscriptionsRef, "seed subscriptions must be reconciled in place");
  assert.equal(seedData.subscriptions.length, seedData.platformSchools.length);
  assert.equal(new Set(subscriptionCodes).size, subscriptionCodes.length);
  assert.deepEqual(new Set(subscriptionCodes), new Set(schoolCodes));

  // Idempotence : un deuxième passage ne recrée aucun doublon.
  prepareDemoSeedData(seedData);
  assert.equal(seedData.subscriptions.length, seedData.platformSchools.length);
  assert.equal(new Set(seedData.subscriptions.map((item) => item.schoolCode)).size, seedData.subscriptions.length);
});

test("demo subscriptions use the owning school's country code", () => {
  prepareDemoSeedData(seedData);
  const subscriptionBySchool = new Map(
    seedData.subscriptions.map((subscription) => [
      String(subscription.schoolCode).trim().toUpperCase(),
      subscription,
    ]),
  );

  for (const school of seedData.platformSchools) {
    const schoolCode = String(school.code).trim().toUpperCase();
    const expectedCountryCode = String(school.countryCode ?? "").trim().toUpperCase();
    const subscription = subscriptionBySchool.get(schoolCode);
    assert.ok(subscription, `missing subscription for ${schoolCode}`);
    assert.equal(String(subscription.countryCode ?? "").trim().toUpperCase(), expectedCountryCode);
  }
});

test("CD-IN-26-001 remains seeded and has one subscription", () => {
  prepareDemoSeedData(seedData);
  const school = seedData.platformSchools.find((item) => item.loginCode === "CD-IN-26-001");
  assert.ok(school, "expected seeded school loginCode CD-IN-26-001");

  const matches = seedData.subscriptions.filter(
    (subscription) =>
      String(subscription.schoolCode).trim().toUpperCase() === String(school.code).trim().toUpperCase(),
  );
  assert.equal(matches.length, 1);
});
