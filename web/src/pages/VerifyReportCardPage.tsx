import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ReportCardSnapshotView } from "../components/bulletin/ReportCardSnapshotView";
import { verifyReportCardCapability } from "../lib/reportCardVerifyApi";
import { reportCardVerifyPublicPath } from "../lib/reportCardVerifyRoute";

type PageState =
  | { status: "loading" }
  | { status: "ok"; payload: Record<string, unknown>; verification_status?: string }
  | { status: "not_found" }
  | { status: "revoked"; payload: Record<string, unknown> }
  | { status: "unavailable" };

function verificationLabel(status?: string) {
  if (status === "superseded") return "Bulletin remplacé (version antérieure authentique).";
  if (status === "revoked" || status === "REVOKED") return "Bulletin révoqué.";
  if (status === "authentic" || status === "ACTIVE") return "Bulletin authentique.";
  return null;
}

export function VerifyReportCardPage() {
  const { capability } = useParams();
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      let result;
      try {
        result = await verifyReportCardCapability(capability || "");
      } catch {
        if (!cancelled) setState({ status: "unavailable" });
        return;
      }
      if (cancelled) return;
      if (result.ok) {
        const publicId = String(capability || "").split(".")[0];
        window.history.replaceState(null, "", reportCardVerifyPublicPath(publicId));
        const status = result.verification_status;
        if (status === "revoked" || status === "REVOKED") {
          setState({ status: "revoked", payload: result.payload as Record<string, unknown> });
          return;
        }
        const label = verificationLabel(status);
        if (!label) {
          setState({ status: "not_found" });
          return;
        }
        setState({
          status: "ok",
          payload: result.payload as Record<string, unknown>,
          verification_status: status,
        });
        return;
      }
      if (result.reason === "unavailable") {
        setState({ status: "unavailable" });
        return;
      }
      setState({ status: "not_found" });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [capability]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <meta name="referrer" content="no-referrer" />
      <meta httpEquiv="Cache-Control" content="no-store" />
      <h1>Vérification de bulletin</h1>
      {state.status === "loading" ? <p>Vérification…</p> : null}
      {state.status === "not_found" ? <p>Bulletin introuvable.</p> : null}
      {state.status === "unavailable" ? <p>Vérification indisponible.</p> : null}
      {state.status === "revoked" ? (
        <>
          <p role="alert">Bulletin révoqué.</p>
          <ReportCardSnapshotView payload={state.payload} />
        </>
      ) : null}
      {state.status === "ok" ? (
        <>
          <p>{verificationLabel(state.verification_status)}</p>
          <ReportCardSnapshotView payload={state.payload} />
        </>
      ) : null}
    </main>
  );
}
