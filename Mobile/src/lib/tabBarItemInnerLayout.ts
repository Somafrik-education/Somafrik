/**
 * Géométrie interne propriétaire SomafrikBottomTabBar.
 * Ne dépend plus de tabVerticalUiKit / CompactTabButton (#415).
 *
 * Repère item : Y = 0 au top de l'item, croissant vers le bas.
 * L'espace sous le libellé est une constante 2–5 dp, pas le slack flex-start.
 */

import { TAB_BAR_CONTENT_HEIGHT, TAB_LABEL_FONT_SIZE } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

export const SOMAFRIK_TAB_ICON_DP = 20;
export const SOMAFRIK_TAB_LABEL_LINE_DP = TAB_LABEL_FONT_SIZE + 2;
export const SOMAFRIK_TAB_ICON_LABEL_GAP_DP = 2;
export const SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP = 3;
export const SOMAFRIK_TAB_SPACE_BELOW_LABEL_MIN_DP = 2;
export const SOMAFRIK_TAB_SPACE_BELOW_LABEL_MAX_DP = 5;

export type SomafrikTabItemGeometry = {
  itemHeight: number;
  itemTop: number;
  itemBottom: number;
  iconTop: number;
  iconBottom: number;
  labelTop: number;
  labelBottom: number;
  spaceBelowLabel: number;
};

export function computeSomafrikTabItemGeometry(
  itemHeight: number = TAB_BAR_CONTENT_HEIGHT,
): SomafrikTabItemGeometry {
  const spaceBelowLabel = SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP;
  const labelBottom = itemHeight - spaceBelowLabel;
  const labelTop = labelBottom - SOMAFRIK_TAB_LABEL_LINE_DP;
  const iconBottom = labelTop - SOMAFRIK_TAB_ICON_LABEL_GAP_DP;
  const iconTop = iconBottom - SOMAFRIK_TAB_ICON_DP;
  return {
    itemHeight,
    itemTop: 0,
    itemBottom: itemHeight,
    iconTop,
    iconBottom,
    labelTop,
    labelBottom,
    spaceBelowLabel,
  };
}

/**
 * Projette la géométrie d'item (Y=0 au top, vers le bas) dans le repère
 * chrome #414 (Y=0 au bas du parent, vers le haut).
 */
export function projectItemToParentUp(
  item: SomafrikTabItemGeometry,
  itemBottomFromParent: number,
) {
  const itemTop = itemBottomFromParent + item.itemHeight;
  return {
    itemTop,
    itemBottom: itemBottomFromParent,
    iconTop: itemTop - item.iconTop,
    iconBottom: itemTop - item.iconBottom,
    labelTop: itemTop - item.labelTop,
    labelBottom: itemTop - item.labelBottom,
    spaceBelowLabel: item.spaceBelowLabel,
  };
}

export function tabItemTouchTargetOk(itemHeight: number = TAB_BAR_CONTENT_HEIGHT): boolean {
  return itemHeight >= MIN_TOUCH_TARGET_DP;
}

export function spaceBelowLabelIsWithinAndroidBudget(spaceBelowLabel: number): boolean {
  return (
    spaceBelowLabel >= SOMAFRIK_TAB_SPACE_BELOW_LABEL_MIN_DP &&
    spaceBelowLabel <= SOMAFRIK_TAB_SPACE_BELOW_LABEL_MAX_DP
  );
}
