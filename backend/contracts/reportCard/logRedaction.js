"use strict";

const TOKEN_PATH = /\/verify\/rc\/([^./\s]+)\.([^/\s?#]+)/g;

function redactVerifyUrl(text) {
  if (text == null) return text;
  return String(text).replace(TOKEN_PATH, "/verify/rc/$1.[redacted]");
}

function assertTokenAbsentFromLogs(logs, token) {
  const blob = Array.isArray(logs) ? logs.join("\n") : String(logs);
  if (!token) throw new Error("token required");
  if (blob.includes(token)) {
    throw new Error("token plaintext in logs");
  }
  const prefix = token.slice(0, 8);
  if (prefix.length >= 8 && blob.includes(prefix)) {
    throw new Error("token prefix in logs");
  }
}

function rateLimitKey({ ip, publicId, tokenHash }) {
  if (tokenHash) return `hash:${tokenHash}`;
  if (publicId) return `pid:${publicId}`;
  if (ip) return `ip:${ip}`;
  throw new Error("rate limit key requires ip, public_id or token_hash");
}

module.exports = {
  redactVerifyUrl,
  assertTokenAbsentFromLogs,
  rateLimitKey,
};
