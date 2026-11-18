/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 5 — provenance du build Web.
 *
 * Fonctions pures (aucun import Node) : appelées par `vite.config.ts` au moment du build,
 * testées par Vitest. Le build publie `build-info.json` et une balise
 * `<meta name="somafrik-build-sha">` pour qu'un déploiement soit identifiable sans accès
 * à l'hébergeur (cf. audit #1193 : Web préprod sans SHA, en retard sur l'API).
 */

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export type BuildProvenance = {
  gitSha: string | null;
  gitBranch: string | null;
  source: "render" | "github" | "explicit" | "git" | "unknown";
};

type Env = Record<string, string | undefined>;

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeSha(value: string | null | undefined): string | null {
  const raw = clean(value);
  return FULL_GIT_SHA.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Ordre : Render (RENDER_GIT_COMMIT/BRANCH) → GitHub Actions → variable explicite → git local.
 * Un SHA non canonique (abrégé, vide, texte) est ignoré : jamais de provenance approximative.
 */
export function resolveBuildProvenance(env: Env, gitFallback?: { sha?: string | null; branch?: string | null }): BuildProvenance {
  const render = normalizeSha(env.RENDER_GIT_COMMIT);
  if (render) return { gitSha: render, gitBranch: clean(env.RENDER_GIT_BRANCH) || null, source: "render" };
  const github = normalizeSha(env.GITHUB_SHA);
  if (github) {
    const branch = clean(env.GITHUB_HEAD_REF) || clean(env.GITHUB_REF_NAME);
    return { gitSha: github, gitBranch: branch || null, source: "github" };
  }
  const explicit = normalizeSha(env.SOMAFRIK_GIT_SHA);
  if (explicit) return { gitSha: explicit, gitBranch: clean(env.SOMAFRIK_GIT_BRANCH) || null, source: "explicit" };
  const local = normalizeSha(gitFallback?.sha);
  if (local) return { gitSha: local, gitBranch: clean(gitFallback?.branch) || null, source: "git" };
  return { gitSha: null, gitBranch: null, source: "unknown" };
}

/**
 * Garde-fou de déploiement (opt-in) : si `SOMAFRIK_ALLOWED_DEPLOY_BRANCHES` est défini
 * (liste séparée par des virgules) et que l'hébergeur construit une autre branche, le build échoue.
 * Sans la variable, aucun blocage : l'activation est une décision d'exploitation.
 */
export function assertAllowedDeployBranch(env: Env, provenance: BuildProvenance): void {
  const allowed = clean(env.SOMAFRIK_ALLOWED_DEPLOY_BRANCHES)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!allowed.length) return;
  const branch = clean(provenance.gitBranch);
  if (!branch) {
    throw new Error(
      `[build-provenance] Branche de déploiement inconnue alors que SOMAFRIK_ALLOWED_DEPLOY_BRANCHES=${allowed.join(",")}.`,
    );
  }
  if (!allowed.includes(branch)) {
    throw new Error(
      `[build-provenance] Branche « ${branch} » non autorisée pour ce déploiement (autorisées : ${allowed.join(", ")}).`,
    );
  }
}

export function buildInfoJson(provenance: BuildProvenance): string {
  return `${JSON.stringify({ gitSha: provenance.gitSha, gitBranch: provenance.gitBranch, source: provenance.source }, null, 2)}\n`;
}

export function buildShaMetaTag(provenance: BuildProvenance): string {
  return `<meta name="somafrik-build-sha" content="${provenance.gitSha ?? "unknown"}" />`;
}
