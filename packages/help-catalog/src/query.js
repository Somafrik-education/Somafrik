import { HELP_CATALOG } from "./articles.js";
import { articleMatchesContext, isHelpAvailable } from "./context.js";
import { HELP_CATEGORY_ORDER, normalizeHelpText } from "./constants.js";
import { helpCategoryLabel } from "./categories.js";

const DEFAULT_SUGGESTION_LIMIT = 3;

export function filterHelpArticles(context, catalog = HELP_CATALOG) {
  if (!isHelpAvailable(context)) return Object.freeze([]);
  return Object.freeze(catalog.filter((article) => articleMatchesContext(article, context)));
}

function articleSearchText(article) {
  return normalizeHelpText(
    [article.title, article.summary, ...(article.keywords || []), ...(article.steps || [])].join(" "),
  );
}

export function searchHelpArticles(context, query, catalog = HELP_CATALOG) {
  const corpus = filterHelpArticles(context, catalog);
  const tokens = normalizeHelpText(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return Object.freeze([]);

  return Object.freeze(
    corpus.filter((article) => {
      const haystack = articleSearchText(article);
      return tokens.every((token) => haystack.includes(token));
    }),
  );
}

export function suggestHelpArticles(context, options = {}, catalog = HELP_CATALOG) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_SUGGESTION_LIMIT;
  const corpus = filterHelpArticles(context, catalog);
  const screenMatches = corpus.filter((article) => article.routeKeys.includes(context.screen));
  const ranked = [...screenMatches].sort((left, right) => Number(right.popular) - Number(left.popular));
  return Object.freeze(ranked.slice(0, limit));
}

export function popularHelpArticles(context, options = {}, catalog = HELP_CATALOG) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_SUGGESTION_LIMIT;
  const corpus = filterHelpArticles(context, catalog).filter((article) => article.popular);
  return Object.freeze(corpus.slice(0, limit));
}

export function groupHelpArticlesByCategory(context, catalog = HELP_CATALOG) {
  const corpus = filterHelpArticles(context, catalog);
  const groups = [];
  for (const category of HELP_CATEGORY_ORDER) {
    const articles = corpus
      .filter((article) => article.category === category)
      .slice()
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "fr"));
    if (articles.length === 0) continue;
    groups.push(
      Object.freeze({
        id: category,
        label: helpCategoryLabel(category),
        articles: Object.freeze(articles),
      }),
    );
  }
  return Object.freeze(groups);
}
