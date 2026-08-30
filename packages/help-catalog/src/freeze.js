export function freezeArray(values) {
  return Object.freeze(Array.isArray(values) ? [...values] : []);
}

export function freezeArticle(article) {
  return Object.freeze({
    id: article.id,
    title: article.title,
    summary: article.summary,
    roles: freezeArray(article.roles),
    permissions: freezeArray(article.permissions),
    platforms: freezeArray(article.platforms),
    routeKeys: freezeArray(article.routeKeys),
    keywords: freezeArray(article.keywords),
    steps: freezeArray(article.steps),
    relatedArticles: freezeArray(article.relatedArticles),
    captureIds: freezeArray(article.captureIds),
    captureStatus: article.captureStatus || "guide-only",
    sourceGuide: article.sourceGuide || "both",
    popular: Boolean(article.popular),
    navigate: article.navigate
      ? Object.freeze({
          level: "NAVIGATION",
          webPath: article.navigate.webPath || null,
          mobileRoute: article.navigate.mobileRoute || null,
          permission: article.navigate.permission || null,
        })
      : null,
  });
}

export function freezeCatalog(articles) {
  return Object.freeze(articles.map((article) => freezeArticle(article)));
}
