import type {
  EditableGuardianContact,
  StudentEditValidationError,
} from "../../../lib/studentEditing";

interface StudentGuardianContactEditFormProps {
  value: EditableGuardianContact;
  draft: Partial<EditableGuardianContact>;
  errors: readonly StudentEditValidationError[];
  disabled?: boolean;
  onChange: (draft: Partial<EditableGuardianContact>) => void;
}

function fieldError(
  errors: readonly StudentEditValidationError[],
  field: string,
): string | null {
  return errors.find((item) => item.field === field)?.message ?? null;
}

export function StudentGuardianContactEditForm({
  value,
  draft,
  errors,
  disabled = false,
  onChange,
}: StudentGuardianContactEditFormProps) {
  const merged = { ...value, ...draft };
  const set = <K extends keyof EditableGuardianContact>(
    key: K,
    next: EditableGuardianContact[K],
  ) => onChange({ ...draft, [key]: next });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      data-testid="student-guardian-contact-edit-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <p className="sm:col-span-2 text-sm font-medium text-ink">
        {value.displayName}
      </p>
      <Field
        id="guardian-phone"
        label="Téléphone"
        value={merged.phone ?? ""}
        error={fieldError(errors, "phone")}
        disabled={disabled}
        onChange={(next) => set("phone", next)}
      />
      <Field
        id="guardian-email"
        label="Adresse e-mail"
        type="email"
        value={merged.email ?? ""}
        error={fieldError(errors, "email")}
        disabled={disabled}
        onChange={(next) => set("email", next)}
      />
      <div className="sm:col-span-2">
        <Field
          id="guardian-address"
          label="Adresse"
          value={merged.address ?? ""}
          error={fieldError(errors, "address")}
          disabled={disabled}
          onChange={(next) => set("address", next)}
        />
      </div>
      <Field
        id="guardian-priority"
        label="Priorité"
        type="number"
        value={String(merged.priority)}
        error={fieldError(errors, "priority")}
        disabled={disabled}
        onChange={(next) => set("priority", Number(next) || 1)}
      />
      <div className="flex flex-col gap-3 justify-end">
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={merged.isEmergencyContact}
            disabled={disabled}
            onChange={(event) =>
              set("isEmergencyContact", event.target.checked)
            }
          />
          Contact d&apos;urgence
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={merged.pickupAuthorized}
            disabled={disabled}
            onChange={(event) => set("pickupAuthorized", event.target.checked)}
          />
          Autorisé à récupérer l&apos;élève
        </label>
      </div>
      <p className="sm:col-span-2 text-xs text-muted">
        Responsable légal, lien de parenté et rôle financier : hors périmètre
        C1.7.
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
