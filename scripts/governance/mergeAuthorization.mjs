// R15 — décision d'autorisation de fusion (fonction pure, sans réseau).
//
// Une autorisation n'est jamais déduite d'un texte seul : elle exige une
// review GitHub APPROVED, attachée au HEAD exact (commit_id), rédigée par un
// compte humain listé dans la configuration lue sur la branche cible, et dont
// le corps porte la ligne de contrat CTO-GO-MERGE correspondant à la PR.

export const STATUS_CONTEXT = "governance/merge-authorization";

const AUTH_LINE = /^CTO-GO-MERGE PR=#(\d+) HEAD=([0-9a-f]{40}) TARGET=([A-Za-z0-9._/-]+)$/;
const HOLD_TITLE = /\b(DRAFT|HOLD|NO[\s-]?MERGE)\b/i;

export function parseAuthorizationLines(body) {
  return String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => AUTH_LINE.exec(line))
    .filter(Boolean)
    .map((m) => ({ pr: Number(m[1]), head: m[2], target: m[3] }));
}

function isBot(user) {
  const login = String(user?.login ?? "");
  return user?.type === "Bot" || login.endsWith("[bot]");
}

function sameLogin(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

/** Valide la configuration ; toute anomalie rend la décision négative. */
export function validateConfig(config) {
  const problems = [];
  if (!config || typeof config !== "object") {
    return { problems: ["Configuration d'autorisation absente ou illisible."], config: null };
  }
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : null);
  const authorizers = list(config.authorizers);
  const denied = list(config.deniedActors) ?? [];
  const targets = list(config.protectedTargets);
  if (!authorizers) problems.push("Configuration invalide : « authorizers » doit être une liste.");
  if (!targets || targets.length === 0) problems.push("Configuration invalide : « protectedTargets » vide.");
  if (!config.requiredChecks || typeof config.requiredChecks !== "object") {
    problems.push("Configuration invalide : « requiredChecks » absent.");
  }
  const effective = (authorizers ?? []).filter((login) => !denied.some((d) => sameLogin(d, login)));
  if (authorizers && effective.length === 0) {
    problems.push("Aucun autorisateur CTO habilité n'est configuré (.github/governance/merge-authorizers.json).");
  }
  return {
    problems,
    config: { authorizers: effective, denied, targets: targets ?? [], requiredChecks: config.requiredChecks ?? {} },
  };
}

/** Dernier état connu d'un contrôle requis sur le HEAD (check run ou statut). */
function requiredCheckState(name, checkRuns, statuses) {
  const runs = (checkRuns ?? []).filter((r) => r?.name === name);
  if (runs.length > 0) {
    const latest = runs.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
    if (latest.status !== "completed") return "pending";
    return latest.conclusion === "success" ? "success" : `échec (${latest.conclusion ?? "inconnu"})`;
  }
  const status = (statuses ?? []).find((s) => s?.context === name);
  if (status) {
    if (status.state === "success") return "success";
    return status.state === "pending" ? "pending" : `échec (${status.state})`;
  }
  return "absent";
}

/**
 * @param {{pr: object, reviews: object[], checkRuns: object[], statuses: object[], config: object}} input
 * @returns {{authorized: boolean, reasons: string[], authorization: object|null}}
 */
