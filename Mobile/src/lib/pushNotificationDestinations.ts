export const SOMAFRIK_PUSH_CHANNEL_ID = "somafrik-default";
export const ALLOWED_PUSH_DESTINATIONS = ["Home"] as const;
export type AllowedPushDestination = (typeof ALLOWED_PUSH_DESTINATIONS)[number];

export function resolvePushDestination(value: unknown): AllowedPushDestination {
  const destination = String(value ?? "").trim();
  if ((ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(destination)) {
    return destination as AllowedPushDestination;
  }
  return "Home";
}

export function isAllowlistedPushDestination(value: unknown): boolean {
  return (ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(String(value ?? "").trim());
}
