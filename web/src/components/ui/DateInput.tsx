import type { ChangeEvent, InputHTMLAttributes } from "react";
import { DatePicker } from "./DatePicker";

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Adaptateur formulaire pour le DatePicker Somafrik.
 * La valeur contrôlée reste canonique YYYY-MM-DD, tandis que l'utilisateur voit JJ-MM-AAAA.
 */
export function DateInput({
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  readOnly,
  className,
  placeholder,
  min,
  max,
  autoFocus,
  ...props
}: DateInputProps) {
  const current = value == null ? "" : String(value);
  const minValue = min == null ? "" : String(min);
  const maxValue = max == null ? "" : String(max);
  const dataTestId = (props as Record<string, unknown>)["data-testid"] as string | undefined;
  const ariaInvalid =
    props["aria-invalid"] === "grammar" || props["aria-invalid"] === "spelling"
      ? true
      : props["aria-invalid"];

  const emitChange = (next: string) => {
    if ((minValue && next < minValue) || (maxValue && next > maxValue)) return;
    if (!onChange) return;
    const target = { value: next, name: name ?? "", id: id ?? "" } as HTMLInputElement;
    onChange({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
  };

  return (
    <>
      <DatePicker
        id={id}
        value={current}
        onChange={emitChange}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        className={className}
        placeholder={placeholder}
        min={minValue || undefined}
        max={maxValue || undefined}
        autoFocus={autoFocus}
        aria-invalid={ariaInvalid}
        aria-describedby={props["aria-describedby"]}
        data-testid={dataTestId}
      />
      {name ? <input type="hidden" name={name} value={current} disabled={disabled} /> : null}
    </>
  );
}
