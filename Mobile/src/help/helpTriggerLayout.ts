import { TAB_BAR_CONTENT_HEIGHT } from "../lib/mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP, touchTargetMeetsMinimum } from "../lib/mobileUsability";

/** Rendu visuel compact — la zone tactile est élargie via hitSlop. */
export const HELP_TRIGGER_VISUAL_DP = 36;
export const HELP_TRIGGER_HIT_SLOP_DP = 6;
export const HELP_TRIGGER_SIDE_INSET_DP = 16;
export const HELP_TRIGGER_ABOVE_TAB_GAP_DP = 16;

export const HELP_TRIGGER_HIT_SLOP = {
  top: HELP_TRIGGER_HIT_SLOP_DP,
  bottom: HELP_TRIGGER_HIT_SLOP_DP,
  left: HELP_TRIGGER_HIT_SLOP_DP,
  right: HELP_TRIGGER_HIT_SLOP_DP,
} as const;

export function helpTriggerBottomOffset(insetsBottom = 0): number {
  const safeBottom = Math.max(insetsBottom, 8);
  return safeBottom + TAB_BAR_CONTENT_HEIGHT + HELP_TRIGGER_ABOVE_TAB_GAP_DP;
}

export function helpTriggerLayout(input: {
  viewportWidth: number;
  insetsBottom?: number;
  keyboardVisible?: boolean;
}): {
  visible: boolean;
  right: number;
  bottom: number;
  visual: number;
  touch: { width: number; height: number };
  overlapsRightEdge: boolean;
} {
  const visual = HELP_TRIGGER_VISUAL_DP;
  const bottom = helpTriggerBottomOffset(input.insetsBottom);
  const right = HELP_TRIGGER_SIDE_INSET_DP;
  const touchWidth = visual + HELP_TRIGGER_HIT_SLOP.left + HELP_TRIGGER_HIT_SLOP.right;
  const touchHeight = visual + HELP_TRIGGER_HIT_SLOP.top + HELP_TRIGGER_HIT_SLOP.bottom;
  return {
    visible: !input.keyboardVisible,
    right,
    bottom,
    visual,
    touch: { width: touchWidth, height: touchHeight },
    overlapsRightEdge: right + visual > input.viewportWidth,
  };
}

export function helpTriggerMeetsTouchMinimum(): boolean {
  return touchTargetMeetsMinimum({
    width: HELP_TRIGGER_VISUAL_DP,
    height: HELP_TRIGGER_VISUAL_DP,
    hitSlop: HELP_TRIGGER_HIT_SLOP,
  }, MIN_TOUCH_TARGET_DP);
}
