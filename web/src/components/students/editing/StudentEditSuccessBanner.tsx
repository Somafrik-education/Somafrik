interface StudentEditSuccessBannerProps {
  visible: boolean;
  message?: string;
  newVersion?: number | null;
  onDismiss?: () => void;
}

export function StudentEditSuccessBanner({
  visible,
  message = "Modifications enregistrées.",
  newVersion = null,
  onDismiss,
}: StudentEditSuccessBannerProps) {
  if (!visible) return null;

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
      role="status"
      aria-live="polite"
      data-testid="student-edit-success"
    >
      <div>
        <p className="text-sm font-semibold text-emerald-900">{message}</p>
        {newVersion != null ? (
          <p className="mt-1 text-xs text-emerald-800">
            Nouvelle version : {newVersion}
          </p>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="text-xs font-semibold text-emerald-900 underline"
          onClick={onDismiss}
        >
          Fermer
        </button>
      ) : null}
    </div>
  );
}
