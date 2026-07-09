/**
 * Contrat UI/UX de l'écran d'accueil mobile (Welcome).
 * Partagé entre tests unitaires (vitest) et E2E UI (Playwright).
 */

export const WELCOME_SCREEN_COPY = {
  brandName: "Somafrik",
  parentBrand: "par Somafrik",
  subtitle: "ERP scolaire mobile et tablette pour tous les rôles.",
  loginButtonLabel: "Se connecter",
} as const;

export const WELCOME_TEST_IDS = {
  screen: "welcome-screen",
  logo: "welcome-logo",
  brand: "welcome-brand",
  parentBrand: "welcome-parent-brand",
  subtitle: "welcome-subtitle",
  loginButton: "welcome-login-button",
} as const;

export type SafeAreaInsets = { top: number; bottom: number };

export type ViewportSize = {
  name: string;
  width: number;
  height: number;
  insets?: SafeAreaInsets;
};

/** Viewports mobiles courants pour la vérification responsive. */
export const MOBILE_VIEWPORTS: ViewportSize[] = [
  { name: "iPhone SE", width: 375, height: 667, insets: { top: 20, bottom: 0 } },
  { name: "iPhone 13", width: 390, height: 844, insets: { top: 47, bottom: 34 } },
  { name: "Pixel 5", width: 393, height: 851, insets: { top: 24, bottom: 20 } },
  { name: "Small Android", width: 360, height: 640, insets: { top: 24, bottom: 0 } },
];

/** Métriques alignées sur WelcomeScreen.tsx (StyleSheet). */
export const WELCOME_LAYOUT = {
  containerPadding: 24,
  logoBoxHeight: 148,
  logoMarginBottom: 20,
  brandFontSize: 40,
  brandLineHeight: 48,
  parentBrandFontSize: 13,
  parentBrandLineHeight: 18,
  parentBrandMarginTop: 4,
  subtitleFontSize: 16,
  subtitleLineHeight: 22,
  subtitleMarginTop: 10,
  subtitleMarginBottom: 34,
  buttonVerticalPadding: 15,
  buttonFontSize: 16,
  buttonLineHeight: 20,
} as const;

const DEFAULT_INSETS: SafeAreaInsets = { top: 44, bottom: 34 };

/** Temps max acceptable pour l'affichage complet (animation incluse). */
export const WELCOME_MAX_DISPLAY_MS = 1500;

/**
 * Estime la hauteur verticale occupée par le contenu centré
 * (logo → bouton « Se connecter »), hors safe areas.
 */
export function estimateWelcomeContentHeight(insets: SafeAreaInsets = DEFAULT_INSETS): number {
  const layout = WELCOME_LAYOUT;
  const subtitleLines = 2;
  const subtitleBlock =
    layout.subtitleMarginTop +
    layout.subtitleLineHeight * subtitleLines +
    layout.subtitleMarginBottom;
  const buttonBlock = layout.buttonVerticalPadding * 2 + layout.buttonLineHeight;

  return (
    insets.top +
    insets.bottom +
    layout.containerPadding * 2 +
    layout.logoBoxHeight +
    layout.logoMarginBottom +
    layout.brandLineHeight +
    layout.parentBrandMarginTop +
    layout.parentBrandLineHeight +
    subtitleBlock +
    buttonBlock
  );
}

export function welcomeFitsViewport(
  viewport: Pick<ViewportSize, "width" | "height"> & { insets?: SafeAreaInsets },
): boolean {
  const insets = viewport.insets ?? DEFAULT_INSETS;
  return estimateWelcomeContentHeight(insets) <= viewport.height;
}

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function boxWithinViewport(
  box: BoundingBox,
  viewport: Pick<ViewportSize, "width" | "height">,
  tolerance = 2,
): boolean {
  return (
    box.x >= -tolerance &&
    box.y >= -tolerance &&
    box.x + box.width <= viewport.width + tolerance &&
    box.y + box.height <= viewport.height + tolerance &&
    box.width > 0 &&
    box.height > 0
  );
}

export function boxesOverlap(a: BoundingBox, b: BoundingBox, tolerance = 1): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  const separated =
    aRight <= b.x + tolerance ||
    bRight <= a.x + tolerance ||
    aBottom <= b.y + tolerance ||
    bBottom <= a.y + tolerance;
  return !separated;
}

export function assertNoSiblingOverlap(boxes: BoundingBox[]): string | null {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        return `Chevauchement détecté entre l'élément ${i + 1} et ${j + 1}.`;
      }
    }
  }
  return null;
}
