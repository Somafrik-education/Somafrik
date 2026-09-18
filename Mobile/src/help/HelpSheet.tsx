import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  filterHelpArticles,
  groupHelpArticlesByCategory,
  navigationIsAllowed,
  searchHelpArticles,
  suggestHelpArticles,
  type HelpArticle,
  type HelpCategoryGroup,
  type HelpContext,
} from "../../../packages/help-catalog/src/index.js";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

export function HelpSheet({
  context,
  onClose,
  onNavigate,
}: {
  context: HelpContext;
  onClose: () => void;
  onNavigate: (routeName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const allowed = useMemo(() => filterHelpArticles(context), [context]);
  const suggestions = useMemo(() => suggestHelpArticles(context), [context]);
  const categories = useMemo(() => groupHelpArticlesByCategory(context), [context]);
  const searchResults = useMemo(() => searchHelpArticles(context, query), [context, query]);
  const assistance = allowed.find((article) => article.id === "help/assistance/contact") ?? null;
  const activeArticle = allowed.find((article) => article.id === activeId) ?? null;
  const categoryGroup = categories.find((group) => group.id === activeCategory) ?? null;

  function handleNavigate(article: HelpArticle) {
    if (!navigationIsAllowed(article, context)) return;
    const route = article.navigate?.mobileRoute;
    if (typeof route !== "string" || route.trim() === "") return;
    onNavigate(route);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={styles.sheet} accessibilityRole="summary">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Besoin d’aide ?
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer l’aide" style={styles.close}>
            <Text style={styles.closeLabel}>Fermer</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {activeArticle ? (
            <ArticleView
              article={activeArticle}
              related={(activeArticle.relatedArticles ?? [])
                .map((id) => allowed.find((item) => item.id === id))
                .filter((item): item is HelpArticle => Boolean(item))}
              canNavigate={navigationIsAllowed(activeArticle, context)}
              onBack={() => setActiveId(null)}
              onOpenRelated={setActiveId}
              onNavigate={() => handleNavigate(activeArticle)}
            />
          ) : (
            <BrowseView
              query={query}
              onQueryChange={setQuery}
              suggestions={suggestions}
              categories={categories}
              categoryGroup={categoryGroup}
              onOpenCategory={setActiveCategory}
              onBackCategory={() => setActiveCategory(null)}
              searchResults={searchResults}
              assistance={assistance}
              onOpen={setActiveId}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function BrowseView({
  query,
  onQueryChange,
  suggestions,
  categories,
  categoryGroup,
  onOpenCategory,
  onBackCategory,
  searchResults,
  assistance,
  onOpen,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: readonly HelpArticle[];
  categories: readonly HelpCategoryGroup[];
  categoryGroup: HelpCategoryGroup | null;
  onOpenCategory: (id: string) => void;
  onBackCategory: () => void;
  searchResults: readonly HelpArticle[];
  assistance: HelpArticle | null;
  onOpen: (id: string) => void;
}) {
  const searching = query.trim().length > 0;

  return (
    <View style={styles.stack}>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="Rechercher dans l’aide"
        accessibilityLabel="Rechercher dans l’aide"
        style={styles.search}
        testID="help-search"
      />
      {searching ? (
        <ArticleList heading="Résultats" articles={searchResults} empty="Aucun article pour cette recherche." onOpen={onOpen} />
      ) : categoryGroup ? (
        <View style={styles.stack}>
          <Pressable onPress={onBackCategory} accessibilityRole="button" style={styles.back}>
            <Text style={styles.backLabel}>Retour aux catégories</Text>
          </Pressable>
          <ArticleList heading={categoryGroup.label} articles={categoryGroup.articles} empty="Aucun guide dans cette catégorie." onOpen={onOpen} />
        </View>
      ) : (
        <View style={styles.stack}>
          <ArticleList
            heading="Suggestions pour cet écran"
            articles={suggestions}
            empty="Aucune suggestion pour cet écran."
            onOpen={onOpen}
          />
          <Text style={styles.section}>Catégories</Text>
          {categories.map((group) => (
            <Pressable
              key={group.id}
              onPress={() => onOpenCategory(group.id)}
              accessibilityRole="button"
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{group.label}</Text>
              <Text style={styles.cardSummary}>
                {group.articles.length} guide{group.articles.length > 1 ? "s" : ""}
              </Text>
            </Pressable>
          ))}
          {assistance ? (
            <View>
              <Text style={styles.section}>Assistance</Text>
              <Pressable onPress={() => onOpen(assistance.id)} accessibilityRole="button" style={styles.card}>
                <Text style={styles.cardTitle}>{assistance.title}</Text>
                <Text style={styles.cardSummary}>{assistance.summary}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
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
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        articles.map((article) => (
          <Pressable key={article.id} onPress={() => onOpen(article.id)} accessibilityRole="button" style={styles.card}>
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
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <Text style={styles.backLabel}>Retour à l’aide</Text>
      </Pressable>
      <Text style={styles.articleTitle}>{article.title}</Text>
      <Text style={styles.cardSummary}>{article.summary}</Text>
      {article.steps.map((step, index) => (
        <Text key={step} style={styles.step}>
          {index + 1}. {step}
        </Text>
      ))}
      {canNavigate ? (
        <Pressable onPress={onNavigate} accessibilityRole="button" style={styles.navigate}>
          <Text style={styles.navigateLabel}>Ouvrir cet écran</Text>
        </Pressable>
      ) : null}
      {related.map((item) => (
        <Pressable key={item.id} onPress={() => onOpenRelated(item.id)} accessibilityRole="button" style={styles.back}>
          <Text style={styles.backLabel}>{item.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: "#FFFFFF", paddingTop: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  close: { minHeight: MIN_TOUCH_TARGET_DP, minWidth: MIN_TOUCH_TARGET_DP, justifyContent: "center" },
  closeLabel: { color: "#1d4ed8", fontWeight: "800" },
  body: { padding: 16, paddingBottom: 48 },
  stack: { gap: 12 },
  search: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    color: "#0F172A",
  },
  section: { fontSize: 12, fontWeight: "800", color: "#64748B", textTransform: "uppercase" },
  empty: { color: "#64748B", fontWeight: "600" },
  card: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  cardSummary: { marginTop: 4, color: "#64748B", fontWeight: "600" },
  back: { minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center" },
  backLabel: { color: "#1d4ed8", fontWeight: "800" },
  articleTitle: { fontSize: 20, fontWeight: "800", color: "#0F172A" },
  step: { color: "#0F172A", fontWeight: "600", lineHeight: 20 },
  navigate: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
    justifyContent: "center",
  },
  navigateLabel: { color: "#FFFFFF", fontWeight: "800" },
});
