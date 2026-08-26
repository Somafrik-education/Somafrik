/**
 * Layout responsive — écran « Connexion établissement » (RoleSelectionScreen).
 * Tailles dérivées de la largeur/hauteur disponibles, jamais d'un modèle de téléphone.
 */

import { MIN_TOUCH_TARGET } from "./loginScreenSpec";

export const ROLE_SELECTION_NAV_TITLE = "Connexion établissement";
export const ROLE_SELECTION_NAV_TITLE_MAX_PX = 20;
export const ROLE_SELECTION_TITLE_MAX_PHONE_PX = 34;
export const ROLE_SELECTION_TITLE_MIN_PHONE_PX = 26;
export const ROLE_SELECTION_STACK_HEADER_DP = 56;
export const ROLE_SELECTION_API_STATUS_PREFIX = "API : ";

export const ROLE_SELECTION_VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "360x800", width: 360, height: 800 },
  { name: "393x852", width: 393, height: 852 },
  { name: "412x915", width: 412, height: 915 },
] as const;

export type RoleSelectionLayout = {
  compact: boolean;
  tight: boolean;
  screenPaddingTop: number;
  screenPaddingHorizontal: number;
  screenPaddingBottom: number;
  brandLogo: number;
  brandTitle: number;
  brandSubtitle: number;
  brandGap: number;
  headerMarginBottom: number;
  heroMarginBottom: number;
  eyebrow: number;
  title: number;
  titleLineHeight: number;
  description: number;
  descriptionLineHeight: number;
  code: number;
  button: number;
  buttonMinHeight: number;
  panelPadding: number;
  schoolLogo: number;
  diagnosticFont: number;
  showHelp: boolean;
};

export function formatRoleSelectionApiStatus(apiBaseUrl: string): string {
  return `${ROLE_SELECTION_API_STATUS_PREFIX}${apiBaseUrl}`;
}

export function getRoleSelectionLayout(
  width: number,
  height: number,
  fontScale = 1,
): RoleSelectionLayout {
  const scale = Math.min(Math.max(fontScale, 1), 1.35);
  const short = height < 760;
  const tight = height < 640 || width < 340;
  const roomy = width >= 400 && height >= 850;

  const title = tight ? 26 : short ? 28 : roomy ? 32 : 30;
  const brandLogo = tight ? 36 : short ? 40 : 44;
  const buttonMinHeight = Math.max(MIN_TOUCH_TARGET, Math.round(48 * Math.min(scale, 1.2)));

  return {
    compact: short,
    tight,
    screenPaddingTop: tight ? 6 : short ? 8 : 12,
    screenPaddingHorizontal: width < 340 ? 14 : 20,
    screenPaddingBottom: tight ? 12 : 16,
    brandLogo,
    brandTitle: tight ? 18 : short ? 20 : 22,
    brandSubtitle: tight ? 11 : 12,
    brandGap: tight ? 8 : 10,
    headerMarginBottom: tight ? 8 : short ? 10 : 14,
    heroMarginBottom: tight ? 8 : short ? 10 : 14,
    eyebrow: tight ? 12 : 13,
    title,
    titleLineHeight: Math.round(title * 1.18),
    description: tight ? 14 : 16,
    descriptionLineHeight: tight ? 18 : 21,
    code: tight ? 20 : short ? 22 : 24,
    button: tight ? 16 : 17,
    buttonMinHeight,
    panelPadding: tight ? 12 : 14,
    schoolLogo: tight ? 36 : 40,
    diagnosticFont: 11,
    showHelp: !tight && !short,
  };
}

function estimateWrappedHeight(
  text: string,
  fontSize: number,
  lineHeight: number,
  availableWidth: number,
  fontScale: number,
): number {
  const avgChar = Math.max(6, fontSize * 0.56 * fontScale);
  const charsPerLine = Math.max(8, Math.floor(availableWidth / avgChar));
  const lines = Math.max(1, Math.ceil(String(text).length / charsPerLine));
  return Math.ceil(lineHeight * fontScale * lines);
}

export type RoleSelectionMeasure = {
  layout: RoleSelectionLayout;
  estimatedContentHeight: number;
  availableHeight: number;
  fitsWithoutScroll: boolean;
  schoolCardInFlow: true;
  titlePx: number;
  navTitlePx: number;
};

export function measureRoleSelectionScreen(
  viewport: { width: number; height: number },
  options: {
    schoolResolved: boolean;
    fontScale?: number;
    title: string;
    description: string;
  },
): RoleSelectionMeasure {
  const fontScale = options.fontScale ?? 1;
  const layout = getRoleSelectionLayout(viewport.width, viewport.height, fontScale);
  const availableHeight = Math.max(0, viewport.height - ROLE_SELECTION_STACK_HEADER_DP);
  const contentWidth = Math.max(
    200,
    viewport.width - layout.screenPaddingHorizontal * 2 - layout.panelPadding * 2,
  );
  const heroWidth = Math.max(200, viewport.width - layout.screenPaddingHorizontal * 2);

  const brand = Math.max(layout.brandLogo, Math.ceil(layout.brandTitle * fontScale) + Math.ceil(layout.brandSubtitle * fontScale) + 4);
  const eyebrow = options.schoolResolved ? 0 : Math.ceil(layout.eyebrow * 1.2 * fontScale) + 4;
  const titleH = options.schoolResolved
    ? 0
    : estimateWrappedHeight(
        options.title,
        layout.title,
        layout.titleLineHeight,
        heroWidth,
        fontScale,
      );
  const descriptionH = options.schoolResolved
    ? 0
    : estimateWrappedHeight(
        options.description,
        layout.description,
        layout.descriptionLineHeight,
        heroWidth,
        fontScale,
      ) + 6;

  const fieldLabel = Math.ceil(15 * fontScale) + 6;
  const fieldInput = Math.max(layout.buttonMinHeight, 48);
  const verify = options.schoolResolved ? 0 : layout.buttonMinHeight + 8;
  const diagnostic = options.schoolResolved ? 0 : Math.ceil(layout.diagnosticFont * 1.4 * fontScale) + 8;
  const help = layout.showHelp && !options.schoolResolved ? Math.ceil(16 * fontScale) + 24 : 0;

  const schoolBlock = options.schoolResolved
    ? Math.max(layout.schoolLogo, Math.ceil(18 * fontScale) * 2) + 8 + layout.buttonMinHeight + 36
    : 0;

  const estimatedContentHeight =
    layout.screenPaddingTop +
    brand +
    layout.headerMarginBottom +
    eyebrow +
    titleH +
    descriptionH +
    layout.heroMarginBottom +
    layout.panelPadding * 2 +
    fieldLabel +
    fieldInput +
    10 +
    verify +
    diagnostic +
    schoolBlock +
    help +
    layout.screenPaddingBottom;

  return {
    layout,
    estimatedContentHeight,
    availableHeight,
    fitsWithoutScroll: estimatedContentHeight <= availableHeight,
    schoolCardInFlow: true,
    titlePx: layout.title,
    navTitlePx: ROLE_SELECTION_NAV_TITLE_MAX_PX,
  };
}

export function roleSelectionFitsNominalViewports(fontScale = 1, copy: { title: string; description: string }): boolean {
  const nominal = ROLE_SELECTION_VIEWPORTS.filter((v) => v.height >= 800);
  return nominal.every((viewport) => {
    const before = measureRoleSelectionScreen(viewport, { schoolResolved: false, fontScale, ...copy });
    const after = measureRoleSelectionScreen(viewport, { schoolResolved: true, fontScale, ...copy });
    return before.fitsWithoutScroll && after.fitsWithoutScroll;
  });
}
