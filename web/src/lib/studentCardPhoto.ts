import { useEffect, useState } from "react";
import { ApiError, requestBlob } from "../api/client";
import { API_URL } from "./apiUrl";

/**
 * CARTE-PHOTO-01 — images d'un dossier scolaire.
 * Une URL relative est rattachée à l'API (pas à l'origine du frontend).
 * Seules les URLs sous /api/ du backend sont lues via le client JWT.
 * Aucun jeton n'est ajouté à l'URL, aux logs ou au HTML imprimé.
 *
 * CARTE-PHOTO-02 — source canonique : la pièce administrative PHOTO de l'élève,
 * servie par GET /api/students/:id/photo (même tenant, droit Documents:READ).
 * Le téléversement d'une photo n'a jamais renseigné students.photo_url : ce champ
 * n'est plus qu'un repli pour d'éventuelles valeurs anciennes.
 */
export function resolveStudentCardPhotoUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (/^(?:javascript|file|data):/i.test(value) || value.startsWith("//")) return null;
  try {
    const base = new URL(API_URL.endsWith("/") ? API_URL : `${API_URL}/`);
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) {
      // Chemin relatif sans slash : toujours relatif à la racine de l'API.
      return new URL(value, base).href;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** La lecture authentifiée est réservée à notre API, jamais aux URLs tierces. */
export function studentCardPhotoApiPath(url: string): string | null {
  try {
    const api = new URL(API_URL);
    const parsed = new URL(url);
    if (api.origin !== parsed.origin || !parsed.pathname.startsWith("/api/")) return null;
    return `${parsed.pathname.slice(4)}${parsed.search}`;
  } catch {
    return null;
  }
}

const STUDENT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/** Chemin API de la photo canonique (matricule ou identifiant interne de l'élève). */
export function studentCardPhotoPath(studentRef: string | null | undefined): string | null {
  const ref = String(studentRef ?? "").trim();
  if (!STUDENT_REF_RE.test(ref)) return null;
  return `/students/${encodeURIComponent(ref)}/photo`;
}

/**
 * - photo : image lue (Blob PNG/JPEG) ;
 * - photo_url : ancienne URL tierce, affichée telle quelle (aucune authentification envoyée) ;
 * - absent : aucune photo dans le dossier ;
 * - forbidden : droits insuffisants (401/403) — aucune image n'est affichée ;
 * - file_missing : la pièce PHOTO existe mais son fichier est introuvable sur le serveur ;
 * - invalid : contenu non image ;
 * - unavailable : élève introuvable dans ce périmètre, réseau ou serveur indisponible.
 */
export type StudentCardPhotoSource =
  | { state: "photo"; blob: Blob }
  | { state: "photo_url"; src: string }
  | { state: "absent" | "forbidden" | "file_missing" | "invalid" | "unavailable" };

export type StudentCardPhotoState = StudentCardPhotoSource["state"];

export interface StudentCardPhotoRequest {
  studentRef: string | null | undefined;
  legacyPhotoUrl?: string | null;
}

type BlobReader = (path: string) => Promise<Blob>;

function isImageBlob(blob: Blob): boolean {
  return blob.type === "image/png" || blob.type === "image/jpeg";
}

function classifyFailure(error: unknown): StudentCardPhotoSource {
  if (!(error instanceof ApiError)) return { state: "unavailable" };
  if (error.status === 401 || error.status === 403) return { state: "forbidden" };
  if (error.status === 404 && error.code === "STUDENT_PHOTO_ABSENT") return { state: "absent" };
  if (error.status === 404 && error.code === "STUDENT_PHOTO_FILE_MISSING") return { state: "file_missing" };
  if (error.status === 422) return { state: "invalid" };
  return { state: "unavailable" };
}

async function legacyPhoto(raw: string | null | undefined, read: BlobReader): Promise<StudentCardPhotoSource> {
  const url = resolveStudentCardPhotoUrl(raw);
  if (!url) return { state: "absent" };
  if (/^(?:data|blob):/i.test(url)) return { state: "photo_url", src: url };
  const apiPath = studentCardPhotoApiPath(url);
  if (!apiPath) return { state: "photo_url", src: url };
  try {
    const blob = await read(apiPath);
    return blob.type.startsWith("image/") ? { state: "photo", blob } : { state: "invalid" };
  } catch (error) {
    return classifyFailure(error);
  }
}

/** Lit la photo canonique, puis l'ancien champ photo_url seulement si le dossier n'a aucune pièce PHOTO. */
export async function fetchStudentCardPhoto(
  request: StudentCardPhotoRequest,
  read: BlobReader = (path) => requestBlob(path),
): Promise<StudentCardPhotoSource> {
  const path = studentCardPhotoPath(request.studentRef);
  if (path) {
    let canonical: StudentCardPhotoSource;
    try {
      const blob = await read(path);
      canonical = isImageBlob(blob) ? { state: "photo", blob } : { state: "invalid" };
    } catch (error) {
      canonical = classifyFailure(error);
    }
    if (canonical.state !== "absent") return canonical;
  }
  return legacyPhoto(request.legacyPhotoUrl, read);
}

/** Message non sensible pour l'opérateur ; null quand la carte est conforme (photo ou absence réelle). */
export function studentCardPhotoNotice(state: StudentCardPhotoState): string | null {
  switch (state) {
    case "forbidden":
      return "Photo non affichée : vos droits ne permettent pas de consulter les pièces de cet élève. Les initiales sont imprimées.";
    case "file_missing":
      return "Une photo est enregistrée dans le dossier, mais son fichier est introuvable sur le serveur. Les initiales sont imprimées. Déposez de nouveau la photo dans les pièces de l’élève.";
    case "invalid":
      return "La photo du dossier n’est pas une image PNG ou JPEG lisible. Les initiales sont imprimées.";
    case "unavailable":
      return "Photo momentanément indisponible. Les initiales sont imprimées.";
    default:
      return null;
  }
}

/** Causes des photos non intégrées dans un lot, sans nom ni identifiant d'élève. */
export function studentCardBatchPhotoIssueSummary(issues: readonly (StudentCardPhotoState | null)[]): string | null {
  const count = (state: StudentCardPhotoState) => issues.filter((issue) => issue === state).length;
  const parts: string[] = [];
  const forbidden = count("forbidden");
  const missing = count("file_missing");
  const invalid = count("invalid");
  const unavailable = count("unavailable");
  if (forbidden) parts.push(`${forbidden} non lisible${forbidden > 1 ? "s" : ""} avec vos droits (pièces de l’élève)`);
  if (missing) parts.push(`${missing} fichier${missing > 1 ? "s" : ""} photo introuvable${missing > 1 ? "s" : ""} sur le serveur`);
  if (invalid) parts.push(`${invalid} image${invalid > 1 ? "s" : ""} illisible${invalid > 1 ? "s" : ""}`);
  if (unavailable) parts.push(`${unavailable} momentanément indisponible${unavailable > 1 ? "s" : ""}`);
  return parts.length ? `Causes : ${parts.join(" ; ")}.` : null;
}

/**
 * CARTE-PHOTO-01 (compatibilité) — chargement d'une URL de photo seule.
 * Conservé pour les anciens appels ; la carte utilise useStudentCardPhoto.
 */
export async function loadStudentCardPhoto(
  raw: string | null | undefined,
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<{ src: string | null; revoke: boolean }> {
  const url = resolveStudentCardPhotoUrl(raw);
  if (!url) return { src: null, revoke: false };
  const apiPath = studentCardPhotoApiPath(url);
  if (!apiPath) return { src: url, revoke: false };
  const blob = await requestBlob(apiPath);
  if (!blob.type.startsWith("image/")) return { src: null, revoke: false };
  return { src: createObjectUrl(blob), revoke: true };
}

export interface StudentCardPhotoView {
  /** URL locale (blob:) ou ancienne URL ; null = initiales. */
  src: string | null;
  state: StudentCardPhotoState | "loading";
}

/**
 * Photo de la carte individuelle. La clé inclut l'établissement : tout changement d'élève,
 * d'établissement ou de photo efface immédiatement l'image précédente et révoque son URL locale.
 * Une réponse arrivée après un changement est ignorée.
 */
export function useStudentCardPhoto(
  request: StudentCardPhotoRequest & { scope: string },
  deps: { read?: BlobReader; createObjectUrl?: (blob: Blob) => string; revokeObjectUrl?: (url: string) => void } = {},
): StudentCardPhotoView {
  const { studentRef, legacyPhotoUrl, scope } = request;
  const key = `${scope}\u0000${studentRef ?? ""}\u0000${legacyPhotoUrl ?? ""}`;
  const [view, setView] = useState<{ key: string; value: StudentCardPhotoView }>({
    key,
    value: { src: null, state: "loading" },
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const create = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
    const revoke = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
    setView({ key, value: { src: null, state: "loading" } });
    void fetchStudentCardPhoto({ studentRef, legacyPhotoUrl }, deps.read).then((result) => {
      if (cancelled) return;
      if (result.state === "photo") {
        objectUrl = create(result.blob);
        setView({ key, value: { src: objectUrl, state: "photo" } });
      } else if (result.state === "photo_url") {
        setView({ key, value: { src: result.src, state: "photo_url" } });
      } else {
        setView({ key, value: { src: null, state: result.state } });
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) revoke(objectUrl);
    };
    // deps est un point d'injection de test, stable pour un rendu donné.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Pendant le rendu qui suit un changement de clé, l'ancienne image n'est jamais renvoyée.
  return view.key === key ? view.value : { src: null, state: "loading" };
}
