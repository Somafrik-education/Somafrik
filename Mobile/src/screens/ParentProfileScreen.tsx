import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

export default function ParentProfileScreen() {
  const { session } = useAuth();
  const bottomPadding = useStackScreenBottomPadding();
  const user = (session?.user ?? {}) as Record<string, any>;
  const children = Array.isArray(user.children) ? user.children : [];
  const fullName =
    text(user.name) !== "—"
      ? text(user.name)
      : [text(user.firstName), text(user.lastName)].filter((value) => value !== "—").join(" ") || "Parent";
  const schoolName = text(session?.school?.name ?? user.schoolName ?? user.schoolCode);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      testID="parent-profile-screen"
    >
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Ionicons name="person-circle-outline" size={42} color="#0F766E" />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>Espace parent</Text>
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.school}>{schoolName}</Text>
        </View>
      </View>

      <ProfileCard title="Mon compte" icon="person-outline">
        <ProfileRow label="Prénom" value={text(user.firstName)} />
        <ProfileRow label="Nom" value={text(user.lastName)} />
        <ProfileRow label="Téléphone" value={text(user.phone ?? user.telephone)} />
        <ProfileRow label="E-mail" value={text(user.email)} />
        <ProfileRow label="Identifiant" value={text(user.identifier ?? user.publicId ?? user.id)} />
      </ProfileCard>

      <ProfileCard title="Établissement" icon="school-outline">
        <ProfileRow label="École" value={schoolName} />
        <ProfileRow label="Code établissement" value={text(session?.school?.code ?? user.schoolCode)} />
      </ProfileCard>

      <ProfileCard title="Mes enfants liés" icon="people-outline">
        {children.length ? (
          children.map((child: Record<string, unknown>, index: number) => (
            <View
              key={String(child.id ?? child.studentId ?? child.studentCode ?? index)}
              style={[styles.childRow, index > 0 && styles.childRowBorder]}
            >
              <Text style={styles.childName}>
                {text(child.name ?? `${String(child.firstName ?? "")} ${String(child.lastName ?? "")}`.trim())}
              </Text>
              <Text style={styles.childMeta}>
                {[text(child.className), text(child.studentCode ?? child.matricule ?? child.publicId)]
                  .filter((value) => value !== "—")
                  .join(" • ") || "Élève lié"}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>Aucun enfant n'est actuellement lié à ce compte.</Text>
        )}
      </ProfileCard>

      <View style={styles.infoBox}>
        <Ionicons name="shield-checkmark-outline" size={20} color="#1D4ED8" />
        <Text style={styles.infoText}>
          Les données scolaires affichées dans Somafrik sont limitées aux enfants officiellement liés à votre compte.
          Pour corriger vos coordonnées ou un lien parent-enfant, contactez votre établissement.
        </Text>
      </View>
    </ScrollView>
  );
}

function ProfileCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Ionicons name={icon} size={20} color="#0F172A" />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, gap: 14 },
  hero: {
    minHeight: 104,
    borderRadius: 20,
    backgroundColor: "#ECFDF5",
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: "#0F766E", fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  name: { color: "#0F172A", fontSize: 22, fontWeight: "900", marginTop: 3 },
  school: { color: "#475569", fontSize: 13, fontWeight: "700", marginTop: 4 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    padding: 16,
  },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  cardTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  row: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingVertical: 10,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  label: { width: 118, color: "#64748B", fontSize: 13, fontWeight: "800" },
  value: { flex: 1, color: "#0F172A", fontSize: 14, fontWeight: "700", textAlign: "right" },
  childRow: { paddingVertical: 10 },
  childRowBorder: { borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  childName: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  childMeta: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 4 },
  muted: { color: "#64748B", fontSize: 13, fontWeight: "700", paddingVertical: 8 },
  infoBox: {
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, color: "#334155", fontSize: 13, lineHeight: 19, fontWeight: "700" },
});
