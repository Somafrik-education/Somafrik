import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "../../design-system";
import { PrintButton } from "../ui/PrintButton";
import { schoolHasLogo, schoolLogoSrc, type SchoolLogoSource } from "../../lib/schoolLogo";
import {
  STUDENT_CARD_CR80,
  STUDENT_CARD_PREVIEW_CLOSE_NOTICE,
  studentCardDocumentTitle,
  studentCardInitials,
  type StudentCardPrintIdentity,
} from "../../lib/studentCardPolicy";

interface StudentCardPrintViewProps {
  cardToken: string;
  identity: StudentCardPrintIdentity;
  school: SchoolLogoSource;
  onClose: () => void;
}

type QrState = "loading" | "ready" | "error";

const QR_OPTIONS = {
  margin: 0,
  width: 180,
  errorCorrectionLevel: "M",
} as const;

export function StudentCardPrintView({
  cardToken,
  identity,
  school,
  onClose,
}: StudentCardPrintViewProps) {
  const [qrState, setQrState] = useState<QrState>("loading");
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  const logoSrc = schoolHasLogo(school) ? schoolLogoSrc(school) : null;
  const documentTitle = studentCardDocumentTitle(identity.studentCode);

  useEffect(() => {
    document.body.classList.add("somafrik-print-student-card");
    return () => {
      document.body.classList.remove("somafrik-print-student-card");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQrState("loading");
    setQrSrc(null);
    void QRCode.toDataURL(cardToken, QR_OPTIONS)
      .then((url) => {
        if (cancelled) return;
        setQrSrc(url);
        setQrState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setQrSrc(null);
        setQrState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [cardToken, qrAttempt]);

  return (
    <section className="space-y-4" aria-label="Prévisualisation de la carte">
      <p className="no-print text-sm text-muted">{STUDENT_CARD_PREVIEW_CLOSE_NOTICE}</p>
      <article
        className="student-card-sheet grid grid-cols-[22mm_1fr_24mm] items-center gap-2 overflow-hidden border border-line bg-white p-2 text-ink"
        style={{ width: STUDENT_CARD_CR80.width, height: STUDENT_CARD_CR80.height }}
        data-testid="student-card-sheet"
      >
        <div className="flex h-full flex-col items-center justify-center gap-1">
          {logoSrc ? (
            <img src={logoSrc} alt="" className="h-8 w-8 object-contain" />
          ) : null}
          {identity.photoUrl ? (
            <img src={identity.photoUrl} alt="" className="h-14 w-12 rounded object-cover" />
          ) : (
            <div
              className="flex h-14 w-12 items-center justify-center rounded bg-slate-100 text-sm font-semibold"
              aria-hidden="true"
            >
              {studentCardInitials(identity.displayName)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Carte élève</p>
          <p className="truncate text-sm font-semibold">{identity.displayName}</p>
          <p className="truncate text-[11px]">{identity.classLabel}</p>
          <p className="truncate text-[11px]">{identity.studentCode}</p>
          <p className="truncate text-[10px] text-muted">{identity.schoolName}</p>
        </div>
        <div className="flex flex-col items-center justify-center">
          {qrState === "ready" && qrSrc ? (
            <img src={qrSrc} alt="QR carte élève" className="h-16 w-16" data-testid="student-card-qr" />
          ) : (
            <p className="text-center text-[9px]">{qrState === "error" ? "QR indisponible" : "Génération du QR…"}</p>
          )}
          <p className="mt-1 max-w-full truncate text-[8px]">ID carte : {identity.publicId}</p>
        </div>
      </article>
      {qrState === "error" ? (
        <p className="no-print text-sm text-danger">Le QR n’a pas pu être généré. N’imprimez pas cette carte.</p>
      ) : null}
      <div className="no-print flex flex-wrap gap-2">
        <PrintButton documentTitle={documentTitle} disabled={qrState !== "ready"} />
        {qrState === "error" ? (
          <Button type="button" variant="secondary" onClick={() => setQrAttempt((attempt) => attempt + 1)}>
            Réessayer le QR
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          Terminer
        </Button>
      </div>
    </section>
  );
}
