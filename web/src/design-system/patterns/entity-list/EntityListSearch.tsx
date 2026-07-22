import type { ChangeEventHandler } from "react";
import { Input } from "../../primitives/Input/Input";
import { cn } from "../../utils/cn";

/**
 * EntityListSearch — filtre texte standard des listes EntityPage (D2.7).
 * Présentation uniquement : la filtration des lignes reste chez l’appelant.
 */
export interface EntityListSearchProps {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  /** Libellé accessible ; défaut = placeholder. */
  "aria-label"?: string;
  className?: string;
  id?: string;
}

export function EntityListSearch({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
  id,
}: EntityListSearchProps) {
  return (
    <div className={cn("no-print w-full sm:max-w-md", className)}>
      <Input
        id={id}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
    </div>
  );
}
