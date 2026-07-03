import { SOMAFRIK_BRAND_NAME, SOMAFRIK_LOGO_URL, SOMAFRIK_TAGLINE } from "../lib/brand";

export type BrandLogoSize = "md" | "lg" | "xl" | "hero";

const SIZE_CLASSES: Record<BrandLogoSize, string> = {
  md: "h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]",
  lg: "h-24 w-24 sm:h-28 sm:w-28",
  xl: "h-32 w-32 sm:h-36 sm:w-36",
  hero: "h-36 w-36 sm:h-44 sm:w-44",
};

interface BrandLogoProps {
  showText?: boolean;
  subtitle?: string;
  variant?: "default" | "onDark" | "compact";
  size?: BrandLogoSize;
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({
  showText = false,
  subtitle = SOMAFRIK_TAGLINE,
  variant = "default",
  size = "lg",
  className = "",
  imageClassName,
}: BrandLogoProps) {
  const imageSize = imageClassName ?? `${SIZE_CLASSES[size]} object-contain`;

  const textClass = variant === "onDark" ? "text-white" : "text-ink";
  const subtitleClass = variant === "onDark" ? "text-white/70" : "text-muted";
  const frameClass =
    variant === "onDark"
      ? "rounded-2xl bg-white p-1 shadow-lg"
      : "rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/5";

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <img
        src={SOMAFRIK_LOGO_URL}
        alt={`Logo ${SOMAFRIK_BRAND_NAME}`}
        className={`${imageSize} shrink-0 ${frameClass}`}
      />
      {showText ? (
        <div className="leading-tight">
          <p className={`text-sm font-black sm:text-base ${textClass}`}>{SOMAFRIK_BRAND_NAME}</p>
          {subtitle ? <p className={`text-xs sm:text-sm ${subtitleClass}`}>{subtitle}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
