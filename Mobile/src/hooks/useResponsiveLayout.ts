import { useWindowDimensions } from "react-native";

import { TABLET_CONTENT_MAX_WIDTH, TABLET_MIN_WIDTH } from "../lib/responsiveMobileSpec";

export { TABLET_MIN_WIDTH };

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const columns = isTablet ? 2 : 1;
  const contentMaxWidth = isTablet ? TABLET_CONTENT_MAX_WIDTH : width;
  const horizontalPadding = isTablet ? 32 : 20;

  return {
    width,
    height,
    isTablet,
    columns,
    contentMaxWidth,
    horizontalPadding,
    gridGap: isTablet ? 16 : 14,
  };
}
