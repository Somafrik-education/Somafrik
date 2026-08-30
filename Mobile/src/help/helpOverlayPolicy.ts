import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

/**
 * Politique de superposition HELP-V1C Mobile.
 *
 * HELP est un View (pas un Modal natif) :
 *   - les Modal métier (CanonicalMutationModal, confirmations) s'empilent
 *     au-dessus via la fenêtre native — pas de double-overlay ambigu ;
 *   - Toast / Alert / erreurs restent visibles au-dessus de HELP ;
 *   - le trigger se masque si le clavier est ouvert (ne couvre pas un CTA
 *     Enregistrer / Ajouter ni un champ) ;
 *   - le trigger se masque si une modal métier est signalée ouverte.
 *
 * Empilement applicatif (zIndex View) :
 *   EnvironmentBadge     40
 *   Help sheet           30
 *   Help trigger         20
 *   Bottom tabs          10
 *
 * Géométrie : le FAB reste au-dessus des tabs (safe-area Android/iOS) et
 * d'une réserve CTA sticky ≥ 56 dp, taille tactile ≥ 44 dp.
 */

export const HELP_TRIGGER_ZINDEX = 20;
export const HELP_SHEET_ZINDEX = 30;
export const HELP_TRIGGER_SIZE_DP = MIN_TOUCH_TARGET_DP;
export const HELP_STICKY_CTA_RESERVE_DP = 72;
export const HELP_TRIGGER_GAP_DP = 12;
export const HELP_TRIGGER_SIDE_INSET_DP = 16;
export const HELP_FULLSCREEN_MAX_HEIGHT_DP = 700;

export interface HelpTriggerLayoutInput {
  hasTabBar: boolean;
  tabBarOccupiedHeight: number;
  safeBottom: number;
  keyboardVisible: boolean;
  businessModalOpen: boolean;
  helpOpen: boolean;
}

export interface HelpTriggerLayout {
  visible: boolean;
  bottom: number;
  right: number;
  size: number;
}

export function computeHelpTriggerLayout(input: HelpTriggerLayoutInput): HelpTriggerLayout {
  const hide =
    input.keyboardVisible || input.businessModalOpen || input.helpOpen;
  const base = input.hasTabBar ? Math.max(0, input.tabBarOccupiedHeight) : Math.max(0, input.safeBottom);
  return {
    visible: !hide,
    bottom: base + HELP_STICKY_CTA_RESERVE_DP,
    right: HELP_TRIGGER_SIDE_INSET_DP,
    size: HELP_TRIGGER_SIZE_DP,
  };
}

export function helpSheetUsesFullscreen(windowHeight: number): boolean {
  return windowHeight > 0 && windowHeight < HELP_FULLSCREEN_MAX_HEIGHT_DP;
}

export function boxesOverlap(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number } | null,
  padding = 4,
): boolean {
  if (!a || !b) return false;
  return !(
    a.x + a.width + padding < b.x ||
    a.x - padding > b.x + b.width ||
    a.y + a.height + padding < b.y ||
    a.y - padding > b.y + b.height
  );
}

export function helpTriggerBox(layout: HelpTriggerLayout, viewport: { width: number; height: number }) {
  return {
    x: viewport.width - layout.right - layout.size,
    y: viewport.height - layout.bottom - layout.size,
    width: layout.size,
    height: layout.size,
  };
}
