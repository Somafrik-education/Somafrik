import { useEffect, useInsertionEffect, useState } from "react";
import { STUDENT_CARD_P1, studentCardFaceCss } from "../../lib/studentCardDesign";
import {
  STUDENT_CARD_CR80,
  studentCardInitials,
  studentCardNameStep,
  studentCardValueStep,
} from "../../lib/studentCardPolicy";

/**
 * CARTE-UI-01 — recto de la carte (maquette P1 « Bandeau institutionnel », CR80 paysage).
 *
 * Mise en page pure : aucune prop ne transporte le jeton de carte. Le QR arrive déjà rendu sous
 * forme d’image (`qr.src`), produit en amont par StudentCardPrintView.
 * Les données facultatives absentes (null) sont masquées, jamais remplacées par un libellé.
 *
 * CARTE-BATCH-DESIGN-01 — ce composant est la seule mise en page de la carte : le document HTML
 * CR80 par classe le rend tel quel (renderToStaticMarkup) avec le même CSS (studentCardFaceCss),
 * et le PDF A4 dessine les cotes de STUDENT_CARD_P1.
 */
const FACE_STYLE_ID = "somafrik-student-card-face-css";

function useStudentCardFaceCss() {
  useInsertionEffect(() => {
    if (typeof document === "undefined" || document.getElementById(FACE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FACE_STYLE_ID;
    style.textContent = studentCardFaceCss();
    document.head.appendChild(style);
  }, []);
}

export type StudentCardFaceQr =
  | { kind: "ready"; src: string }
  | { kind: "loading" }
  | { kind: "error" };

export interface StudentCardFaceIdentity {
  displayName: string;
  classLabel: string | null;
  studentCode: string | null;
  schoolName: string | null;
  photoUrl: string | null;
}

export interface StudentCardFaceProps {
  /** « CARTE D’ÉLÈVE » ou « CARTE D’ÉTUDIANT », issu du titulaire résolu par le Backend. */
  holderTitle: string;
  identity: StudentCardFaceIdentity;
  /** Référence abrégée (6 derniers caractères de l'identifiant public). */
  cardRef: string;
  logoSrc: string | null;
  qr: StudentCardFaceQr;
}

export function StudentCardFace({ holderTitle, identity, cardRef, logoSrc, qr }: StudentCardFaceProps) {
  useStudentCardFaceCss();
  const [photoFailed, setPhotoFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setPhotoFailed(false), [identity.photoUrl]);
  useEffect(() => setLogoFailed(false), [logoSrc]);

  const showPhoto = Boolean(identity.photoUrl) && !photoFailed;
  const showLogo = Boolean(logoSrc) && !logoFailed;
  const nameStep = studentCardNameStep(identity.displayName);
  const schoolStep = identity.schoolName ? studentCardValueStep(identity.schoolName, STUDENT_CARD_P1.thresholds.schoolName) : null;

  return (
    <article
      className={`student-card-sheet student-card-face${schoolStep === "l2" ? " scf-long-school" : ""}`}
      style={{ width: STUDENT_CARD_CR80.width, height: STUDENT_CARD_CR80.height }}
      data-testid="student-card-sheet"
      aria-label={holderTitle}
    >
      <header className="scf-band">
        <div className="scf-logo-slot">
          {showLogo ? (
            <span className="scf-logo">
              <img src={logoSrc!} alt="" onError={() => setLogoFailed(true)} data-testid="student-card-logo" />
            </span>
          ) : null}
        </div>
        <div className="scf-band-text">
          <p className="scf-holder" data-testid="student-card-holder-title">
            {holderTitle}
          </p>
          {identity.schoolName ? (
            <p className={`scf-school scf-school-${schoolStep}`}>
              {identity.schoolName}
            </p>
          ) : null}
        </div>
        <div className="scf-logo-slot" aria-hidden="true" />
      </header>

      <div className="scf-body">
        <div className="scf-photo">
          {showPhoto ? (
            <img
              src={identity.photoUrl!}
              alt=""
              onError={() => setPhotoFailed(true)}
              data-testid="student-card-photo"
            />
          ) : (
            <span className="scf-initials" aria-hidden="true" data-testid="student-card-initials">
              {studentCardInitials(identity.displayName)}
            </span>
          )}
        </div>

        <div className="scf-info">
          <p className={`scf-name scf-name-${nameStep}`} data-testid="student-card-name">
            {identity.displayName}
          </p>
          {identity.classLabel ? (
            <p className={`scf-value scf-value-${studentCardValueStep(identity.classLabel, STUDENT_CARD_P1.thresholds.classLabel)}`} data-testid="student-card-class">
              {identity.classLabel}
            </p>
          ) : null}
          {identity.studentCode ? (
            <div>
              <p className="scf-caption">{STUDENT_CARD_P1.labels.matricule}</p>
              <p
                className={`scf-value scf-number scf-value-${studentCardValueStep(identity.studentCode, STUDENT_CARD_P1.thresholds.studentCode)}`}
                data-testid="student-card-code"
              >
                {identity.studentCode}
              </p>
            </div>
          ) : null}
        </div>

        <div className="scf-qr">
          {qr.kind === "ready" ? (
            <img src={qr.src} alt={STUDENT_CARD_P1.labels.qrAlt} data-testid="student-card-qr" />
          ) : (
            <p className="scf-qr-status">{qr.kind === "error" ? "QR indisponible" : "Génération du QR…"}</p>
          )}
        </div>
      </div>

      <footer className="scf-foot">
        <span>
          {STUDENT_CARD_P1.labels.cardRef} <span className="scf-number" data-testid="student-card-ref">…{cardRef}</span>
        </span>
        <span className="scf-brand">{STUDENT_CARD_P1.labels.brand}</span>
      </footer>
    </article>
  );
}
