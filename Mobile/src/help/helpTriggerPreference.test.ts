import assert from "node:assert/strict";
import test from "node:test";
import {
  HELP_TRIGGER_VISIBLE_KEY,
  isHelpTriggerVisibleValue,
  readHelpTriggerVisible,
  resetHelpTriggerVisibleMemory,
  serializeHelpTriggerVisible,
  setHelpTriggerPreferenceStoreForTests,
  writeHelpTriggerVisible,
  type HelpTriggerPreferenceStore,
} from "./helpTriggerPreference";

function memoryStore(initial?: Record<string, string>): HelpTriggerPreferenceStore & { data: Record<string, string> } {
  const data = { ...(initial ?? {}) };
  return {
    data,
    async getItemAsync(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    async setItemAsync(key: string, value: string) {
      data[key] = value;
    },
  };
}

test("first use defaults to a visible help trigger", () => {
  assert.equal(isHelpTriggerVisibleValue(null), true);
  assert.equal(isHelpTriggerVisibleValue(undefined), true);
  assert.equal(isHelpTriggerVisibleValue(""), true);
  assert.equal(serializeHelpTriggerVisible(true), "1");
});

test("hidden and shown values persist as 0 / 1", () => {
  assert.equal(isHelpTriggerVisibleValue("0"), false);
  assert.equal(isHelpTriggerVisibleValue("false"), false);
  assert.equal(isHelpTriggerVisibleValue("hidden"), false);
  assert.equal(isHelpTriggerVisibleValue("1"), true);
  assert.equal(serializeHelpTriggerVisible(false), "0");
});

test("write then read keeps the trigger hidden across a simulated restart", async () => {
  const store = memoryStore();
  setHelpTriggerPreferenceStoreForTests(store);
  resetHelpTriggerVisibleMemory(true);

  assert.equal(await readHelpTriggerVisible(), true, "affichage par défaut");

  await writeHelpTriggerVisible(false);
  assert.equal(store.data[HELP_TRIGGER_VISIBLE_KEY], "0");

  resetHelpTriggerVisibleMemory(true);
  assert.equal(await readHelpTriggerVisible(), false, "persistance du masquage");

  await writeHelpTriggerVisible(true);
  resetHelpTriggerVisibleMemory(false);
  assert.equal(await readHelpTriggerVisible(), true, "réactivation persistée");

  setHelpTriggerPreferenceStoreForTests(undefined);
  resetHelpTriggerVisibleMemory(true);
});

test("memory fallback still hides the trigger when storage is unavailable", async () => {
  setHelpTriggerPreferenceStoreForTests(null);
  resetHelpTriggerVisibleMemory(true);
  await writeHelpTriggerVisible(false);
  assert.equal(await readHelpTriggerVisible(), false);
  setHelpTriggerPreferenceStoreForTests(undefined);
  resetHelpTriggerVisibleMemory(true);
});
