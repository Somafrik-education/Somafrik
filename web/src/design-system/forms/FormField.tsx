import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * FormField — libellé + contrôle + hint/erreur.
 * Remplace progressivement `Field` de `components/ui` (coexistence).
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FormFieldProps) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("block", className)}>
      <label htmlFor={htmlFor} className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              {" "}
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (obligatoire)</span> : null}
        </span>
        {children}
      </label>
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
