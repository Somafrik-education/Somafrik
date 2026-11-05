/**
 * BULLETIN-UI-01 — résultats d'un bulletin PUBLIÉ, lecture native téléphone.
 * Une période à la fois (sélecteur), toutes les matières, sous-matières et
 * maxima conservés. Aucun calcul : données du serveur (snapshot figé).
 */
import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import { getApiBaseUrl } from "../../services/api";
import { getAccessToken } from "../../services/secureStorage";
import {
  defaultPhoneView,
  phoneReportCard,
  phoneViewOptions,
  type ReportCardPresentation,
} from "../../lib/reportCardPresentationMobile";

export function ReportCardPresentationView({ view }: { view: ReportCardPresentation }) {
  const options = useMemo(() => phoneViewOptions(view), [view]);
  const [selected, setSelected] = useState(() => defaultPhoneView(view));
  const card = useMemo(() => phoneReportCard(view, selected), [view, selected]);
  const logoSource = useFrozenLogo(card.header?.logoPath ?? null);
  const header = card.header;

  return (
    <View style={styles.wrapper} testID="report-card-presentation">
      {!card.official ? (
        <Text style={styles.draft} testID="report-card-draft-banner">
          BROUILLON — document non officiel
        </Text>
      ) : null}
      {header ? (
        <View style={[styles.header, header.layout === "logo_center" && styles.headerCenter]} testID="report-card-header">
          {logoSource ? (
            <Image source={logoSource} style={styles.logo} resizeMode="contain" accessibilityLabel="Logo de l'établissement" testID="report-card-header-logo" />
          ) : null}
          <View style={styles.headerText}>
            {header.lines.map((line, index) => (
              <Text key={`${index}-${line}`} style={[styles.headerLine, header.layout === "logo_center" && styles.textCenter]}>{line}</Text>
            ))}
            {header.title ? (
              <Text style={[styles.headerTitle, (header.title_align === "center" || (!header.title_align && header.layout === "logo_center")) ? styles.textCenter : styles.textLeft]} testID="report-card-header-title">{header.title}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={styles.identity} testID="report-card-identity">
        {(header ? header.items : card.identity).map((item) => (
          <View key={item.label} style={styles.identityItem}>
            <Text style={styles.identityLabel}>{item.label}</Text>
            <Text style={styles.identityValue}>{item.value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.chips} accessibilityRole="tablist">
        {options.map((option) => (
          <TouchableOpacity
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: option.id === selected }}
            style={[styles.chip, option.id === selected && styles.chipActive]}
            onPress={() => setSelected(option.id)}
          >
            <Text style={[styles.chipText, option.id === selected && styles.chipTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {card.incomplete ? <Text style={styles.incomplete}>Résultats incomplets : notes manquantes.</Text> : null}
      {card.subjects.map((subject) => (
        <View
          key={subject.key}
          style={[styles.subject, subject.kind === "composite" && styles.composite, subject.level > 0 && styles.child]}
        >
          <View style={styles.subjectHeader}>
            <Text style={[styles.subjectLabel, subject.kind === "composite" && styles.compositeLabel]}>{subject.label}</Text>
            <Text style={styles.subjectTotal}>
              <Text style={subject.totalFailing ? styles.failing : undefined}>{subject.totalValue}</Text>
              {subject.totalMax !== "—" ? ` / ${subject.totalMax}` : ""}
            </Text>
          </View>
          {subject.components.length ? (
            <View style={styles.components}>
              {subject.components.map((component) => (
                <Text key={component.id} style={[styles.component, component.missing && styles.missing]}>
                  {component.label} : <Text style={component.failing ? styles.failing : undefined}>{component.value}</Text>
                  {component.max ? ` / ${component.max}` : ""}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ))}
      <View style={styles.summary}>
        {card.summary.map((item) => (
          <View key={item.label} style={styles.summaryItem}>
            <Text style={styles.identityLabel}>{item.label}</Text>
            {item.points !== undefined ? (
              <Text style={styles.summaryValue}>
                <Text style={item.failing ? styles.failing : undefined}>{item.points}</Text>
                {item.max && item.max !== "—" ? ` / ${item.max}` : ""}
              </Text>
            ) : (
              <Text style={styles.summaryValue}>{item.value}</Text>
            )}
          </View>
        ))}
      </View>
      {card.signatures.length ? (
        <View style={styles.signatures} testID="report-card-signatures">
          {card.signatures.map((label, index) => (
            <View key={`${index}-${label}`} style={styles.signature}>
              <View style={styles.signatureLine} />
              <Text style={styles.identityLabel}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Logo figé d'un bulletin publié : requête authentifiée (Bearer), jamais d'URL publique. */
function useFrozenLogo(path: string | null) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    setSource(null);
    if (!path) return undefined;
    void getAccessToken()
      .then((token) => {
        if (alive && token) setSource({ uri: `${getApiBaseUrl()}${path}`, headers: { Authorization: `Bearer ${token}` } });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return source;
}

const styles = StyleSheet.create({
  wrapper: { gap: 8, marginBottom: 12 },
  draft: { color: "#92400E", backgroundColor: "#FEF3C7", padding: 8, borderRadius: 10, fontWeight: "900" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  headerCenter: { flexDirection: "column" },
  headerText: { flexShrink: 1, width: "100%", gap: 2 },
  headerLine: { color: "#334155", fontSize: 11, fontWeight: "800" },
  headerTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  textCenter: { textAlign: "center" },
  textLeft: { textAlign: "left" },
  logo: { width: 56, height: 56 },
  signatures: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  signature: { flex: 1, minWidth: "40%", gap: 4 },
  signatureLine: { height: 28, borderBottomWidth: 1, borderBottomColor: "#94A3B8" },
  identity: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  identityItem: { minWidth: "45%" },
  identityLabel: { color: "#64748B", fontSize: 11, fontWeight: "900" },
  identityValue: { color: "#0F172A", fontSize: 13, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "800", fontSize: 12 },
  chipTextActive: { color: "#FFFFFF" },
  incomplete: { color: "#92400E", fontWeight: "800" },
  subject: { borderRadius: 12, backgroundColor: "#FFFFFF", padding: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  composite: { backgroundColor: "#F1F5F9" },
  child: { marginLeft: 14 },
  subjectHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  subjectLabel: { color: "#0F172A", fontWeight: "800", flexShrink: 1 },
  compositeLabel: { fontWeight: "900" },
  subjectTotal: { color: "#0F172A", fontWeight: "900" },
  components: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  component: { color: "#475569", fontSize: 12, fontWeight: "700" },
  missing: { color: "#B45309", fontStyle: "italic" },
  // Note en échec : rouge et soulignée.
  failing: { color: "#B91C1C", textDecorationLine: "underline" },
  summary: { flexDirection: "row", gap: 8 },
  summaryItem: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 8 },
  summaryValue: { color: "#0F172A", fontWeight: "900", marginTop: 2 },
});
