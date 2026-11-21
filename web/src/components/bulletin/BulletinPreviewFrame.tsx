import { useMemo } from "react";
import {
  BULLETIN_PREVIEW_SANDBOX,
  buildIsolatedPreviewDocument,
} from "../../lib/bulletinPreviewIsolation";

interface BulletinPreviewFrameProps {
  html: string;
  title?: string;
}

/**
 * SEC-XSS-01 — aperçu HTML d'un modèle de bulletin dans une iframe `sandbox`
 * sans aucune permission (origine opaque, pas de script) et sous CSP stricte.
 */
export function BulletinPreviewFrame({ html, title = "Aperçu du bulletin" }: BulletinPreviewFrameProps) {
  const srcDoc = useMemo(() => {
    try {
      return buildIsolatedPreviewDocument(html);
    } catch {
      return null;
    }
  }, [html]);
  if (srcDoc === null) {
    return (
      <p role="alert" className="text-sm font-semibold text-red-700">
        Aperçu indisponible : modèle vide, invalide ou trop volumineux.
      </p>
    );
  }
  return (
    <iframe
      title={title}
      data-bulletin-preview-frame
      sandbox={BULLETIN_PREVIEW_SANDBOX}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      className="h-[720px] w-full rounded-xl border border-line bg-white"
    />
  );
}
