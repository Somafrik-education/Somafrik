import { useEffect, useState } from "react";
import { reportCardAdminApi, reportCardConfigurationApi, type ReportCardSourceArtifact } from "../../lib/reportCardConfigurationApi";

type Props = {
  requestId: string;
  artifact: ReportCardSourceArtifact;
  schoolId?: string;
};

export function ReportCardSourcePreview({ requestId, artifact, schoolId }: Props) {
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const title = `source-artifact-${artifact.artifact_id}`;

  useEffect(() => {
    let revoked = false;
    let created = "";
    setFailed(false);
    setObjectUrl("");
    const load = schoolId
      ? reportCardAdminApi.getSourceArtifactContent(requestId, schoolId)
      : reportCardConfigurationApi.getSourceArtifactContent(requestId);
    void load
      .then((blob) => {
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      });
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [requestId, artifact.artifact_id, artifact.version, schoolId]);

  return (
    <div data-source-artifact-preview>
      <p>
        Modèle envoyé {artifact.artifact_id}
        {artifact.version != null ? ` v${artifact.version}` : ""}
      </p>
      {failed ? <p role="alert">Aperçu indisponible.</p> : null}
      {!failed && !objectUrl ? <p>Chargement de l&apos;aperçu…</p> : null}
      {objectUrl && artifact.media_type?.startsWith("image/") ? (
        <img alt={title} src={objectUrl} />
      ) : null}
      {objectUrl && !artifact.media_type?.startsWith("image/") ? (
        <iframe title={title} src={objectUrl} />
      ) : null}
    </div>
  );
}
