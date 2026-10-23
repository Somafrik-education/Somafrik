import { useEffect, useRef, useState } from "react";
import { Button, InlineAlert, Modal } from "../../design-system";
import {
  CARD_PDF_INCOMPLETE,
  CLASS_CARD_PDF_DIALOG_TITLE,
  CARD_PDF_MAX_SOURCE_CHARS,
  convertBatchPrintFileToPdf,
  suggestedCardPdfName,
} from "../../lib/studentCardBatchPdf";
import { cardVisualReportMessage } from "../../lib/studentCardDesign";

interface StudentCardBatchPdfDialogProps {
  open: boolean;
  onClose: () => void;
}

const MAX_FILE_BYTES = CARD_PDF_MAX_SOURCE_CHARS;

function resultMessage(cardCount: number, pageCount: number): string {
  const cards = cardCount > 1 ? `${cardCount} cartes` : `${cardCount} carte`;
  const pages = pageCount > 1 ? `${pageCount} pages` : `${pageCount} page`;
  return `PDF A4 produit : ${cards}, ${pages}. Conservez ce fichier : il contient les QR des élèves.`;
}

function downloadPdf(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function StudentCardBatchPdfDialog({ open, onClose }: StudentCardBatchPdfDialogProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visualNotice, setVisualNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMessage(null);
      setError(null);
      setVisualNotice(null);
      setBusy(false);
    }
    return () => {
      request.current += 1;
    };
  }, [open]);

  function close() {
    request.current += 1;
    onClose();
  }

  async function onFile(file: File | undefined) {
    setMessage(null);
    setError(null);
    setVisualNotice(null);
    if (!file) return;
    const current = request.current + 1;
    request.current = current;
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setError(CARD_PDF_INCOMPLETE);
      return;
    }
    setBusy(true);
    try {
      const html = await file.text();
      const result = await convertBatchPrintFileToPdf(html);
      if (current !== request.current) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      downloadPdf(result.bytes, suggestedCardPdfName(result.classCode));
      setMessage(resultMessage(result.cardCount, result.pageCount));
      setVisualNotice(result.visuals ? cardVisualReportMessage(result.visuals) : null);
    } catch {
      if (current === request.current) setError(CARD_PDF_INCOMPLETE);
    } finally {
      if (current === request.current) setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={CLASS_CARD_PDF_DIALOG_TITLE}
      description="Import du document CR80 déjà enregistré. Aucune émission et aucune activation."
      footer={
        <Button type="button" variant="secondary" onClick={close}>
          Fermer
        </Button>
      }
    >
      <div className="space-y-3">
        <InlineAlert tone="warning" title="Document sensible">
          Ce PDF contient les QR des élèves. Conservez-le comme un document sensible. Aucune carte n’est émise,
          activée ou modifiée.
        </InlineAlert>
        <label className="block text-sm font-medium text-ink" htmlFor="card-batch-pdf-file">
          Document CR80
        </label>
        <input
          ref={inputRef}
          id="card-batch-pdf-file"
          aria-label="Document CR80"
          type="file"
          accept=".html,text/html"
          disabled={busy}
          onChange={(event) => void onFile(event.target.files?.[0])}
          className="block w-full text-sm"
        />
        {busy ? <p className="text-sm text-muted">Production du PDF…</p> : null}
        {error ? (
          <InlineAlert tone="danger" title="PDF non produit">
            {error}
          </InlineAlert>
        ) : null}
        {message ? (
          <InlineAlert tone="success" title="PDF A4">
            {message}
          </InlineAlert>
        ) : null}
        {message && visualNotice ? (
          <InlineAlert tone="info" title="Logo et photos">
            {visualNotice}
          </InlineAlert>
        ) : null}
      </div>
    </Modal>
  );
}
