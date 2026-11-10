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
    const source = "- name: Aucun eas submit automatique\n";
    assert.equal(workflowHasExecutableEasSubmit(source), false);
  });

  it("accepte une mention echo ou printf", () => {
    assert.equal(workflowHasExecutableEasSubmit('- run: echo "eas submit"\n'), false);
    assert.equal(workflowHasExecutableEasSubmit("- run: printf 'eas submit\\n'\n"), false);
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

  it("refuse un bloc run: >", () => {
    const source = [
      "- run: >",
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

  it("refuse bash -lc", () => {
    const source = "- run: bash -lc 'eas submit --platform android'\n";
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("refuse sh -c", () => {
    const source = '- run: sh -c "eas submit -p android"\n';
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("refuse env VAR=value eas submit", () => {
    const source = "- run: env FOO=bar eas submit --platform android\n";
    assert.equal(workflowHasExecutableEasSubmit(source), true);
  });

  it("refuse command eas submit", () => {
    const source = "- run: command eas submit --platform android\n";
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
