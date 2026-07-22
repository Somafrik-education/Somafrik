import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Surface de contenu ERP (rôle Surface — D1.4). */
export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-white shadow-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  /** Niveau de titre — défaut h2 (rôle Subtitle / Section). */
  headingLevel?: "h2" | "h3";
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
  headingLevel = "h2",
}: SectionHeaderProps) {
  const Heading = headingLevel;

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <Heading className="text-lg font-bold text-ink">{title}</Heading>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
