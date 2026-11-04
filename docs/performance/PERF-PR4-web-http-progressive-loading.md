# PERF-PR4 — Client HTTP Web : délais, annulation et chargement progressif

Statut : **DRAFT / HOLD**. Base : `develop` à `b41a83ad3` (PERF-PR1 #1062, PERF-PR2 #1063, PERF-PR3 #1064 inclus). Ni Mobile, ni backend, ni règles métier modifiés.

## 1. Architecture avant / après

### Avant

- `web/src/api/client.ts` : `fetch` sans délai ni signal.
  - Un endpoint qui ne répond pas bloque son appelant indéfiniment.
  - Une coupure réseau remonte en `TypeError` brute.
- `loadDomains` : `Promise.allSettled` sur tous les domaines du lot, puis une fusion unique à la fin. Le domaine le plus lent retient l'affichage de tous les autres.
- `DataContext.refreshDomains` : contrôle de génération **par lot**. Une lecture plus récente d'un seul domaine fait jeter tout le lot.
- Changement d'utilisateur ou d'établissement :
  - aucune requête n'est annulée ;
  - les générations n'avancent pas au changement d'utilisateur : une réponse tardive de l'ancien compte pouvait être fusionnée ;
  - `inFlightEnsureRef` est indexé par domaine seulement : une lecture `students` de l'établissement A en vol pouvait être réutilisée par un `ensureDomains` de B.
- `DataContext.update` relit les domaines après écriture sans générations. Une lecture plus ancienne pouvait l'écraser.

### Après

| Couche | Changement |
|---|---|
| `client.ts` | `exchange()` : un `AbortController` par échange, lié au délai et au signal de l'appelant. Le minuteur et l'écouteur sont retirés en `finally`, corps de réponse compris. Les erreurs sont typées (§4). |
| Fonctions `*Api.list…` des loaders | Paramètre optionnel `...init: RequestArgs` (signal, délai). Sans option, l'appel reste identique à l'historique. |
| `loadDomains` | `Promise.all` sur des promesses qui ne rejettent jamais. Chaque domaine est signalé dès sa fin à `onDomain`. La promesse attend toujours tout le lot. Le résultat ajoute `aborted` et `serverErrors[].kind`. |
| `DataContext` | Fusion **domaine par domaine**, avec génération **par domaine** et portée vérifiée. Ajouts : `domainStatus` (chargement, prêt, erreur et nature de l'erreur) et `retryDomains()`. |
| Portées de lecture | `principal` (utilisateur) et `school` (utilisateur + établissement), chacune avec son `AbortController`. Quitter une portée annule ses requêtes, et ses réponses ne sont jamais fusionnées. |
| `Topbar` | Bouton « Réessayer » à côté du message d'erreur, limité aux domaines en échec. |

## 2. Inventaire des consommateurs

| Consommateur | Nombre | Impact |
|---|---:|---|
| Appels `api.get/post/put/patch/delete`, `request`, `requestBlob` (hors tests) | 349 | Contrat inchangé. Les lectures JSON ont désormais un délai de 20 s et les lectures de fichier un délai de 120 s. |
| Appelants de `ensureDomains` | 8 fichiers | `DomainRouteBootstrap`, `ActiveSchoolContext`, `UsersPage`, `ParentProfilePage`, `ParentDashboardPage`, `ConfigurationPage`, `ParentFinancePage`, `OverviewPage`. Promesse inchangée, rejet sur erreur bloquante comme avant. |
| Appelants de `refresh(...)` après mutation | ~25 sites | Élèves, Présences, Notes (`GradesEvaluationsPage`), Finance (`QuickFeeGridModal`, `FinanceFeesPage`, `FinanceUnpaidPage`, `QuickPaymentModal`), Planning, Utilisateurs, Établissement. Seuls les domaines demandés sont relus. |
| Lecteurs de `useData().loading` et `.error` | 8 fichiers | Sémantique inchangée : `loading` reste vrai tant qu'un lot est en vol, `error` reste le message agrégé du dernier lot. |
| `loadDomains` | 1 appelant (`DataContext`) | Signature compatible (troisième argument facultatif). |
| Fichiers de test qui remplacent `../api/client` par un mock partiel | 26 | Les nouvelles détections d'erreur se font par champ `kind` (`lib/httpErrorKinds.ts`), sans dépendre de nouveaux exports du client. |

Chargements simultanés de plusieurs domaines :
- `DomainRouteBootstrap` : un `ensureDomains(domaines de la route)` en production, un `ensureDomains([domaine])` par domaine en Démo ;
- `ActiveSchoolContext` : `schools` et `academicConfigs` ;
- `refresh()` sans argument : tous les domaines déjà chargés ;
- `update()` : domaines résiduels après une écriture.

PR ouvertes touchant les mêmes fichiers (59 PR ouvertes examinées, diff contre leur merge-base) :
- Somafrik-education/Somafrik#1016 : garde `academicConfigs` dans `domainLoaders.ts`, quelques lignes, compatible ;
- Somafrik-education/Somafrik#648 : Web Push dans `AuthContext.tsx`, fichier non modifié ici.

## 3. Contrats préservés

- Les URL, méthodes, en-têtes, corps et le `ApiError` (`status`, `code`, `details`, `message`) sont inchangés. `instanceof ApiError` reste réservé aux réponses HTTP.
- `ensureDomains` et `refresh` attendent toujours **tous** les domaines du lot. Ils rejettent sur une erreur bloquante, sauf 403, comme avant. L'affichage progressif ne change pas cette garantie.
- `loadDomains(keys, options)` sans troisième argument renvoie le même résultat, plus `aborted: []`.
- Une erreur 403 reste fail-closed : rien n'est fusionné, et elle n'est pas affichée comme une panne globale. Une erreur 401 reste bloquante.
- Les écrans dont l'affichage attend la fin d'hydratation de la route (`DomainRouteBootstrap`, `setDomainRouteHydrationStatus` : Vue d'ensemble, Notes, Planning, Finance) gardent cette attente. Leurs KPI ne doivent pas afficher de faux zéros. Les autres écrans, qui lisent `state` directement, s'affichent désormais au fil des réponses.

## 4. Gestion du délai

| Requête | Délai par défaut | Justification |
|---|---|---|
| Lecture JSON (`GET`/`HEAD`) | **20 s**, réglable par `VITE_API_READ_TIMEOUT_MS` | proposé par le mandat |
| Domaines d'historique `presences`, `notes`, `payments`, `studentFees`, `bulletins` | **60 s** explicite | PERF-PR3 : historique d'une école de 500 élèves ≈ 8 Mio gzip, ≈ 67 s à 1 Mbit/s ; 20 s rendrait ces écrans inutilisables sur liaison lente |
| Lecture de fichier (`requestBlob` en `GET` : PDF, pièces jointes, photos) | **120 s** | taille et génération variables |
| Renouvellement de jeton | 20 s | partagé par tous les appels en attente |
| Écriture (`POST/PUT/PATCH/DELETE`, `postBlob`) | **aucun** | un délai ne prouve pas que le serveur n'a pas écrit ; possible par appel (`timeoutMs`) |

Types d'erreur :

| Classe | `kind` | Cas |
|---|---|---|
| `ApiError` | `http` | réponse non 2xx |
| `ApiNetworkError` | `network` | serveur injoignable |
| `ApiTimeoutError` | `timeout` | délai client dépassé ; `outcomeUnknown = true` pour une écriture, avec le message « l'opération a peut-être été enregistrée » |
| `ApiAbortError` | `aborted` | annulation volontaire, jamais affichée comme une panne |
| `isSessionExpiredError()` | — | `ApiError` 401 après échec du renouvellement |

Rejeux :
- le seul rejeu automatique reste celui qui suit un 401, après un renouvellement de jeton. Le serveur a refusé sans exécuter : le rejeu est sûr, même pour une écriture ;
- aucun rejeu après un délai dépassé, une erreur réseau ou une erreur 5xx ;
- en cas de délai dépassé ou de coupure réseau pendant le renouvellement, l'erreur remonte telle quelle : ce n'est pas une session expirée.

## 5. Stratégie d'annulation

| Événement | Effet |
|---|---|
| Déconnexion, changement de compte | Portées `principal` et `school` annulées. Le cache des lectures en vol et `domainStatus` sont vidés. Une réponse tardive (même d'un serveur qui ignore l'annulation) n'est jamais fusionnée : contrôle de portée à la fusion. |
| Changement d'établissement (`beginScopeTransition`) | Seule la portée `school` est annulée (domaines `SCHOOL_SCOPED_CANONICAL_KEYS` + `academicConfigs`). Les domaines plateforme (`schools`, `countries`, `rolePermissions`…) continuent : le sélecteur d'établissement du Superadmin n'est pas vidé. |
| Lecture remplacée par une plus récente du même domaine | **Pas d'annulation réseau.** La lecture en vol peut être partagée par plusieurs composants via `ensureDomains`, et l'annuler les ferait échouer. Sa réponse est ignorée par le contrôle de génération par domaine. |
| Navigation rapide entre écrans | Pas d'annulation : les domaines de l'écran quitté alimentent le cache et sont partagés. Mesure §8. |

Les promesses annulées par changement de portée se résolvent sans erreur visible : `refresh` ne lève rien et `error` n'est pas modifié.

## 6. Authentification

- Le renouvellement anticipé (`expiresSoon`) et le renouvellement unique partagé (`refreshInFlight`) sont conservés. Le renouvellement n'est annulable par aucun appelant isolé.
- L'échec du renouvellement donne un 401 remonté tel quel (session expirée), sans boucle.
- Un 401 ou un 403 n'est jamais converti en donnée. Le loader le classe en erreur du domaine, rien n'est fusionné, et `domainStatus` conserve `httpStatus`.
- La garde Superadmin plateforme, le RBAC backend et la séparation Démo / Préproduction / Production ne sont pas modifiés. Aucun code serveur n'est modifié.

## 7. Isolation multi-tenant

- Chaque lecture porte la portée active à son départ. Elle n'est fusionnée que si cette portée est toujours courante **et** si sa génération est la dernière lancée pour ce domaine.
- Le changement d'établissement retire les lectures scolaires en vol du cache partagé, ce qui supprime la réutilisation d'une lecture de A par B.
- Tests : changement A → B → A rapide, réponse tardive après changement de compte, déconnexion pendant une lecture lente (§8).

## 8. Tests et benchmark

### Tests ajoutés

| Fichier | Couverture |
|---|---|
| `web/src/lib/httpClient.perfPr4.test.ts` (19) | lecture réussie ; 400, 403, 500 typés ; 401 = session expirée ; erreur réseau ; délai de 20 s à la milliseconde près ; délai explicite sans minuteur orphelin ; écriture sans délai par défaut ; **mutation exécutée par le serveur après le délai client** : `outcomeUnknown`, un seul envoi ; aucun rejeu d'écriture après 500 ou coupure réseau ; annulation volontaire ; signal déjà annulé (aucun envoi) ; écouteur retiré ; renouvellement puis rejeu ; échec du renouvellement sans boucle ; renouvellement trop lent = délai et non session expirée ; rejeu unique d'une écriture refusée en 401 |
| `web/src/context/DataContext.progressive.test.tsx` (11) | 3 domaines aux délais différents, le premier fusionné avant la fin du plus lent et la promesse qui attend tout ; erreur sans effacer les 2 autres ; délai dépassé qui conserve la donnée valide ; réponse obsolète ignorée ; rafraîchissement après mutation limité au domaine ; relance des seuls domaines en échec ; déconnexion pendant une lecture lente ; réponse tardive d'un ancien compte ; changement d'établissement (scolaire annulé, plateforme poursuivie) ; A → B → A ; 401 jamais exploitable |
| `web/src/context/perfPr4.benchmark.test.tsx` (5) | banc ci-dessous, avec ses assertions |

Tests existants adaptés :
- `EtablissementOverviewPage.bootstrap.test.tsx` : l'appel `/assignments` porte désormais un signal (`expect.objectContaining({ signal })`).

Note : `web/src/api/client.jwtRefresh.test.ts` n'est pas inclus dans `vitest.config.ts` (`src/api/**` absent de `include`), il ne tourne donc pas en CI. Exécuté à part sur ce code : 3/3. Les nouveaux tests du client sont placés dans `src/lib` pour être exécutés.

### Benchmark (temps **simulé**, minuteurs factices)

Commande :

```bash
npx --prefix web vitest run src/context/perfPr4.benchmark.test.tsx --reporter=verbose
```

Le banc utilise le vrai client, les vrais loaders et le vrai `DataContext` ; seul `fetch` est simulé. A = 100 ms, B = 1 500 ms, C = 8 000 ms. « Avant » : fusion au moment où le lot se termine (comportement `Promise.allSettled` historique) et client sans délai.

| Mesure | Avant | Après |
|---|---:|---:|
| Première donnée affichée | 8 000 ms | **100 ms** |
| Disponibilité A / B / C | 8 000 / 8 000 / 8 000 ms | **100 / 1 500 / 8 000 ms** |
| Disponibilité complète | 8 000 ms | 8 000 ms |
| Requêtes | 3 | 3 |
| Requêtes annulées | 0 | 0 |
| C sans réponse | lot **jamais terminé** (vérifié à 120 s) | A et B prêts à 2 s ; C en erreur `timeout` à **20 000 ms** ; lot terminé |
| Navigation rapide (écran 1 : élèves + droits ; écran 2 à +200 ms : élèves + classes) | — | 3 requêtes, `/students` **une seule fois**, 0 annulation |
| Changement d'établissement à +500 ms | — | `/students` **annulé**, 0 ligne fusionnée ; `rolePermissions` prêt |

Ce ne sont pas des temps de préproduction : aucun accès Render depuis la session de travail.

## 9. Risques résiduels

- Délai de 20 s sur toutes les lectures JSON. Un endpoint légitimement lent, hors des 5 domaines d'historique, échouera désormais au lieu d'attendre. Les clients concernés peuvent passer un `timeoutMs` explicite. À valider en préproduction.
- Seuls les loaders de domaines transmettent un signal d'annulation. Les 349 appels directs des écrans gardent un délai, mais ne sont pas annulés à la déconnexion. Leurs réponses ne passent pas par `DataContext` et sont gérées par leurs propres écrans, comme avant.
- Le changement d'établissement n'annule que s'il passe par `beginScopeTransition` (sélecteur d'établissement). La sélection initiale automatique n'annule rien : il n'y a pas d'établissement quitté.
- Les écrans gardés par `domainRouteHydration` (Vue d'ensemble, Notes, Planning, Finance) attendent toujours tous leurs domaines, pour ne pas afficher de faux zéros. Leur gain se limite au délai : un endpoint bloqué ne les fige plus indéfiniment.
- `error` reste le message agrégé du dernier lot, comme avant. L'état fin est dans `domainStatus`, et seul la Topbar l'utilise pour l'instant.

## 10. Hors périmètre

- Mobile (client HTTP, SQLite, cache L1), routes backend, RBAC, bulletins, finance, présences, abonnements, Carte Élève, Agent IA, Render, `main`, règles GitHub : **non modifiés**.
- Aucune dépendance ajoutée.
- PERF-PR5 : non commencé.
