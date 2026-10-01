import { normalize } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

const LINK_TOKENS = ["Relations:CREATE", "Gérer utilisateurs"];

const ARCHIVE_TOKENS = [...LINK_TOKENS, "Relations:UPDATE"];

type LinkingSession = {
  role?: string;
  permissions?: unknown[];
  user?: { role?: string; permissions?: unknown[] };
} | null;

function isPlatformAdminSession(session: LinkingSession) {
  const role = session?.user?.role ?? session?.role;
  return isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE;
}

function sessionTokens(session: LinkingSession) {
  const raw = [
    ...((session?.permissions as unknown[]) ?? []),
    ...((session?.user?.permissions as unknown[]) ?? []),
  ];
  return raw.map((item) => normalize(String(item ?? "")));
}

export function canLinkParentMobile(session: LinkingSession) {
  if (!session || isPlatformAdminSession(session)) return false;
  const tokens = sessionTokens(session);
  return LINK_TOKENS.some((token) => tokens.includes(normalize(token)));
}

export function canArchiveParentRelationMobile(session: LinkingSession) {
  if (!session || isPlatformAdminSession(session)) return false;
  const tokens = sessionTokens(session);
  return ARCHIVE_TOKENS.some((token) => tokens.includes(normalize(token)));
}
