/**
 * Placement interne icon + label dans les 52 dp de l'item.
 * Ne touche pas à la safe-area (#414).
 *
 * React Navigation (uikit vertical) pose le stack en `flex-start` avec
 * `padding: 5`. L'espace restant se retrouve sous le libellé.
 * L'alignement `flex-end` le décale vers le bas du conteneur.
 */

import { TAB_BAR_CONTENT_HEIGHT, TAB_LABEL_FONT_SIZE } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

/** wrapperUikit height — TabBarIcon ICON_SIZE_TALL */
export const TAB_ITEM_ICON_BOX_DP = 28;
/** tabVerticalUiKit.padding */
export const TAB_ITEM_RN_PADDING_DP = 5;
export const TAB_ITEM_LABEL_HEIGHT_DP = TAB_LABEL_FONT_SIZE + 2;
export const TAB_ITEM_INNER_ALIGN = "flex-end" as const;

export type TabItemInnerAlign = "flex-start" | "flex-end";

export type TabItemInnerLayout = {
  itemHeight: number;
  clusterHeight: number;
  clusterTop: number;
  labelBottom: number;
  spaceBelowLabel: number;
  align: TabItemInnerAlign;
};

export function computeTabItemInnerLayout(
  itemHeight: number = TAB_BAR_CONTENT_HEIGHT,
  align: TabItemInnerAlign = TAB_ITEM_INNER_ALIGN,
): TabItemInnerLayout {
  const padding = TAB_ITEM_RN_PADDING_DP;
  const clusterHeight = TAB_ITEM_ICON_BOX_DP + TAB_ITEM_LABEL_HEIGHT_DP;
  const inner = Math.max(0, itemHeight - padding * 2);
  const slack = Math.max(0, inner - clusterHeight);
  const clusterTop = align === "flex-end" ? padding + slack : padding;
  const labelBottom = clusterTop + clusterHeight;
  const spaceBelowLabel = Math.max(0, itemHeight - labelBottom);
  return {
    itemHeight,
    clusterHeight,
    clusterTop,
    labelBottom,
    spaceBelowLabel,
    align,
  };
}

export function tabItemTouchTargetOk(itemHeight: number = TAB_BAR_CONTENT_HEIGHT): boolean {
  return itemHeight >= MIN_TOUCH_TARGET_DP;
}
