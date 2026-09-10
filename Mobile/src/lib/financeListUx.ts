export const FINANCE_SUMMARY_STACK_BREAKPOINT_DP = 380;

export function financeSummaryColumns(viewportWidth: number): 1 | 2 {
  return viewportWidth <= FINANCE_SUMMARY_STACK_BREAKPOINT_DP ? 1 : 2;
}
