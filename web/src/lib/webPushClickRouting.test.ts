import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notificationDestinationContract } from "./notificationNavigation";
import {
  resolveWebPushClickHref,
  resolveWebPushClickPath,
  WEB_PUSH_FALLBACK_PATH,
  webPushAllowedPaths,
} from "./webPushClickRouting";

const swSource = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

describe("WEB-PUSH click routing — destinations Somafrik allowlistées", () => {
  it("ouvre une conversation allowlistée depuis navigationTarget", () => {
    expect(
      resolveWebPushClickPath({
        navigationTarget: { type: "conversation", conversationId: "conv-1" },
        url: "https://evil.example/phish",
      }),
    ).toBe("/messages?conversationId=conv-1");
  });

  it("refuse une URL arbitraire, javascript: et //host", () => {
    expect(resolveWebPushClickPath({ url: "https://evil.example" })).toBe(WEB_PUSH_FALLBACK_PATH);
    expect(resolveWebPushClickPath({ href: "javascript:alert(1)" })).toBe(WEB_PUSH_FALLBACK_PATH);
    expect(resolveWebPushClickPath({ location: "//evil.example" })).toBe(WEB_PUSH_FALLBACK_PATH);
    expect(
      resolveWebPushClickPath({
        navigationTarget: { type: "unknown", url: "https://somafrik.app/messages" },
      }),
    ).toBe(WEB_PUSH_FALLBACK_PATH);
  });

  it("construit un href same-origin ; refuse une origin étrangère dans le payload", () => {
    const href = resolveWebPushClickHref(
      { navigationTarget: { type: "announcement", announcementId: "ann-1" } },
      { origin: "https://preprod.somafrik.app", basePath: "/" },
    );
    expect(href).toBe("https://preprod.somafrik.app/annonces?announcementId=ann-1");

    const docker = resolveWebPushClickHref(
      { navigationTarget: { type: "announcement", announcementId: "ann-1" } },
      { origin: "http://localhost:5000", basePath: "/web/" },
    );
    expect(docker).toBe("http://localhost:5000/web/annonces?announcementId=ann-1");
  });

  it("l'allowlist Web Push couvre les 9 destinations in-app + /notifications", () => {
    const allowed = webPushAllowedPaths();
    expect(allowed).toContain("/notifications");
    for (const row of notificationDestinationContract()) {
      expect(allowed).toContain(row.path);
    }
  });

  it("le service worker ignore data.url et n'ouvre qu'une destination allowlistée", () => {
    expect(swSource).toMatch(/notificationclick/);
    expect(swSource).toMatch(/resolveWebPushClickPath/);
    expect(swSource).not.toMatch(/clients\.openWindow\(\s*(event\.)?notification\.data\.url/);
    expect(swSource).toContain("/notifications");
    for (const row of notificationDestinationContract()) {
      expect(swSource).toContain(`"${row.path}"`);
    }
  });
});
