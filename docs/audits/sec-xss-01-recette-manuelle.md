# SEC-XSS-01 — Recette manuelle de l'aperçu HTML des bulletins

Procédure QA défensive, à exécuter **uniquement sur un environnement local fictif**
(backend en mode mémoire ou PostgreSQL jetable, comptes de démonstration, aucune
donnée ni aucun secret réel). Elle complète les tests automatisés
(`npm run verify:sec-xss-01`) pour les scénarios qui exigent un navigateur réel.

## Préparation

1. Lancer le backend et le Web en local (`npm run dev` ou équivalent), base jetable.
2. Ouvrir Chromium avec les DevTools (onglets *Elements*, *Console*, *Network*).
3. Se connecter avec un compte Superadmin de démonstration, ouvrir
   **Conception bulletins** (`BulletinDesignPage`).
4. Dans l'onglet *Network*, filtrer sur toutes les requêtes et cocher
   *Preserve log*.
5. Préparer les fixtures QA à partir de la liste des scénarios ci-dessous. Toute
   tentative de chargement doit viser **un serveur local fictif** (par exemple
   `http://127.0.0.1:<port>/marker/<scénario>`) dont on lit le journal d'accès.
   Ne jamais viser un service réel.

## Vérifications de l'aperçu (bouton « Visionner (HTML) »)

| Réf. | Action | Observation attendue |
|---|---|---|
| R-01 | Modèle par défaut, puis « Visionner (HTML) » | Panneau « Aperçu HTML » affiché sous l'éditeur ; **aucun nouvel onglet** |
| R-02 | *Elements* : inspecter l'`iframe[data-bulletin-preview-frame]` | Attribut `sandbox=""` présent et vide ; pas d'attribut `src` ; `srcdoc` présent |
| R-03 | *Elements* : `<head>` du document de l'iframe | Première balise : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; …">` |
| R-04 | *Console* : choisir le contexte de l'iframe (`about:srcdoc`) et évaluer `self.origin` | `"null"` |
| R-05 | Même contexte : accès à `localStorage`, `sessionStorage`, `document.cookie`, `parent.document` | `SecurityError` pour chacun |
| R-06 | Fixtures « script inline », « script externe », « attribut d'événement », « SVG avec événement », « iframe/srcdoc », « lien `javascript:` » (XSS-02 à XSS-07) | Rien ne s'exécute ; journal du serveur fictif vide ; messages CSP/sandbox éventuels en *Console* |
| R-07 | Fixtures « image, police, CSS distants » (XSS-13) | Aucune requête vers le serveur fictif ; ressources simplement absentes |
| R-08 | Fixtures « formulaire », « lien `target=_top` », « meta refresh » (XSS-11/12) | La page Somafrik ne change pas ; aucune requête vers le serveur fictif |
| R-09 | Enchaîner : modèle légitime → fixture → modèle légitime (XSS-17) | Chaque aperçu reste isolé (R-02 à R-05) ; le modèle légitime s'affiche normalement |
| R-10 | Bouton « Fermer l'aperçu », changement de classe ou d'établissement | Le panneau d'aperçu disparaît |
| R-11 | Modèle légitime avec tableau, styles et logo établissement (XSS-19) | Rendu identique à l'aperçu PDF (hors pagination) |
| R-12 | « Télécharger aperçu PDF » (XSS-20) | PDF ouvert dans le lecteur PDF du navigateur ; impression depuis ce lecteur |

## Vérifications de l'éditeur GrapesJS

| Réf. | Action | Observation attendue |
|---|---|---|
| E-01 | Ouvrir l'éditeur sur une classe | Modèle affiché, glisser-déposer et blocs « Données dynamiques » fonctionnels |
| E-02 | *Elements* : `<head>` de l'iframe `.gjs-frame` | `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; …">` en tête |
| E-03 | Enregistrer par l'API (compte établissement de démonstration) un modèle dont le projet GrapesJS contient des attributs d'événement, puis ouvrir l'éditeur en Superadmin (XSS-14/15/16) | Aucune exécution ; journal du serveur fictif vide ; *Elements* : les attributs d'événement sont absents des composants du canevas |
| E-04 | Modifier puis enregistrer un modèle légitime, recharger la page | Modèle relu à l'identique (styles, tableaux, jetons) |

## Critères de sortie

- Toutes les lignes ci-dessus conformes, avec capture des DevTools et du journal
  du serveur fictif.
- Toute non-conformité bloque le passage Ready de la PR SEC-XSS-01.
- Ne conserver aucune donnée réelle dans les captures.
