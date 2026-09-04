"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { composeClassDisplayName } = require("./classesManagement");

test("composeClassDisplayName n'expose jamais le code technique du groupe", () => {
  assert.equal(
    composeClassDisplayName({ levelName: "1ère", streamName: "A", groupCode: "CD02" }),
    "1ère A",
  );
  assert.equal(
    composeClassDisplayName({ levelName: "Primaire", streamName: "Générale", groupCode: "CD02" }),
    "Primaire Générale",
  );
});

test("composeClassDisplayName fonctionne sans filière", () => {
  assert.equal(
    composeClassDisplayName({ levelName: "1ère", streamName: null, groupCode: "CD02" }),
    "1ère",
  );
});

test("composeClassDisplayName conserve la série métier A/B/C", () => {
  assert.equal(
    composeClassDisplayName({ levelName: "1ère Primaire", streamName: null, groupCode: "A" }),
    "1ère Primaire A",
  );
  assert.equal(
    composeClassDisplayName({ levelName: "6ème Primaire", streamName: null, groupCode: "B" }),
    "6ème Primaire B",
  );
});
