"use strict";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

function readDeployGitSha(env = process.env) {
  const raw = env && env.RENDER_GIT_COMMIT;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!FULL_GIT_SHA.test(value)) return null;
  return value.toLowerCase();
}

function withDeployGitSha(payload, env = process.env) {
  return {
    ...payload,
    gitSha: readDeployGitSha(env),
  };
}

module.exports = {
  readDeployGitSha,
  withDeployGitSha,
};
