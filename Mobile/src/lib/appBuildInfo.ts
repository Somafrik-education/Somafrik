/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 2 — identification du binaire installé, sans ADB.
 * Lit `extra.buildProvenance` et la version embarqués à la compilation (app.config.js).
 */

type ExpoConfigLike = {
  version?: string | null;
  android?: { versionCode?: number | string | null } | null;
  extra?: {
    releaseProfile?: string | null;
    buildProvenance?: { gitSha?: string | null; profile?: string | null } | null;
  } | null;
} | null | undefined;

export type AppBuildInfo = {
  value: string;
  detail: string;
};

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function describeAppBuild(config: ExpoConfigLike): AppBuildInfo {
  const version = String(config?.version ?? "").trim() || "?";
  const versionCode = String(config?.android?.versionCode ?? "").trim();
  const sha = String(config?.extra?.buildProvenance?.gitSha ?? "").trim();
  const profile = String(config?.extra?.buildProvenance?.profile ?? config?.extra?.releaseProfile ?? "").trim();
  const build = FULL_SHA.test(sha) ? sha.slice(0, 8).toLowerCase() : "non identifié";
  return {
    value: versionCode ? `Version ${version} (${versionCode})` : `Version ${version}`,
    detail: `Build ${build}${profile ? ` · profil ${profile}` : ""}. Communiquez ces informations au support.`,
  };
}
