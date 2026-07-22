import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

/**
 * Button — action interactive.
 * Variantes officielles D2.1 : primary | secondary | tertiary | danger.
 * Alias déprécié : `ghost` → `tertiary` (DO-046, coexistence avec ui/Button).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold outline-none transition focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-700 focus-visible:ring-brand/30",
        secondary:
          "border border-line bg-white text-ink hover:bg-slate-50 focus-visible:ring-brand/20",
        tertiary: "bg-transparent text-brand hover:bg-brand-50 focus-visible:ring-brand/20",
        danger: "bg-danger text-white hover:bg-red-700 focus-visible:ring-danger/30",
        /** @deprecated Utiliser `tertiary` (DO-046). */
        ghost: "bg-transparent text-brand hover:bg-brand-50 focus-visible:ring-brand/20",
      },
      size: {
        sm: "min-h-9 px-3 py-1.5 text-xs",
        md: "min-h-10 px-4 py-2 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    const resolvedVariant = variant === "ghost" ? "tertiary" : variant;

    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant: resolvedVariant, size }), className)}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

export { buttonVariants };
