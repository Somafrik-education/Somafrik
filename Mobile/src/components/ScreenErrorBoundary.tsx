import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import { describeAppBuild } from "../lib/appBuildInfo";
import { SCREEN_ERROR_COPY, describeScreenError } from "../lib/screenErrorPresentation";

type Props = {
  routeName: string;
  routeKey: string;
  onBack?: () => void;
  children: React.ReactNode;
};

type State = { error: unknown | null; errorRouteKey: string | null };

/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 1 + LOT 7 — frontière d'erreur par écran.
 *
 * N'avale rien : l'erreur est journalisée avec sa pile (logcat `ReactNativeJS E`,
 * tag SCREEN_RENDER_ERROR) puis affichée explicitement. Le reste de l'application
 * (en-tête, onglets, autres écrans) reste utilisable au lieu d'un écran blanc global.
 */
export default class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorRouteKey: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Nouvelle route affichée par ce même conteneur : repartir d'un état propre.
    if (state.error && state.errorRouteKey && state.errorRouteKey !== props.routeKey) {
      return { error: null, errorRouteKey: null };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    this.setState({ errorRouteKey: this.props.routeKey });
    const detail = describeScreenError(error, this.props.routeName);
    console.error(
      `SCREEN_RENDER_ERROR route=${detail.route} kind=${detail.kind} message=${detail.message}`,
      error instanceof Error ? error.stack : "",
      info?.componentStack ?? "",
    );
  }

  private retry = () => this.setState({ error: null, errorRouteKey: null });

  render() {
    if (!this.state.error) return this.props.children;
    const detail = describeScreenError(this.state.error, this.props.routeName);
    const build = describeAppBuild(Constants.expoConfig);
    return (
      <ScrollView contentContainerStyle={styles.container} testID="screen-render-error" accessibilityRole="alert">
        <Text style={styles.title}>{SCREEN_ERROR_COPY.title}</Text>
        <Text style={styles.body}>{SCREEN_ERROR_COPY.body}</Text>
        <View style={styles.detail}>
          <Text style={styles.detailText} testID="screen-render-error-detail">{`Écran : ${detail.route}`}</Text>
          <Text style={styles.detailText}>{`${detail.kind} : ${detail.message}`}</Text>
          <Text style={styles.detailText}>{`${build.value} · ${build.detail.split(".")[0]}`}</Text>
        </View>
        <TouchableOpacity style={styles.primary} onPress={this.retry} accessibilityRole="button" testID="screen-render-error-retry">
          <Text style={styles.primaryText}>{SCREEN_ERROR_COPY.retry}</Text>
        </TouchableOpacity>
        {this.props.onBack ? (
          <TouchableOpacity style={styles.secondary} onPress={this.props.onBack} accessibilityRole="button" testID="screen-render-error-back">
            <Text style={styles.secondaryText}>{SCREEN_ERROR_COPY.back}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: "center", backgroundColor: "#F8FAFC" },
  title: { fontSize: 20, fontWeight: "800", color: "#0F172A", textAlign: "center" },
  body: { marginTop: 10, fontSize: 15, lineHeight: 22, color: "#475569", textAlign: "center" },
  detail: { marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0" },
  detailText: { fontSize: 13, color: "#334155", marginBottom: 4 },
  primary: { marginTop: 20, minHeight: 48, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  secondary: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#475569", fontWeight: "700" },
});
