import { navigationIsAllowed, type HelpArticle, type HelpContext } from "@somafrik/help-catalog";

export function helpMobileRoute(article: HelpArticle, context: HelpContext): string | null {
  if (!navigationIsAllowed(article, context)) return null;
  const route = article.navigate?.mobileRoute;
  if (typeof route !== "string" || route.trim() === "") return null;
  return route.trim();
}
