import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-lg outline-none transition focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-700 focus-visible:ring-brand/30",
        secondary:
          "border border-line bg-white text-ink hover:bg-slate-50 focus-visible:ring-brand/20",
        tertiary: "bg-transparent text-slate-600 hover:bg-slate-50 hover:text-ink focus-visible:ring-brand/20",
        danger: "bg-danger text-white hover:bg-red-700 focus-visible:ring-danger/30",
      },
      size: {
        sm: "h-9 w-9 min-h-9 min-w-9",
        md: "h-10 w-10 min-h-10 min-w-10",
      },
    },
    defaultVariants: {
      variant: "tertiary",
      size: "md",
    },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  /** Libellé accessible obligatoire (AP-011 / DO-041). */
  "aria-label": string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = "button", children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = "IconButton";

export { iconButtonVariants };
