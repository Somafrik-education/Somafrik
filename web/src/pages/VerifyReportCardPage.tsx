import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ReportCardSnapshotView } from "../components/bulletin/ReportCardSnapshotView";
import { verifyReportCardCapability } from "../lib/reportCardVerifyApi";

type PageState =
  | { status: "loading" }
  | { status: "ok"; payload: Record<string, unknown>; verification_status?: string }
  | { status: "not_found" };

export function VerifyReportCardPage() {
  const { capability } = useParams();
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const result = await verifyReportCardCapability(capability || "");
      if (cancelled) return;
      if (result.ok) {
        const publicId = String(capability || "").split(".")[0];
        window.history.replaceState(null, "", `/verify/rc/${publicId}`);
        setState({
          status: "ok",
          payload: result.payload as Record<string, unknown>,
          verification_status: result.verification_status,
        });
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
      {state.status === "ok" ? (
        <>
          <p>
            {state.verification_status === "superseded"
              ? "Bulletin remplacé (version antérieure authentique)."
              : "Bulletin authentique."}
          </p>
          <ReportCardSnapshotView payload={state.payload} />
        </>
      ) : null}
    </main>
  );
}
