import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  STUDENT_DOC_TYPES,
  studentAdministrativeDocumentsApi,
  type StudentDocFile,
  type StudentDocRecord,
  type StudentDocType,
} from "../services/studentAdministrativeDocumentsApi";
import {
  activeStudentDocuments,
  requiredStudentDocumentStatuses,
} from "../lib/studentDocumentRequirements";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";

interface Props {
  studentId: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  mutationsBlocked: boolean;
}

const statusLabels = {
  missing: "Manquant",
  submitted: "En attente",
  verified: "Vérifié",
} as const;

function errorText(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Service documentaire indisponible.";
}

export function StudentDocumentsPanel({
  studentId, canRead, canCreate, canUpdate, mutationsBlocked,
}: Props) {
  const [docs, setDocs] = useState<StudentDocRecord[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [working, setWorking] = useState(false);
  const [selectedType, setSelectedType] = useState<StudentDocType>("BIRTH_CERTIFICATE");
  const [selectedFile, setSelectedFile] = useState<StudentDocFile | null>(null);

  useEffect(() => {
    let active = true;
    setDocs(null);
    setError("");
    if (canRead && studentId) {
      void studentAdministrativeDocumentsApi.list(studentId)
        .then((response) => {
          if (!active) return;
          if (!Array.isArray(response.documents)) {
            throw new Error("Réponse documentaire invalide.");
          }
          setDocs(response.documents);
        })
        .catch((cause: unknown) => {
          if (active) setError(errorText(cause));
        });
    }
    return () => { active = false; };
  }, [canRead, studentId, refresh]);

  function requireOnline() {
    if (!mutationsBlocked) return true;
    Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
    return false;
  }

  async function pickFile() {
    if (!canCreate || working || !requireOnline()) return;
    try {
      const response = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (response.canceled || !response.assets?.length) return;
      const asset = response.assets[0];
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    } catch (cause) {
      Alert.alert("Fichier", errorText(cause));
    }
  }

  async function upload() {
    if (!canCreate || working || !requireOnline()) return;
    if (!selectedFile) {
      Alert.alert("Fichier", "Sélectionnez d'abord un document.");
      return;
    }
    setWorking(true);
    try {
      await studentAdministrativeDocumentsApi.upload(studentId, selectedType, selectedFile);
      setSelectedFile(null);
      setRefresh((x) => x + 1);
      Alert.alert("Document déposé", "La pièce attend une vérification administrative.");
    } catch (cause) {
      Alert.alert("Dépôt refusé", errorText(cause));
    } finally {
      setWorking(false);
    }
  }

  async function changeStatus(doc: StudentDocRecord, action: "verify" | "archive") {
    if (!canUpdate || working || !requireOnline()) return;
    setWorking(true);
    try {
      if (action === "verify") {
        await studentAdministrativeDocumentsApi.verify(studentId, doc.id);
      } else {
        await studentAdministrativeDocumentsApi.archive(studentId, doc.id);
      }
      setRefresh((x) => x + 1);
    } catch (cause) {
      Alert.alert("Opération refusée", errorText(cause));
    } finally {
      setWorking(false);
    }
  }

  if (!canRead) {
    return <Text style={{ color: "#64748b" }}>Documents réservés au personnel habilité.</Text>;
  }
  if (error) {
    return (
      <View>
        <Text style={{ color: "#b91c1c" }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setRefresh((x) => x + 1)}
          style={{ padding: 12 }}><Text>Réessayer</Text></TouchableOpacity>
      </View>
    );
  }
  if (!docs) return <Text style={{ color: "#64748b" }}>Chargement des documents…</Text>;

  const active = activeStudentDocuments(docs);
  const requirements = requiredStudentDocumentStatuses(docs);
  const verified = requirements.filter((req) => req.status === "verified").length;
  const types = Object.entries(STUDENT_DOC_TYPES) as Array<[StudentDocType, string]>;

  return (
    <View testID="student-fiche-documents-content" style={{ gap: 12 }}>
      <Text style={{ fontWeight: "700", color: "#0f172a" }}>
        Conformité : {verified}/{requirements.length} pièces requises vérifiées
      </Text>
      {requirements.map((req) => (
        <View key={req.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ flex: 1, color: "#334155" }}>{req.label}</Text>
          <Text style={{ color: req.status === "verified" ? "#047857" : "#64748b" }}>
            {statusLabels[req.status]}
          </Text>
        </View>
      ))}
      <Text style={{ fontWeight: "700", marginTop: 8, color: "#0f172a" }}>Fichiers déposés</Text>
      {active.length === 0 ? <Text style={{ color: "#64748b" }}>Aucun fichier déposé.</Text> : null}
      {active.map((doc) => (
        <View key={doc.id} style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
          <Text style={{ color: "#0f172a", fontWeight: "600" }}>{doc.title}</Text>
          <Text style={{ color: "#64748b" }}>{doc.fileName} · {doc.status === "verified" ? "Vérifié" : "En attente"}</Text>
          {canUpdate ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              {doc.status === "submitted" ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={"Vérifier " + doc.title}
                  disabled={working} onPress={() => void changeStatus(doc, "verify")}
                  style={{ paddingVertical: 10 }}>
                  <Text style={{ color: "#1d4ed8", fontWeight: "700" }}>Vérifier</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={"Archiver " + doc.title}
                disabled={working} onPress={() => Alert.alert("Archiver cette pièce ?", doc.fileName, [
                  { text: "Annuler", style: "cancel" },
                  { text: "Archiver", style: "destructive", onPress: () => void changeStatus(doc, "archive") },
                ])}
                style={{ paddingVertical: 10 }}>
                <Text style={{ color: "#b91c1c", fontWeight: "700" }}>Archiver</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}
      {canCreate ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Text style={{ fontWeight: "700", color: "#0f172a" }}>Déposer un document</Text>
          <Text style={{ color: "#475569" }}>Type de pièce (glisser pour voir les choix)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            {types.map(([type, label]) => (
              <TouchableOpacity key={type} accessibilityRole="button"
                accessibilityLabel={"Type : " + label} onPress={() => setSelectedType(type)}
                style={{ borderWidth: 1, borderColor: type === selectedType ? "#2563eb" : "#cbd5e1",
                  borderRadius: 8, padding: 12, marginRight: 8, minHeight: 44 }}>
                <Text style={{ color: "#0f172a" }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choisir un document PDF, JPEG ou PNG"
            onPress={() => void pickFile()}
            style={{ padding: 12, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, minHeight: 44 }}>
            <Text style={{ color: "#1d4ed8" }}>
              {selectedFile ? selectedFile.name : "Choisir un fichier (PDF, JPEG, PNG — 10 Mo max.)"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Téléverser le document"
            disabled={working} onPress={() => void upload()}
            style={{ padding: 12, backgroundColor: working ? "#94a3b8" : "#2563eb",
              alignItems: "center", borderRadius: 8, minHeight: 44 }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>{working ? "En cours…" : "Téléverser"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
