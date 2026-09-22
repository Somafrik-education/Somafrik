/**
 * Préférence locale du raccourci flottant « ? ».
 * Persistance via expo-secure-store déjà présent — pas de nouvelle dépendance.
 * Les JWT restent hors de ce module.
 */

export const HELP_TRIGGER_VISIBLE_KEY = "somafrik.help.triggerVisible";

export type HelpTriggerPreferenceStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

let memoryVisible = true;
let injectedStore: HelpTriggerPreferenceStore | null | undefined;

export function isHelpTriggerVisibleValue(raw: string | null | undefined): boolean {
  if (raw == null || raw === "") return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "hidden";
}

export function serializeHelpTriggerVisible(visible: boolean): string {
  return visible ? "1" : "0";
}

export function setHelpTriggerPreferenceStoreForTests(
  store: HelpTriggerPreferenceStore | null | undefined,
): void {
  injectedStore = store;
}

export function resetHelpTriggerVisibleMemory(visible = true): void {
  memoryVisible = visible;
}

function resolveStore(): HelpTriggerPreferenceStore | null {
  if (injectedStore !== undefined) return injectedStore;
  try {
    return require("expo-secure-store") as HelpTriggerPreferenceStore;
  } catch {
    return null;
  }
}

export async function readHelpTriggerVisible(): Promise<boolean> {
  try {
    const store = resolveStore();
    const raw = store ? await store.getItemAsync(HELP_TRIGGER_VISIBLE_KEY) : null;
    if (raw == null) return memoryVisible;
    memoryVisible = isHelpTriggerVisibleValue(raw);
    return memoryVisible;
  } catch {
    return memoryVisible;
  }
}

export async function writeHelpTriggerVisible(visible: boolean): Promise<void> {
  memoryVisible = visible;
  try {
    const store = resolveStore();
    if (store) {
      await store.setItemAsync(HELP_TRIGGER_VISIBLE_KEY, serializeHelpTriggerVisible(visible));
    }
  } catch {
    /* tests Node / SecureStore indisponible : mémoire process seulement */
  }
}
