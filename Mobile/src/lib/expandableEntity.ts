/** Une seule carte ouverte à la fois : tap sur la carte ouverte la referme. */
export function nextExclusiveExpandedKey(
  current: string | null | undefined,
  tapped: string,
): string | null {
  return current === tapped ? null : tapped;
}
