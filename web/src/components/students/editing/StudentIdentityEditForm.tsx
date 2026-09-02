import type { EditableStudentIdentity, StudentGender } from "../../../lib/studentEditing";
import type { StudentEditValidationError } from "../../../lib/studentEditing";
import { RequiredMark } from "../../../design-system/forms/RequiredMark";

interface StudentIdentityEditFormProps {
  value: EditableStudentIdentity;
  draft: Partial<EditableStudentIdentity>;
  errors: readonly StudentEditValidationError[];
  disabled?: boolean;
  onChange: (draft: Partial<EditableStudentIdentity>) => void;
}

function fieldError(
  errors: readonly StudentEditValidationError[],
  field: string,
): string | null {
  return errors.find((item) => item.field === field)?.message ?? null;
}

export function StudentIdentityEditForm({
  value,
  draft,
  errors,
  disabled = false,
  onChange,
}: StudentIdentityEditFormProps) {
  const merged = { ...value, ...draft };

  const set = <K extends keyof EditableStudentIdentity>(
    key: K,
    next: EditableStudentIdentity[K],
  ) => {
    onChange({ ...draft, [key]: next });
  };

  const firstErrorField = errors.find((item) => item.field)?.field;

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      data-testid="student-identity-edit-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <Field
        id="firstName"
        label="Prénom"
        value={merged.firstName}
        error={fieldError(errors, "firstName")}
        disabled={disabled}
        autoFocus={firstErrorField === "firstName" || !firstErrorField}
        onChange={(next) => set("firstName", next)}
        required
      />
      <Field
        id="lastName"
        label="Nom"
        value={merged.lastName}
        error={fieldError(errors, "lastName")}
        disabled={disabled}
        autoFocus={firstErrorField === "lastName"}
        onChange={(next) => set("lastName", next)}
        required
      />
      <Field
        id="preferredName"
        label="Nom d'usage"
        value={merged.preferredName ?? ""}
        error={fieldError(errors, "preferredName")}
        disabled={disabled}
        onChange={(next) => set("preferredName", next)}
      />
      <div>
        <label
          htmlFor="gender"
          className="block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Sexe
        </label>
        <select
          id="gender"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
          value={merged.gender ?? ""}
          disabled={disabled}
          aria-invalid={Boolean(fieldError(errors, "gender"))}
          onChange={(event) =>
            set(
              "gender",
              (event.target.value || null) as StudentGender | null,
            )
          }
        >
          <option value="">Non renseigné</option>
          <option value="F">Féminin</option>
          <option value="M">Masculin</option>
          <option value="OTHER">Autre</option>
          <option value="UNKNOWN">Inconnu</option>
        </select>
      </div>
      <Field
        id="birthDate"
        label="Date de naissance"
        type="date"
        value={merged.birthDate ?? ""}
        error={fieldError(errors, "birthDate")}
        disabled={disabled}
        autoFocus={firstErrorField === "birthDate"}
        onChange={(next) => set("birthDate", next)}
      />
      <Field
        id="birthPlace"
        label="Lieu de naissance"
        value={merged.birthPlace ?? ""}
        error={fieldError(errors, "birthPlace")}
        disabled={disabled}
        onChange={(next) => set("birthPlace", next)}
      />
      <Field
        id="nationality"
        label="Nationalité"
        value={merged.nationality ?? ""}
        error={fieldError(errors, "nationality")}
        disabled={disabled}
        onChange={(next) => set("nationality", next)}
      />
      <Field
        id="phone"
        label="Téléphone"
        value={merged.phone ?? ""}
        error={fieldError(errors, "phone")}
        disabled={disabled}
        autoFocus={firstErrorField === "phone"}
        onChange={(next) => set("phone", next)}
      />
      <Field
        id="email"
        label="Adresse e-mail"
        type="email"
        value={merged.email ?? ""}
        error={fieldError(errors, "email")}
        disabled={disabled}
        autoFocus={firstErrorField === "email"}
        onChange={(next) => set("email", next)}
      />
      <div className="sm:col-span-2">
        <Field
          id="address"
          label="Adresse"
          value={merged.address ?? ""}
          error={fieldError(errors, "address")}
          disabled={disabled}
          onChange={(next) => set("address", next)}
        />
      </div>
      <p className="sm:col-span-2 text-xs text-muted">
        Matricule et identifiant non modifiables.
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
  required,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled?: boolean;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      <input
        id={id}
        type={type}
        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
        value={value}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
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
