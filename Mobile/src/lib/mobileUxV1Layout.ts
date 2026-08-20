/**
 * Contrats UX/UI Mobile V1.1 — layout compact, petits écrans, bottom nav.
 * Logique pure, testable hors device.
 */

import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

export const UX_V1_SPEC_VERSION = "1.1";

/** Viewports Android représentatifs (dp). */
export const UX_V1_VIEWPORTS = [320, 360, 390, 412] as const;
export const UX_V1_VALIDATION_VIEWPORT = { width: 360, height: 800 } as const;

export const COMPACT_HEADER_ROW_DP = MIN_TOUCH_TARGET_DP;
export const COMPACT_WELCOME_MAX_DP = 110;
export const HOME_SCROLL_TOP_DP = 8;
export const OVERVIEW_SECTION_HEADER_DP = 28;
export const KPI_ROW_MIN_DP = 108;
export const FLOATING_TAB_BAR_HEIGHT_V11 = 64;
export const TAB_BAR_SIDE_INSET_DP = 8;
export const TAB_BAR_INNER_PADDING_DP = 4;
export const MAX_BOTTOM_TABS = 5;
export const MAX_ROLE_TABS = 4;
export const MAX_TAB_LABEL_CHARS = 8;
export const TAB_LABEL_FONT_SIZE = 11;
export const MAX_FONT_SCALE = 1.3;

/** school_admin — libellés courts, zéro troncature type Utilisate... / Enseigna... */
export const SCHOOL_ADMIN_BOTTOM_LABELS = ["Accueil", "Classes", "Frais", "Comptes", "Profs"] as const;

export function tabBarItemWidth(viewportWidth: number, tabCount = MAX_BOTTOM_TABS): number {
  const chrome = TAB_BAR_SIDE_INSET_DP * 2 + TAB_BAR_INNER_PADDING_DP * 2;
  return Math.floor((viewportWidth - chrome) / Math.max(tabCount, 1));
}

export function estimatedLabelWidth(label: string, fontScale = 1): number {
  const scale = Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  return Math.ceil(label.length * TAB_LABEL_FONT_SIZE * 0.62 * scale);
}

export function tabLabelFitsViewport(
  label: string,
  viewportWidth: number,
  options: { tabCount?: number; fontScale?: number } = {},
): boolean {
  if (label.length > MAX_TAB_LABEL_CHARS) return false;
  const itemWidth = tabBarItemWidth(viewportWidth, options.tabCount ?? MAX_BOTTOM_TABS) - 2;
  const needed = estimatedLabelWidth(label, options.fontScale ?? 1);
  if (needed <= itemWidth) return true;
  // CompactTabLabel : adjustsFontSizeToFit jusqu'à minimumFontScale 0.75 — pas d'ellipsis.
  return needed * 0.75 <= itemWidth;
}

export function schoolAdminLabelsFitAllViewports(fontScale = 1): boolean {
  return UX_V1_VIEWPORTS.every((width) =>
    SCHOOL_ADMIN_BOTTOM_LABELS.every((label) => tabLabelFitsViewport(label, width, { fontScale })),
  );
}

export function homeAboveFoldHeight(insets: { top: number; bottom: number }): {
  header: number;
  tabBar: number;
  neededContent: number;
  chrome: number;
} {
  const header = insets.top + COMPACT_HEADER_ROW_DP;
  const tabBar = FLOATING_TAB_BAR_HEIGHT_V11 + Math.max(insets.bottom, 8) + 6;
  const neededContent =
    HOME_SCROLL_TOP_DP + COMPACT_WELCOME_MAX_DP + OVERVIEW_SECTION_HEADER_DP + KPI_ROW_MIN_DP;
  return { header, tabBar, neededContent, chrome: header + tabBar };
}

/** Sur ~360×800 : header + welcome compact + Vue d’ensemble + 2 KPI avant la bottom nav. */
export function homeAboveFoldFits(
  viewport: { width: number; height: number } = UX_V1_VALIDATION_VIEWPORT,
  insets: { top: number; bottom: number } = { top: 24, bottom: 16 },
): boolean {
  const { neededContent, chrome } = homeAboveFoldHeight(insets);
  return neededContent + chrome <= viewport.height;
}
