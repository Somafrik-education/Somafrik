import { StyleSheet, Text } from "react-native";
import ExpandableEntityCard from "./ExpandableEntityCard";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import type { ReportCardWorkflowRequest } from "../lib/reportCardWorkflowApi";

export function ReportCardWorkflowCards({
  rows,
  expandedId,
  onExpandedIdChange,
}: {
  rows: ReportCardWorkflowRequest[];
  expandedId: string | null;
  onExpandedIdChange: (next: string | null) => void;
}) {
  return (
    <>
      {rows.map((request) => (
        <ExpandableEntityCard
          key={request.id}
          title={request.model_key || "Modèle bulletin"}
          subtitle={request.status || "Statut non renseigné"}
          badge={request.active ? "Actif" : request.ready ? "Prêt" : "Revue"}
          expanded={expandedId === request.id}
          onExpandedChange={() =>
            onExpandedIdChange(nextExclusiveExpandedKey(expandedId, request.id))
          }
        >
          <Text style={styles.detail}>Modèle : {request.model_key || "—"}</Text>
          <Text style={styles.detail}>Statut : {request.status || "—"}</Text>
          <Text style={styles.detail}>
            Année / période : {[request.academic_year, request.period].filter(Boolean).join(" · ") || "—"}
          </Text>
        </ExpandableEntityCard>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  detail: { color: "#475569", fontSize: 12, fontWeight: "700" },
});
