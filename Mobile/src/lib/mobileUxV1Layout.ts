/**
 * Contrats UX/UI Mobile V2 — coque Accueil unique (référence Préfet).
 * Logique pure, testable hors device. Les nombres doivent matcher le StyleSheet.
 */

import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

import { MAX_HOME_KPIS } from "./roleHomeConfig";

export const UX_V1_SPEC_VERSION = "2.0";

export const UX_V1_VIEWPORTS = [320, 360, 390, 412] as const;
export const UX_V1_FONT_SCALES = [1, 1.3] as const;
export const UX_V1_VALIDATION_VIEWPORT = { width: 360, height: 800 } as const;

export const COMPACT_HEADER_ROW_DP = MIN_TOUCH_TARGET_DP;
export const HEADER_MENU_SLOT_DP = MIN_TOUCH_TARGET_DP;
export const HEADER_ACTIONS_SLOT_DP = MIN_TOUCH_TARGET_DP * 3;
export const HEADER_BADGE_BAND_DP = 18;
export const COMPACT_WELCOME_MAX_DP = 40;
export const IDENTITY_CARD_MIN_DP = 88;
export const MISSION_BANNER_MIN_DP = 72;
export const HOME_SCROLL_TOP_DP = 4;
export const OVERVIEW_SECTION_HEADER_DP = 24;
export const KPI_ROW_MIN_DP = 92;
export const TAB_BAR_CONTENT_HEIGHT = 52;
export const TAB_BAR_SIDE_INSET_DP = 0;
export const TAB_BAR_INNER_PADDING_DP = 0;
export const TAB_BAR_GAP_DP = 0;
export const MAX_BOTTOM_TABS = 5;
export const MAX_ROLE_TABS = 4;
export const MAX_TAB_LABEL_CHARS = 8;
export { MAX_HOME_KPIS };
export const TAB_LABEL_FONT_SIZE = 10;
export const MAX_FONT_SCALE = 1.3;

/** Alias conservé pour screenLayout. */
export const FLOATING_TAB_BAR_HEIGHT_V11 = TAB_BAR_CONTENT_HEIGHT;

export const SCHOOL_ADMIN_BOTTOM_LABELS = ["Accueil", "Classes", "Frais", "Comptes", "Profs"] as const;

/** Libellés courts imposés — jamais le tabName long (`Utilisateurs`, `Enseignants`). */
export const BOTTOM_TAB_SHORT_LABELS: Record<string, string> = {
  Accueil: "Accueil",
  Classes: "Classes",
  Paiements: "Frais",
  Payments: "Frais",
  Utilisateurs: "Comptes",
  Users: "Comptes",
  Enseignants: "Profs",
  Teachers: "Profs",
};

export function shortBottomTabLabel(tabName: string, fallback?: string): string {
  return BOTTOM_TAB_SHORT_LABELS[tabName] ?? fallback ?? tabName;
}

export function tabBarItemWidth(viewportWidth: number, tabCount = MAX_BOTTOM_TABS): number {
  const chrome = TAB_BAR_SIDE_INSET_DP * 2 + TAB_BAR_INNER_PADDING_DP * 2;
  return Math.floor((viewportWidth - chrome) / Math.max(tabCount, 1));
}

export function estimatedLabelWidth(label: string, fontScale = 1): number {
  const scale = Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  return Math.ceil(label.length * TAB_LABEL_FONT_SIZE * 0.58 * scale);
}

export function tabLabelFitsViewport(
  label: string,
  viewportWidth: number,
  options: { tabCount?: number; fontScale?: number } = {},
): boolean {
  if (label.length > MAX_TAB_LABEL_CHARS) return false;
  const itemWidth = tabBarItemWidth(viewportWidth, options.tabCount ?? MAX_BOTTOM_TABS) - 4;
  const needed = estimatedLabelWidth(label, options.fontScale ?? 1);
  return needed <= itemWidth;
}

export function schoolAdminLabelsFitAllViewports(fontScale = 1): boolean {
  return UX_V1_VIEWPORTS.every((width) =>
    SCHOOL_ADMIN_BOTTOM_LABELS.every((label) => tabLabelFitsViewport(label, width, { fontScale })),
  );
}

export type HomeShellBoxes = {
  headerBottom: number;
  welcomeBottom: number;
  overviewBottom: number;
  kpiRowBottom: number;
  tabTop: number;
  kpiCompleteAboveTab: boolean;
};

/** Mesure du shell Accueil school_admin — doit coller aux styles V1.2. */
export function measureHomeShell(
  viewport: { width: number; height: number } = UX_V1_VALIDATION_VIEWPORT,
  insets: { top: number; bottom: number } = { top: 24, bottom: 16 },
  fontScale = 1,
): HomeShellBoxes {
  const scale = Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  const headerBottom = insets.top + HEADER_BADGE_BAND_DP + COMPACT_HEADER_ROW_DP;
  const identityHeight = Math.ceil(IDENTITY_CARD_MIN_DP * Math.min(scale, 1.12));
  const bannerHeight = Math.ceil(MISSION_BANNER_MIN_DP * Math.min(scale, 1.12));
  const welcomeBottom = headerBottom + HOME_SCROLL_TOP_DP + identityHeight + bannerHeight;
  const overviewHeight = Math.ceil(OVERVIEW_SECTION_HEADER_DP * Math.min(scale, 1.15));
  const overviewBottom = welcomeBottom + overviewHeight;
  const kpiHeight = Math.ceil(KPI_ROW_MIN_DP * Math.min(scale, 1.12));
  const kpiRowBottom = overviewBottom + kpiHeight;
  const tabTop = viewport.height - (TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_GAP_DP);
  return {
    headerBottom,
    welcomeBottom,
    overviewBottom,
    kpiRowBottom,
    tabTop,
    kpiCompleteAboveTab: kpiRowBottom <= tabTop - 8,
  };
}

export function homeAboveFoldFits(
  viewport: { width: number; height: number } = UX_V1_VALIDATION_VIEWPORT,
  insets: { top: number; bottom: number } = { top: 24, bottom: 16 },
  fontScale = 1,
): boolean {
  return measureHomeShell(viewport, insets, fontScale).kpiCompleteAboveTab;
}

export function homeAboveFoldFitsAllViewports(): boolean {
  const insets = { top: 24, bottom: 16 };
  return UX_V1_VIEWPORTS.every((width) =>
    UX_V1_FONT_SCALES.every((fontScale) =>
      homeAboveFoldFits({ width, height: Math.max(640, Math.round(width * 800 / 360)) }, insets, fontScale),
    ),
  );
}
