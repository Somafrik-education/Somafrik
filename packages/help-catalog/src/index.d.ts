export type HelpPlatform = "web" | "mobile";

export interface HelpNavigate {
  readonly level: "NAVIGATION";
  readonly webPath: string | null;
  readonly mobileRoute: string | null;
  readonly permission: string | null;
}

export interface HelpArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly order: number;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly platforms: readonly string[];
  readonly routeKeys: readonly string[];
  readonly keywords: readonly string[];
  readonly steps: readonly string[];
  readonly relatedArticles: readonly string[];
  readonly captureIds: readonly string[];
  readonly captureStatus: string;
  readonly sourceGuide: string;
  readonly popular: boolean;
  readonly navigate: HelpNavigate | null;
}

export interface HelpCategoryGroup {
  readonly id: string;
  readonly label: string;
  readonly articles: readonly HelpArticle[];
}

export interface HelpContext {
  readonly platform: HelpPlatform;
  readonly screen: string | null;
  readonly module: string | null;
  readonly role: string | null;
  readonly permissions: readonly string[];
}

export interface HelpContextInput {
  platform?: HelpPlatform;
  pathname?: string;
  routeName?: string;
  screen?: string | null;
  module?: string;
  role?: string;
  permissions?: readonly string[];
}

export const HELP_PLATFORM: { readonly WEB: "web"; readonly MOBILE: "mobile" };
export const HELP_ROLE: Readonly<Record<string, string>>;
export const HELP_SCREEN: Readonly<Record<string, string>>;
export const HELP_MODULE: Readonly<Record<string, string>>;
export const HELP_CATEGORY: Readonly<Record<string, string>>;
export const HELP_CATEGORY_LABELS: Readonly<Record<string, string>>;
export const HELP_CATEGORY_ORDER: readonly string[];
export const HELP_CATALOG: readonly HelpArticle[];
export const MODULE_BY_SCREEN: Readonly<Record<string, string>>;
export const SCHOOL_STAFF_ROLES: readonly string[];
export const ESTABLISHMENT_ADMIN_ROLES: readonly string[];
export const SCHOOL_SETTINGS_ROLES: readonly string[];
export const AUTHENTICATED_HELP_ROLES: readonly string[];

export function normalizeHelpText(value: unknown): string;
export function normalizeHelpRole(role: unknown): string | null;
export function resolveHelpCategory(article: HelpArticle): string;
export function helpCategoryLabel(category: string): string;
export function createHelpContext(input: HelpContextInput): HelpContext;
export function isHelpAvailable(context: HelpContext): boolean;
export function articleMatchesContext(article: HelpArticle, context: HelpContext): boolean;
export function navigationIsAllowed(article: HelpArticle, context: HelpContext): boolean;
export function sessionHasPermission(
  permissions: readonly string[] | null | undefined,
  required: string | null | undefined,
): boolean;
export function moduleForScreen(screen: string | null | undefined): string | null;
export function resolveHelpScreen(input: {
  platform?: HelpPlatform;
  pathname?: string;
  routeName?: string;
  screen?: string | null;
}): string | null;
export function filterHelpArticles(context: HelpContext): readonly HelpArticle[];
export function groupHelpArticlesByCategory(context: HelpContext): readonly HelpCategoryGroup[];
export function popularHelpArticles(
  context: HelpContext,
  options?: { limit?: number },
): readonly HelpArticle[];
export function searchHelpArticles(context: HelpContext, query: string): readonly HelpArticle[];
export function suggestHelpArticles(
  context: HelpContext,
  options?: { limit?: number },
): readonly HelpArticle[];
