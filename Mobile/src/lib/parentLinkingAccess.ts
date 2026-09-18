import { normalize } from "./format";

const LINK_TOKENS = [
  "Relations:CREATE",
  "Gérer utilisateurs",
  "ALL_PRIVILEGES",
  "COUNTRY_PRIVILEGES",
];

const ARCHIVE_TOKENS = [...LINK_TOKENS, "Relations:UPDATE"];

function sessionTokens(session: { permissions?: unknown[]; user?: { permissions?: unknown[] } } | null) {
  const raw = [
    ...((session?.permissions as unknown[]) ?? []),
    ...((session?.user?.permissions as unknown[]) ?? []),
  ];
  return raw.map((item) => normalize(String(item ?? "")));
}

export function canLinkParentMobile(session: { permissions?: unknown[]; user?: { permissions?: unknown[] } } | null) {
  if (!session) return false;
  const tokens = sessionTokens(session);
  return LINK_TOKENS.some((token) => tokens.includes(normalize(token)));
}

export function canArchiveParentRelationMobile(
  session: { permissions?: unknown[]; user?: { permissions?: unknown[] } } | null,
) {
  if (!session) return false;
  const tokens = sessionTokens(session);
  return ARCHIVE_TOKENS.some((token) => tokens.includes(normalize(token)));
}
