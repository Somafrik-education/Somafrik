/**
 * Harnais de recette UX Aide mobile — hors graphe de production.
 * Branché uniquement via App.helpUxSmoke.tsx + Metro
 * SOMAFRIK_HELP_UX_SMOKE_ENTRY=1 (pas un flag EXPO_PUBLIC_*).
 * HelpHost / HelpSheet / drawer restent les composants de production.
 */
import type { LoginResponse } from "../src/services/api";
import { getInternalRoleDefaults } from "../src/lib/internalRoleDefaults";
import {
  resetHelpTriggerVisibleMemory,
  setHelpTriggerPreferenceStoreForTests,
  writeHelpTriggerVisible,
} from "../src/help/helpTriggerPreference";

export const HELP_UX_SMOKE_SCHOOL = "CD-2026-HELP";
export const HELP_UX_SMOKE_USER_ID = "user-smoke-help";

export function createHelpUxSmokeSession(): LoginResponse {
  const permissions = getInternalRoleDefaults("Admin School");
  return {
    role: "school_admin",
    roleLabel: "Admin School",
    permissions,
    user: {
      id: HELP_UX_SMOKE_USER_ID,
      name: "Admin Recette Aide",
      firstName: "Admin",
      lastName: "Recette",
      role: "school_admin",
      schoolCode: HELP_UX_SMOKE_SCHOOL,
      schoolPublicCode: HELP_UX_SMOKE_SCHOOL,
      schoolId: "22222222-2222-4222-8222-222222222222",
      permissions,
      mustChangePassword: false,
    },
    school: {
      code: HELP_UX_SMOKE_SCHOOL,
      name: "Lycée Somafrik Recette",
      city: "Kinshasa",
      id: "22222222-2222-4222-8222-222222222222",
    },
  };
}

export function installHelpUxSmokePreference(visible = true): void {
  const data: Record<string, string> = {};
  setHelpTriggerPreferenceStoreForTests({
    async getItemAsync(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    async setItemAsync(key, value) {
      data[key] = value;
    },
  });
  resetHelpTriggerVisibleMemory(visible);
  void writeHelpTriggerVisible(visible);
}

let helpUxSmokeInstalled = false;

export function installHelpUxSmokeRuntime(): void {
  if (helpUxSmokeInstalled) return;
  helpUxSmokeInstalled = true;
  installHelpUxSmokeFetch();
  installHelpUxSmokePreference(true);
}

export function installHelpUxSmokeFetch(): void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.includes("/api/")) return original(input, init);
    const method = String(init?.method || "GET").toUpperCase();
    const body = method === "GET" ? "[]" : "{}";
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
