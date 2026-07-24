import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";
import { statusToneClasses, type StatusTone } from "../../tokens/roles";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral: statusToneClasses.neutral,
        success: statusToneClasses.success,
        warning: statusToneClasses.warning,
        info: statusToneClasses.info,
        danger: statusToneClasses.danger,
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type BadgeTone = StatusTone;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  children: ReactNode;
}

export function Badge({ className, tone, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

export { badgeVariants };
