import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NAVIGATION_TEST_IDS } from "../lib/mobileNavigationSpec";
import { HOME_SCROLL_TOP_DP, KPI_ROW_MIN_DP } from "../lib/mobileUxV1Layout";
import { MAX_HOME_KPIS } from "../lib/roleHomeConfig";

export type RoleDashboardIdentity = {
  name: string;
  context: string;
  spaceLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  onPress?: () => void;
  testID?: string;
};

export type RoleDashboardBanner = {
  title: string;
  mission: string;
  icon: keyof typeof Ionicons.glyphMap;
  background: string;
  onPress?: () => void;
  testID?: string;
};

export type RoleDashboardKpi = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
  bg: string;
  onPress?: () => void;
  testID?: string;
};

export type RoleDashboardAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

type RoleDashboardLayoutProps = {
  paddingBottom: number;
  paddingHorizontal: number;
  contentMaxWidth: number;
  headerSlot?: ReactNode;
  identity: RoleDashboardIdentity;
  banner: RoleDashboardBanner;
  kpis: RoleDashboardKpi[];
  actions: RoleDashboardAction[];
  showSecurityMatrix?: boolean;
  onSecurityMatrixPress?: () => void;
  footerSlot?: ReactNode;
};

export default function RoleDashboardLayout({
  paddingBottom,
  paddingHorizontal,
  contentMaxWidth,
  headerSlot,
  identity,
  banner,
  kpis,
  actions,
  showSecurityMatrix = false,
  onSecurityMatrixPress,
  footerSlot,
}: RoleDashboardLayoutProps) {
  const visibleKpis = kpis.slice(0, MAX_HOME_KPIS);

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom,
            paddingHorizontal,
            maxWidth: contentMaxWidth,
            alignSelf: "center" as const,
            width: "100%" as const,
          },
        ]}
      >
        {headerSlot}

        <TouchableOpacity activeOpacity={0.85} style={styles.identityCard} onPress={identity.onPress} testID={identity.testID}>
          <View style={[styles.identityIconBox, { backgroundColor: `${identity.accent}14` }]}>
            <Ionicons name={identity.icon} size={26} color={identity.accent} />
          </View>
          <View style={styles.identityInfo}>
            <Text style={styles.identityName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {identity.name}
            </Text>
            <Text style={styles.identityContext} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {identity.context}
            </Text>
            <Text style={[styles.identitySpace, { color: identity.accent }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {identity.spaceLabel}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.banner, { backgroundColor: banner.background }]}
          onPress={banner.onPress}
          testID={banner.testID}
        >
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {banner.title}
            </Text>
            <Text style={styles.bannerMission} numberOfLines={3} maxFontSizeMultiplier={1.3}>
              {banner.mission}
            </Text>
          </View>
          <View style={styles.bannerIcon}>
            <Ionicons name={banner.icon} size={26} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle} testID={NAVIGATION_TEST_IDS.homeOverviewTitle}>
            Vue métier
          </Text>
          {showSecurityMatrix && onSecurityMatrixPress ? (
            <TouchableOpacity onPress={onSecurityMatrixPress} accessibilityRole="button" accessibilityLabel="Matrice sécurité">
              <Text style={styles.sectionLink}>Matrice sécurité</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.sectionLinkMuted}>Aujourd’hui</Text>
          )}
        </View>

        <View style={styles.statsGrid}>
          {visibleKpis.map((kpi) => (
            <TouchableOpacity key={kpi.key} activeOpacity={0.85} style={styles.statCard} onPress={kpi.onPress} testID={kpi.testID}>
              <View style={[styles.statIconBox, { backgroundColor: kpi.bg }]}>
                <Ionicons name={kpi.icon} size={18} color={kpi.color} />
              </View>
              <Text style={[styles.statValue, { color: kpi.color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {kpi.value}
              </Text>
              <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {kpi.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {actions.length ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Actions rapides</Text>
            </View>
            <View style={styles.actionsGrid}>
              {actions.map((action) => (
                <TouchableOpacity key={action.key} activeOpacity={0.85} style={styles.quickAction} onPress={action.onPress}>
                  <View style={styles.quickActionIcon}>
                    <Ionicons name={action.icon} size={22} color="#2563EB" />
                  </View>
                  <Text style={styles.quickActionLabel} numberOfLines={1}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {footerSlot}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingTop: HOME_SCROLL_TOP_DP,
  },
  identityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  identityIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  identityInfo: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  identityContext: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  identitySpace: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
  },
  banner: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  bannerCopy: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  bannerTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  bannerMission: {
    marginTop: 4,
    color: "#DBEAFE",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    minHeight: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: "800",
    color: "#2563EB",
  },
  sectionLinkMuted: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
    minHeight: KPI_ROW_MIN_DP,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statIconBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  quickAction: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  quickActionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
});
