import { describe, expect, it } from "vitest";
import {
  assertAllowedDeployBranch,
  buildInfoJson,
  buildShaMetaTag,
  resolveBuildProvenance,
} from "./buildProvenance";

const SHA = "8467944526563b956bfd50370079af9e9355b533";
const OTHER = "78a7749aecfb62b6be79129a6c0e7e6ca3ea4fb1";

describe("resolveBuildProvenance (LOT 5)", () => {
  it("prend le commit Render en priorité, avec sa branche", () => {
    expect(resolveBuildProvenance({ RENDER_GIT_COMMIT: SHA.toUpperCase(), RENDER_GIT_BRANCH: "develop", GITHUB_SHA: OTHER }))
      .toEqual({ gitSha: SHA, gitBranch: "develop", source: "render" });
  });

  it("retombe sur GitHub Actions puis sur git local", () => {
    expect(resolveBuildProvenance({ GITHUB_SHA: OTHER, GITHUB_REF_NAME: "develop" }).source).toBe("github");
    expect(resolveBuildProvenance({}, { sha: SHA, branch: "fix/x" })).toEqual({ gitSha: SHA, gitBranch: "fix/x", source: "git" });
  });

  it("refuse un SHA abrégé ou vide : provenance inconnue plutôt qu'approximative", () => {
    expect(resolveBuildProvenance({ RENDER_GIT_COMMIT: "8467944" }, { sha: "" })).toEqual({ gitSha: null, gitBranch: null, source: "unknown" });
  });
});

describe("assertAllowedDeployBranch (LOT 5)", () => {
  it("ne bloque rien sans liste autorisée (opt-in)", () => {
    expect(() => assertAllowedDeployBranch({}, { gitSha: OTHER, gitBranch: "fix/nfc-p0-r3-3-prevention", source: "render" })).not.toThrow();
  });

  it("bloque une branche de PR quand develop est seule autorisée (cas #1189)", () => {
    expect(() => assertAllowedDeployBranch(
      { SOMAFRIK_ALLOWED_DEPLOY_BRANCHES: "develop" },
      { gitSha: OTHER, gitBranch: "fix/nfc-p0-r3-3-prevention", source: "render" },
    )).toThrow(/non autorisée/);
  });

  it("accepte une branche listée et refuse une branche inconnue", () => {
    const env = { SOMAFRIK_ALLOWED_DEPLOY_BRANCHES: "develop, main" };
    expect(() => assertAllowedDeployBranch(env, { gitSha: SHA, gitBranch: "main", source: "render" })).not.toThrow();
    expect(() => assertAllowedDeployBranch(env, { gitSha: SHA, gitBranch: null, source: "unknown" })).toThrow(/inconnue/);
  });
});

describe("artefacts publiés (LOT 5)", () => {
  it("build-info.json et meta exposent le SHA complet", () => {
    const provenance = { gitSha: SHA, gitBranch: "develop", source: "render" as const };
    expect(JSON.parse(buildInfoJson(provenance))).toEqual({ gitSha: SHA, gitBranch: "develop", source: "render" });
    expect(buildShaMetaTag(provenance)).toBe(`<meta name="somafrik-build-sha" content="${SHA}" />`);
    expect(buildShaMetaTag({ gitSha: null, gitBranch: null, source: "unknown" })).toContain('content="unknown"');
  });
});
