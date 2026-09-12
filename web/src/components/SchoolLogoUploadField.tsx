import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "../design-system";
import { establishmentsApi } from "../lib/establishmentsApi";
import { schoolLogoSrc, schoolHasLogo } from "../lib/schoolLogo";
import type { School } from "../types";

const ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  school: Pick<School, "code" | "publicId" | "logoUrl" | "hasLogo" | "name">;
  canEdit: boolean;
  disabled?: boolean;
  onChanged?: () => Promise<void> | void;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
};

export function SchoolLogoUploadField({
  school,
  canEdit,
  disabled = false,
  onChanged,
  onError,
  onSuccess,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const locked = !canEdit || disabled || busy;
  const hasLogo = schoolHasLogo(school);
  const remoteSrc = schoolLogoSrc(school);
  const preview = localPreview || remoteSrc;
  const label = hasLogo || localPreview ? "Modifier le logo" : "Ajouter un logo";
  const canUpload = Boolean(school.code?.trim()) && canEdit;

  async function persistFile(file: File) {
    if (!canUpload) {
      onError?.("Enregistrez l'établissement avant d'ajouter un logo.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.("Le logo dépasse la taille autorisée (5 Mo).");
      return;
    }
    const mime = file.type.toLowerCase();
    if (mime && !["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mime)) {
      onError?.("Formats acceptés : PNG, JPEG ou WebP.");
      return;
    }
    setBusy(true);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    try {
      await establishmentsApi.uploadLogo(school.code, file);
      await onChanged?.();
      onSuccess?.("Logo de l'établissement enregistré");
      setLocalPreview(null);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Échec de l'upload du logo");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void persistFile(file);
  }

  async function handleRemove() {
    if (!canUpload || locked) return;
    setBusy(true);
    try {
      await establishmentsApi.removeLogo(school.code);
      setLocalPreview(null);
      await onChanged?.();
      onSuccess?.("Logo supprimé");
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Impossible de supprimer le logo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sm:col-span-2 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Logo de l'établissement</p>
      <input
        ref={inputRef}
        id="school-logo-file"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={handlePick}
        disabled={locked || !canUpload}
      />
      <label
        htmlFor="school-logo-file"
        className="flex h-32 w-full max-w-xs cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white p-4 text-sm font-semibold text-ink hover:border-brand has-[:disabled]:cursor-not-allowed"
      >
        {preview ? (
          <img src={preview} alt="" className="max-h-24 max-w-full object-contain" />
        ) : (
          <span>{canUpload ? "Ajouter un logo" : "Aucun logo"}</span>
        )}
      </label>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={locked || !canUpload}
          >
            {label}
          </Button>
          {hasLogo ? (
            <Button type="button" variant="tertiary" onClick={() => void handleRemove()} disabled={locked}>
              Supprimer le logo
            </Button>
          ) : null}
        </div>
      ) : null}
      {!canUpload && canEdit ? (
        <p className="text-xs text-muted">Enregistrez l'établissement avant d'ajouter un logo.</p>
      ) : (
        <p className="text-xs text-muted">PNG, JPEG ou WebP · 5 Mo max. Choisissez un fichier, jamais une URL.</p>
      )}
    </div>
  );
}
