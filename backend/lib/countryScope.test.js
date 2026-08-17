"use strict";

const assert = require("node:assert/strict");
const { getCountryCodeFromScope, countryScopeMatches } = require("./countryScope");

assert.equal(getCountryCodeFromScope("RDC"), "CD");
assert.equal(getCountryCodeFromScope("CD"), "CD");
assert.equal(getCountryCodeFromScope("République Démocratique du Congo"), "CD");
assert.equal(getCountryCodeFromScope("Republique Democratique du Congo"), "CD");
assert.equal(getCountryCodeFromScope("Burundi"), "BI");
assert.equal(getCountryCodeFromScope("BI"), "BI");
assert.equal(getCountryCodeFromScope(""), "");
assert.equal(getCountryCodeFromScope(undefined), "");
assert.ok(countryScopeMatches("République Démocratique du Congo", "RDC"));
assert.ok(countryScopeMatches("CD", "RDC"));
assert.ok(!countryScopeMatches("BI", "CD"));

console.log("countryScope.test.js OK");