export function evaluateMergeAuthorization({ pr, reviews, checkRuns, statuses, config }) {
  const reasons = [];
  const { problems, config: cfg } = validateConfig(config);
  reasons.push(...problems);

  if (!pr || typeof pr !== "object") {
    return { authorized: false, reasons: ["PR introuvable."], authorization: null };
  }
  const number = Number(pr.number);
  const head = String(pr.head?.sha ?? "");
  const target = String(pr.base?.ref ?? "");
  const author = pr.user?.login;

  if (pr.state !== "open") reasons.push(`PR non ouverte (état : ${pr.state}).`);
  if (pr.draft) reasons.push("PR en Draft : une PR Draft n'est jamais autorisée.");
  if (!/^[0-9a-f]{40}$/.test(head)) reasons.push("HEAD de la PR illisible.");
  if (cfg && !cfg.targets.includes(target)) {
    reasons.push(`Branche cible « ${target} » hors du périmètre protégé (${cfg.targets.join(", ")}).`);
  }
  if (HOLD_TITLE.test(String(pr.title ?? ""))) {
    reasons.push("Titre encore marqué DRAFT / HOLD / NO MERGE : le titre doit refléter l'état réel avant fusion.");
  }

  // CI requise sur le HEAD exact.
  const required = cfg?.requiredChecks?.[target];
  if (cfg && (!Array.isArray(required) || required.length === 0)) {
    reasons.push(`Aucun contrôle CI requis n'est configuré pour « ${target} ».`);
  }
  for (const name of Array.isArray(required) ? required : []) {
    const state = requiredCheckState(name, checkRuns, statuses);
    if (state === "pending") reasons.push(`CI requise « ${name} » non terminée sur ${head.slice(0, 12)}.`);
    else if (state === "absent") reasons.push(`CI requise « ${name} » absente sur ${head.slice(0, 12)}.`);
    else if (state !== "success") reasons.push(`CI requise « ${name} » en ${state} sur ${head.slice(0, 12)}.`);
  }

  // Autorisation CTO : review APPROVED liée au HEAD, par un autorisateur habilité.
  const latestByUser = new Map();
  for (const review of reviews ?? []) {
    const login = String(review?.user?.login ?? "").toLowerCase();
    if (!login) continue;
    const prev = latestByUser.get(login);
    if (!prev || Number(review.id) > Number(prev.id)) latestByUser.set(login, review);
  }

  const rejected = [];
  let authorization = null;
  for (const review of reviews ?? []) {
    const lines = parseAuthorizationLines(review?.body);
    if (lines.length === 0) continue;
    const login = review?.user?.login;
    const tag = `review ${review?.id ?? "?"} de ${login ?? "inconnu"}`;
    if (isBot(review?.user)) { rejected.push(`${tag} : compte bot non habilité.`); continue; }
    if (cfg?.denied.some((d) => sameLogin(d, login))) { rejected.push(`${tag} : compte partagé ou refusé.`); continue; }
    if (!cfg?.authorizers.some((a) => sameLogin(a, login))) { rejected.push(`${tag} : auteur absent de la liste des autorisateurs.`); continue; }
    if (sameLogin(login, author)) { rejected.push(`${tag} : l'auteur de la PR ne peut pas s'autoriser.`); continue; }
    if (review.state !== "APPROVED") { rejected.push(`${tag} : review à l'état ${review.state}, pas APPROVED.`); continue; }
    if (latestByUser.get(String(login).toLowerCase())?.id !== review.id) {
      rejected.push(`${tag} : remplacée par une review plus récente du même autorisateur.`); continue;
    }
    if (review.commit_id !== head) { rejected.push(`${tag} : donnée sur ${String(review.commit_id).slice(0, 12)}, pas sur le HEAD courant.`); continue; }
    const match = lines.find((l) => l.pr === number && l.head === head && l.target === target);
    if (!match) {
      const l = lines[0];
      rejected.push(`${tag} : contrat PR=#${l.pr} HEAD=${l.head.slice(0, 12)} TARGET=${l.target} ≠ PR=#${number} HEAD=${head.slice(0, 12)} TARGET=${target}.`);
      continue;
    }
    authorization = { reviewId: review.id, login, head, target, pr: number };
    break;
  }

  if (!authorization) {
    reasons.push(
      rejected.length
        ? `Aucune autorisation CTO valide : ${rejected.join(" ")}`
        : `Aucune autorisation CTO : attendu une review APPROVED contenant « CTO-GO-MERGE PR=#${number} HEAD=${head} TARGET=${target} ».`,
    );
  }

  return { authorized: reasons.length === 0 && authorization !== null, reasons, authorization };
}
