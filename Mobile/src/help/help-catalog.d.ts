declare module "@somafrik/help-catalog" {
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
  export const HELP_CATALOG: readonly HelpArticle[];

  export function createHelpContext(input: HelpContextInput): HelpContext;
  export function isHelpAvailable(context: HelpContext): boolean;
  export function navigationIsAllowed(article: HelpArticle, context: HelpContext): boolean;
  export function filterHelpArticles(context: HelpContext): readonly HelpArticle[];
  export function searchHelpArticles(context: HelpContext, query: string): readonly HelpArticle[];
  export function suggestHelpArticles(
    context: HelpContext,
    options?: { limit?: number },
  ): readonly HelpArticle[];
  export function popularHelpArticles(
    context: HelpContext,
    options?: { limit?: number },
  ): readonly HelpArticle[];
}
