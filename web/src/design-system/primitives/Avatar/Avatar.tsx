import type { HTMLAttributes } from "react";
import { cn } from "../../utils/cn";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** Initiales affichées (2 caractères max recommandés). */
  initials: string;
  size?: "sm" | "md" | "lg";
  alt?: string;
}

const SIZE: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
};

export function Avatar({
  className,
  initials,
  size = "md",
  alt,
  ...props
}: AvatarProps) {
  const label = alt ?? `Avatar ${initials}`;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-brand-50 font-bold text-brand",
        SIZE[size],
        className,
      )}
      {...props}
    >
      <span aria-hidden>{initials.slice(0, 2)}</span>
    </div>
  );
}
