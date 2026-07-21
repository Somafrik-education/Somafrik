import type {
  EditableStudentAdministrativeDetails,
  PreferredContactChannel,
  StudentEditValidationError,
} from "../../../lib/studentEditing";

interface StudentAdministrativeEditFormProps {
  value: EditableStudentAdministrativeDetails;
  draft: Partial<EditableStudentAdministrativeDetails>;
  errors: readonly StudentEditValidationError[];
  disabled?: boolean;
  onChange: (draft: Partial<EditableStudentAdministrativeDetails>) => void;
}

function fieldError(
  errors: readonly StudentEditValidationError[],
  field: string,
): string | null {
  return errors.find((item) => item.field === field)?.message ?? null;
}

export function StudentAdministrativeEditForm({
  value,
  draft,
  errors,
  disabled = false,
  onChange,
}: StudentAdministrativeEditFormProps) {
  const merged = { ...value, ...draft };

  return (
    <form
      className="grid gap-4"
      data-testid="student-administrative-edit-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <div>
        <label
          htmlFor="preferredContactChannel"
          className="block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Canal de contact préféré
        </label>
        <select
          id="preferredContactChannel"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
          value={merged.preferredContactChannel ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...draft,
              preferredContactChannel: (event.target.value ||
                null) as PreferredContactChannel | null,
            })
          }
        >
          <option value="">Non renseigné</option>
          <option value="PHONE">Téléphone</option>
          <option value="EMAIL">E-mail</option>
          <option value="SMS">SMS</option>
        </select>
      </div>
      <div>
        <label
          htmlFor="administrativeNotes"
          className="block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Notes administratives
        </label>
        <textarea
          id="administrativeNotes"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
          rows={4}
          value={merged.administrativeNotes ?? ""}
          disabled={disabled}
          aria-invalid={Boolean(fieldError(errors, "administrativeNotes"))}
          aria-describedby={
            fieldError(errors, "administrativeNotes")
              ? "administrativeNotes-error"
              : undefined
          }
          onChange={(event) =>
            onChange({
              ...draft,
              administrativeNotes: event.target.value,
            })
          }
        />
        {fieldError(errors, "administrativeNotes") ? (
          <p
            id="administrativeNotes-error"
            className="mt-1 text-xs text-danger"
            role="alert"
          >
            {fieldError(errors, "administrativeNotes")}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">Texte brut uniquement (pas de HTML).</p>
        )}
      </div>
    </form>
  );
}
