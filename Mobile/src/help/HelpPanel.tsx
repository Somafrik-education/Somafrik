import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  filterHelpArticles,
  popularHelpArticles,
  searchHelpArticles,
  suggestHelpArticles,
  type HelpArticle,
  type HelpContext,
} from "@somafrik/help-catalog";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { helpMobileRoute } from "./helpNavigation";
import { HELP_SHEET_ZINDEX, helpSheetUsesFullscreen } from "./helpOverlayPolicy";
import { HELP_TEST_IDS } from "./HelpTrigger";

type Props = {
  context: HelpContext;
  onClose: () => void;
  onNavigate: (routeName: string) => void;
};

export default function HelpPanel({ context, onClose, onNavigate }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const fullscreen = helpSheetUsesFullscreen(height);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const allowed = useMemo(() => filterHelpArticles(context), [context]);
  const suggestions = useMemo(() => suggestHelpArticles(context), [context]);
  const popular = useMemo(
    () => popularHelpArticles(context).filter((article) => !suggestions.some((item) => item.id === article.id)),
    [context, suggestions],
  );
  const searchResults = useMemo(() => searchHelpArticles(context, query), [context, query]);
  const activeArticle = allowed.find((article) => article.id === activeId) ?? null;
  const related = (activeArticle?.relatedArticles ?? [])
    .map((id) => allowed.find((article) => article.id === id))
    .filter((article): article is HelpArticle => Boolean(article));

  function handleNavigate(article: HelpArticle) {
    const route = helpMobileRoute(article, context);
    if (!route) return;
    onNavigate(route);
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Fermer l’aide"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        style={[
          styles.sheetWrap,
          fullscreen ? styles.sheetFull : styles.sheetBottom,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          accessibilityLabel="Besoin d’aide"
          testID={HELP_TEST_IDS.sheet}
        >
          <View style={styles.header}>
            <Text nativeID="help-panel-title" style={styles.title} maxFontSizeMultiplier={1.4}>
              Besoin d’aide
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer l’aide"
              testID={HELP_TEST_IDS.close}
              style={styles.iconButton}
            >
              <Text style={styles.iconButtonText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {activeArticle ? (
              <ArticleView
                article={activeArticle}
                related={related}
                canNavigate={Boolean(helpMobileRoute(activeArticle, context))}
                onBack={() => setActiveId(null)}
                onOpenRelated={setActiveId}
                onNavigate={() => handleNavigate(activeArticle)}
              />
            ) : (
              <BrowseView
                query={query}
                onQueryChange={setQuery}
                suggestions={suggestions}
                popular={popular}
                searchResults={searchResults}
                onOpen={setActiveId}
              />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function BrowseView({
  query,
  onQueryChange,
  suggestions,
  popular,
  searchResults,
  onOpen,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: readonly HelpArticle[];
  popular: readonly HelpArticle[];
  searchResults: readonly HelpArticle[];
  onOpen: (id: string) => void;
}) {
  const searching = query.trim().length > 0;
  return (
    <View style={styles.stack}>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="Rechercher dans l’aide"
        placeholderTextColor="#94A3B8"
        accessibilityLabel="Rechercher dans l’aide"
        testID={HELP_TEST_IDS.search}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={styles.search}
      />
      {searching ? (
        <ArticleList
          heading="Résultats"
          articles={searchResults}
          empty="Aucun article pour cette recherche."
          onOpen={onOpen}
        />
      ) : (
        <>
          <ArticleList
            heading="Suggestions pour cet écran"
            articles={suggestions}
            empty="Aucune suggestion pour cet écran."
            onOpen={onOpen}
          />
          <ArticleList
            heading="Guides populaires"
            articles={popular}
            empty="Aucun guide populaire pour votre rôle."
            onOpen={onOpen}
          />
        </>
      )}
    </View>
  );
}

function ArticleList({
  heading,
  articles,
  empty,
  onOpen,
}: {
  heading: string;
  articles: readonly HelpArticle[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.section}>{heading}</Text>
      {articles.length === 0 ? (
        <Text style={styles.muted}>{empty}</Text>
      ) : (
        articles.map((article) => (
          <Pressable
            key={article.id}
            onPress={() => onOpen(article.id)}
            accessibilityRole="button"
            accessibilityLabel={article.title}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{article.title}</Text>
            <Text style={styles.cardSummary}>{article.summary}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function ArticleView({
  article,
  related,
  canNavigate,
  onBack,
  onOpenRelated,
  onNavigate,
}: {
  article: HelpArticle;
  related: HelpArticle[];
  canNavigate: boolean;
  onBack: () => void;
  onOpenRelated: (id: string) => void;
  onNavigate: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Retour à l’aide"
        testID={HELP_TEST_IDS.back}
        style={styles.back}
      >
        <Text style={styles.backText}>Retour à l’aide</Text>
      </Pressable>
      <Text style={styles.articleTitle}>{article.title}</Text>
      <Text style={styles.muted}>{article.summary}</Text>
      {article.steps.map((step, index) => (
        <Text key={step} style={styles.step}>
          {index + 1}. {step}
        </Text>
      ))}
      {canNavigate ? (
        <Pressable
          onPress={onNavigate}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir cet écran"
          testID={HELP_TEST_IDS.navigate}
          style={styles.navigate}
        >
          <Text style={styles.navigateText}>Ouvrir cet écran</Text>
        </Pressable>
      ) : null}
      {related.length > 0 ? (
        <View>
          <Text style={styles.section}>Articles liés</Text>
          {related.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onOpenRelated(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              style={styles.related}
            >
              <Text style={styles.backText}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: HELP_SHEET_ZINDEX,
    elevation: HELP_SHEET_ZINDEX,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
  },
  sheetWrap: {
    zIndex: HELP_SHEET_ZINDEX,
    maxHeight: "92%",
  },
  sheetFull: {
    flex: 1,
    marginTop: 12,
  },
  sheetBottom: {
    maxHeight: "85%",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: 280,
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  title: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
    flex: 1,
    paddingRight: 12,
  },
  iconButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  iconButtonText: {
    color: "#475569",
    fontSize: 18,
    fontWeight: "700",
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 28,
  },
  stack: {
    gap: 12,
  },
  search: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: "#0F172A",
    backgroundColor: "#F8FAFC",
  },
  section: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 8,
  },
  muted: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  cardTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  cardSummary: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  back: {
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
  },
  backText: {
    color: "#2563EB",
    fontSize: 15,
    fontWeight: "800",
  },
  articleTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
  },
  step: {
    color: "#0F172A",
    fontSize: 15,
    lineHeight: 22,
  },
  navigate: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  navigateText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
  },
  related: {
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
  },
});
