"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  extractYamlRunScripts,
  workflowHasExecutableEasSubmit,
} = require("./verify-mobile-release-readiness");

describe("garde eas submit — commandes run: seulement", () => {
  it("accepte un commentaire YAML", () => {
    const source = "# Aucun eas submit.\nname: Mobile Android Release Build\n";
    assert.equal(workflowHasExecutableEasSubmit(source), false);
    assert.deepEqual(extractYamlRunScripts(source), []);
  });

  it("accepte un nom de step documentaire", () => {
    const source = "- name: Vérifier qu'aucun eas submit n'est automatisé\n";
    assert.equal(workflowHasExecutableEasSubmit(source), false);
  });

  it("refuse une commande inline", () => {
    const source = "- run: eas submit --platform android\n";
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("refuse un bloc run: |", () => {
    const source = [
      "- run: |",
      "    npm ci",
      "    eas submit --platform android",
      "",
    ].join("\n");
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("refuse npx eas submit dans un bloc run: |", () => {
    const source = [
      "- run: |",
      "    npx eas submit -p android",
      "",
    ].join("\n");
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("accepte le workflow AAB réel malgré le commentaire d'interdiction", () => {
    const aabWorkflow = fs.readFileSync(
      path.join(__dirname, "..", "..", ".github", "workflows", "mobile-release-build.yml"),
      "utf8",
    );
    assert.match(aabWorkflow, /# Aucun eas submit\. Aucun upload Play\./);
    assert.equal(workflowHasExecutableEasSubmit(aabWorkflow), false);
  });
});
