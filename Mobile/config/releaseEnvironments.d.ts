export type ReleaseProfile = "development" | "preview" | "preproduction" | "production";

export const RELEASE_PROFILES: ReleaseProfile[];
export const CANONICAL_API_URLS: {
  preview: string;
  preproduction: string;
  production: string;
};
export const ANDROID_PACKAGE: string;
export const IOS_BUNDLE_IDENTIFIER: string;
export const APP_SLUG: string;
export const APP_SCHEME: string;
export const APP_VERSION: string;
export const ANDROID_VERSION_CODE: number;
export const DISPLAY_NAMES: Record<ReleaseProfile, string>;
export const STORE_PROFILES: ReleaseProfile[];
export const HTTPS_ONLY_PROFILES: ReleaseProfile[];

export function normalizeBaseUrl(value?: string | null): string;
export function isHttpsUrl(url: string): boolean;
export function isForbiddenReleaseHost(url: string): boolean;
export function resolveReleaseProfile(env?: NodeJS.ProcessEnv): ReleaseProfile;
export function resolveApiUrlForProfile(profile: ReleaseProfile, env?: NodeJS.ProcessEnv): string;
export function assertReleaseApiUrl(profile: ReleaseProfile, url: string): string;
export function profileAllowsCleartext(profile: ReleaseProfile): boolean;
export function profileShowsEnvironmentBadge(profile: ReleaseProfile): boolean;
export function artifactForProfile(profile: ReleaseProfile): "apk-devclient" | "apk" | "aab";
export function distributionForProfile(profile: ReleaseProfile): "internal" | "store";
