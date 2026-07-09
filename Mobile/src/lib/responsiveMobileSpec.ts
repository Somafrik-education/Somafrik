/**
 * Contrat UI/UX — adaptation responsive mobile / tablette (écrans authentifiés).
 */
import { boxWithinViewport, type ViewportSize } from "./welcomeScreenSpec";

export const TABLET_MIN_WIDTH = 768;
export const TABLET_CONTENT_MAX_WIDTH = 960;

export type ResponsiveViewportCategory = "small-android" | "iphone" | "large-android" | "tablet";

export type ResponsiveViewport = ViewportSize & {
  orientation: "portrait" | "landscape";
  category: ResponsiveViewportCategory;
  /** Playwright `isMobile` — false pour tablette. */
  isMobile?: boolean;
};

/** Viewports pour E2E 11 — petit / grand Android, iPhone, tablette, paysage. */
export const RESPONSIVE_VIEWPORTS: ResponsiveViewport[] = [
  {
    name: "Small Android",
    width: 360,
    height: 640,
    orientation: "portrait",
    category: "small-android",
  },
  {
    name: "iPhone 13",
    width: 390,
    height: 844,
    orientation: "portrait",
    category: "iphone",
  },
  {
    name: "Large Android",
    width: 412,
    height: 915,
    orientation: "portrait",
    category: "large-android",
  },
  {
    name: "iPad Portrait",
    width: 768,
    height: 1024,
    orientation: "portrait",
    category: "tablet",
    isMobile: false,
  },
  {
    name: "iPhone 13 Landscape",
    width: 844,
    height: 390,
    orientation: "landscape",
    category: "iphone",
  },
  {
    name: "Large Android Landscape",
    width: 915,
    height: 412,
    orientation: "landscape",
    category: "large-android",
  },
];

export const RESPONSIVE_COPY = {
  homeOverview: "Vue d'ensemble",
  classesTitle: "Classes",
} as const;

export function isTabletViewport(viewport: Pick<ViewportSize, "width">): boolean {
  return viewport.width >= TABLET_MIN_WIDTH;
}

/** Largeur max attendue du contenu scrollable (alignée sur useResponsiveLayout). */
export function expectedContentMaxWidth(viewport: Pick<ViewportSize, "width">): number {
  if (!isTabletViewport(viewport)) {
    return viewport.width;
  }
  const horizontalPadding = 32;
  return Math.min(viewport.width - horizontalPadding * 2, TABLET_CONTENT_MAX_WIDTH);
}

export { boxWithinViewport };
