import { useEffect, useState } from "react";
import { Button, InlineAlert } from "../../design-system";
import { PrintButton } from "../ui/PrintButton";
import { schoolHasLogo, schoolLogoSrc, type SchoolLogoSource } from "../../lib/schoolLogo";
import type { StudentCardHolder } from "../../lib/studentCardsApi";
import {
  STUDENT_CARD_HOLDER_PRINT_REFUSED_NOTICE,
  STUDENT_CARD_PREVIEW_CLOSE_NOTICE,
  studentCardDocumentTitle,
  studentCardHolderTitle,
  studentCardRef,
  type StudentCardHolderKind,
  type StudentCardPrintIdentity,
} from "../../lib/studentCardPolicy";
import { useStudentCardQr } from "../../lib/studentCardQr";
import { useStudentCardFonts } from "../../lib/studentCardFonts";
import { studentCardPhotoNotice, useStudentCardPhoto } from "../../lib/studentCardPhoto";
import { StudentCardFace, type StudentCardFaceQr } from "./StudentCardFace";

/**
 * CARTE-UI-01 — orchestrateur de l'aperçu et de l'impression.
 * Le jeton n'est transmis qu'à useStudentCardQr ; StudentCardFace ne reçoit que l'image du QR.
 * Imprimer reste désactivé tant que le titulaire n'est pas déterminé, que le QR n'est pas prêt
 * ou que la typographie de la carte est en cours de chargement.
 */
export type StudentCardPrintFormat = "cr80" | "a4";

const PRINT_BODY_CLASS = "somafrik-print-student-card";
const PRINT_A4_BODY_CLASS = "somafrik-print-student-card-a4";

interface StudentCardPrintViewProps {
  cardToken: string;
  holder: StudentCardHolder | null;
  identity: StudentCardPrintIdentity;
  school: SchoolLogoSource;
  /**
   * CARTE-PHOTO-02 — élève dont on lit la photo canonique (pièce PHOTO) et établissement actif.
   * Tout changement de l'un ou de l'autre efface immédiatement la photo affichée.
   */
  photoStudentRef?: string | null;
  photoScope?: string;
  onClose: () => void;
}

export function StudentCardPrintView({
  cardToken,
  holder,
  identity,
  school,
  photoStudentRef = null,
  photoScope = "",
  onClose,
}: StudentCardPrintViewProps) {
  const holderTitle = studentCardHolderTitle(holder);
  // Titulaire non déterminé : aucun QR n'est généré, aucune impression n'est possible.
  const qr = useStudentCardQr(holderTitle ? cardToken : null);
  const fonts = useStudentCardFonts();
  const [format, setFormat] = useState<StudentCardPrintFormat>("cr80");
  const photo = useStudentCardPhoto({
    studentRef: photoStudentRef,
    legacyPhotoUrl: identity.photoUrl,
    scope: photoScope,
  });
  const photoNotice = photo.state === "loading" ? null : studentCardPhotoNotice(photo.state);
  const logoSrc = schoolHasLogo(school) ? schoolLogoSrc(school) : null;
  const documentTitle = studentCardDocumentTitle(identity.studentCode, holder?.kind as StudentCardHolderKind | null);
  const qrState = qr.state;
  const printReady = Boolean(holderTitle) && qrState === "ready" && fonts !== "loading" && photo.state !== "loading";

  useEffect(() => {
    document.body.classList.add(PRINT_BODY_CLASS);
    return () => {
      document.body.classList.remove(PRINT_BODY_CLASS, PRINT_A4_BODY_CLASS);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(PRINT_A4_BODY_CLASS, format === "a4");
  }, [format]);

  if (!holderTitle) {
    return (
      <section className="space-y-4" aria-label="Prévisualisation de la carte">
        <InlineAlert tone="danger" title="Impression impossible">
          {STUDENT_CARD_HOLDER_PRINT_REFUSED_NOTICE}
        </InlineAlert>
        <div className="no-print flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Terminer
          </Button>
        </div>
      </section>
    );
  }

  const faceQr: StudentCardFaceQr =
    qrState === "ready" && qr.src ? { kind: "ready", src: qr.src } : { kind: qrState === "error" ? "error" : "loading" };

  return (
    <section className="space-y-4" aria-label="Prévisualisation de la carte">
      <p className="no-print text-sm text-muted">{STUDENT_CARD_PREVIEW_CLOSE_NOTICE}</p>
      <div className="student-card-preview">
        <StudentCardFace
          holderTitle={holderTitle}
          identity={{
            displayName: identity.displayName,
            classLabel: identity.classLabel,
            studentCode: identity.studentCode,
            schoolName: identity.schoolName,
            photoUrl: photo.src,
          }}
          cardRef={studentCardRef(identity.publicId)}
          logoSrc={logoSrc}
          qr={faceQr}
        />
      </div>
      <p className="no-print text-xs text-muted">
        Aperçu agrandi. L’impression se fait à la taille réelle CR80 (85,60 × 53,98 mm) : réglez l’échelle sur 100 %, sans
        ajustement à la page.
      </p>
      {qrState === "error" ? (
        <p className="no-print text-sm text-danger">Le QR n’a pas pu être généré. N’imprimez pas cette carte.</p>
      ) : null}
      {photoNotice ? (
        <p className="no-print text-sm text-muted" data-testid="student-card-photo-notice">
          {photoNotice}
        </p>
      ) : null}
      {fonts === "fallback" ? (
        <p className="no-print text-xs text-muted">La police de la carte n’a pas pu être chargée : une police de secours sera utilisée.</p>
      ) : null}
      <fieldset className="no-print flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">Format d’impression</legend>
        <span className="font-medium text-ink">Format d’impression :</span>
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="student-card-print-format" checked={format === "cr80"} onChange={() => setFormat("cr80")} />
          Imprimante à cartes (CR80)
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="student-card-print-format" checked={format === "a4"} onChange={() => setFormat("a4")} />
          Feuille A4 (taille réelle, à découper)
        </label>
      </fieldset>
      <div className="no-print flex flex-wrap gap-2">
        <PrintButton documentTitle={documentTitle} disabled={!printReady} />
        {qrState === "error" ? (
          <Button type="button" variant="secondary" onClick={qr.retry}>
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
