export const REPORT_CARD_VERIFY_PATH_PREFIX = "/verify/rc";

export function isReportCardPublicVerifyPath(pathname: string): boolean {
  const path = String(pathname || "").split("?")[0];
  return path === REPORT_CARD_VERIFY_PATH_PREFIX || path.startsWith(`${REPORT_CARD_VERIFY_PATH_PREFIX}/`);
}

export function reportCardVerifyRouterBasename(
  pathname: string,
  appBasename?: string | undefined,
): string | undefined {
  if (isReportCardPublicVerifyPath(pathname)) return undefined;
  if (!appBasename || appBasename === "/") return undefined;
  return appBasename.replace(/\/$/, "");
}

export function reportCardVerifyPublicPath(capability: string): string {
  return `${REPORT_CARD_VERIFY_PATH_PREFIX}/${capability}`;
}
