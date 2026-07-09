import { StyleSheet } from "react-native";

/** Styles partagés pour Notes / Présences / Paiements. */
export const studentSubScreenStyles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#F8FAFC",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 20,
    color: "#64748B",
    fontWeight: "700",
  },
  summaryCard: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 18,
  },
  summaryLabel: {
    fontWeight: "700",
  },
  summaryValue: {
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
  summaryMeta: {
    fontWeight: "700",
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 12,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  cardMeta: {
    marginTop: 4,
    color: "#64748B",
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontWeight: "900",
    overflow: "hidden",
  },
  empty: {
    color: "#64748B",
    fontWeight: "700",
    paddingVertical: 24,
    textAlign: "center",
  },
});
