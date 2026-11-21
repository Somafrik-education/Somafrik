# NFC-PRES-LOCAL-01 — Audit de contrats Offline-first (CTO, 2026-11-06)

**Statut : AUDIT / DRAFT / HOLD. Aucune modification produit, aucune migration, aucun déploiement.**
Références : #1098 (objectif produit), #921 (preuve physique), #911 (backend transactionnel), #975 (optimisation individuelle).

## Inspection indépendante du develop courant
Base relevée lors de la revue précédente : `develop@a14c5866b3145758bdc48bf1285e16f6f3d49ad0`. Les fichiers ont été relus directement dans GitHub sur `develop`.
- `Mobile/src/lib/studentCardRollCall.ts` : `RollCallDraft` ne garde que `receipt` + `dedupKey`, dans la RAM; `createRollCallNfcLoop` attend `submit(token)` avant la carte suivante; messages hors ligne = carte non comptée.
- `Mobile/src/services/studentCardRollCallApi.ts` : `POST /student-cards/roll-call/scan`, `GET /student-cards/roll-call/roster`, `POST /student-cards/roll-call/validate` (`complete:true` pour l'appel de classe avec `manual`).
- `backend/lib/studentCardRollCall.js` : reçu AES-256-GCM signé au sens authentifié, déduplication HMAC liée à session, `RECEIPT_TTL_MS = 4h`, contrôle expiration et classe/session/user/mode, revalidation carte active et tenant sous transaction, idempotence validation par `sessionId`. Max 300 reçus.
- `Mobile/src/lib/studentCardRollCallSession.ts` : UUID de session réutilisé pour l'opération idempotente.
- `Mobile/src/lib/outbox.ts` : outbox persistante existante pour domaine `presences`, fichier JSON par défaut; pas une persistance SQLite automatiquement garantie pour ce parcours.
- `Mobile/src/lib/attendanceOffline.ts` : overlays queued/failed basés sur outbox; PostgreSQL reste source de vérité.
- `Mobile/src/offline/l1/l1SqliteCache.test.ts` : fondation L1 SQLite/SQLCipher chiffrée (`database`, `schema`, `lifecycle`), adapter existant; `expo-sqlite` déjà dans `Mobile/package.json`.

## Bloquants d'architecture
**P0-A — Le contrat scan suppose un serveur en ligne**. Le reçu est émis *après* `POST /scan`; il ne peut être généré par la seule lecture NFC hors réseau. Un batch `/validate` de reçus ne traite pas de scans réellement offline. Il faut un nouveau contrat explicite en **PR Backend isolée**, sans altérer les routes historiques. Jamais générer des reçus serveur prétendus en local.

**P0-B — Preuve et secret de carte**. La synchronisation différée doit prouver quel tag a été lu sans stocker en clair les capabilities NFC persistantes, ni les exposer dans logs/crash/analytics. Comparer deux approches et décider par tests de sécurité : (1) coffre SQLCipher compartimenté, enregistrements temporaires strictement chiffrés contenant la preuve nécessaire à la résolution serveur, avec rotation/effacement/expiration; (2) protocole de préautorisation offline par serveur avec preuves spécifiques vérifiables. Le simple UID NXP ou le hash non secret du publicId ne prouve pas l'authenticité et ne doit pas permettre d'enregistrer une présence. La solution offline ne garantit pas à elle seule l'anti-clonage.

**P0-C — Révocations et rôle pendant la coupure**. Toute validation finale relit PostgreSQL : carte active non révoquée/non remplacée, inscription courante, classe, rôle et autorisation effective, établissement, flags carte/NFC/présence, session et date. Le cache de roster sert au feedback *provisoire* uniquement, pas à accorder des droits irrévocables. Refus/conflit = état visible, jamais « synchronisé ».

**P0-D — Durée, reprise et cohérence**. TTL reçu actuel 4h, donc un scan offline au-delà de 4h ne peut pas réutiliser la validation actuelle. Sauvegarde transactionnelle à chaque scan, clé de déduplication par élève et carte, UUID session stable, éviction sûre, fermeture/crash/redémarrage, absence de double appel; idempotencyKey stable sur timeout/retry avec empreinte immuable du lot validé. En cas de correction après une tentative d'envoi, créer une nouvelle révision/opération explicite sans écraser un lot potentiellement confirmé.

**P0-E — « Présent » et absences**. Le flux `complete:true` existant accepte une liste `manual` (present/late/absent) et confirme l'appel complet ; les absences ne doivent jamais être créées lors de simples scans partiels. Les corrections et états protégés (`excused`) doivent conserver les invariants serveur actuels. Pas de clôture automatique à zéro restant.

**P1-F — Ne pas confondre les trois parcours**. NFC encodage physique (#921), scan individuel avec enregistrement immédiat (#975), appel collectif à reçus (#935 et descendants). Ce mandat concerne le *brouillon local de classe et sa validation différée*, pas le remplacement de l'encodeur ni la désactivation de l'appel manuel/QR.

## Découpage imposé (conditionnel après arbitrage P0-B)
1. **Contrat Backend** : endpoint batch offline **nouveau et versionné**, strictement tenant + RBAC + flags + absence de double présence; preuve cryptographique, limites débit/taille/temps, refuse carte révoquée et classe divergente; idempotence PG transactionnelle, test cross-tenant et concurrence, flags fail-closed. Aucun override de route actuelle.
2. **Persistence Mobile** : utiliser les primitives SQLCipher déjà disponibles si appropriées à la gestion des clés; migration additive et données partitionnées user/school/date/class/session; transactions, TTL, logout, clé absente -> fail-closed; tests crash/reprise, espace disque, corruption.
3. **Scan Mobile UX** : pas d'API bloquante par tag, déduplication stable, compteur provisoire, affichage absence connexion, correction manuelle avant confirmation. Il faut une indication explicite des scans non encore vérifiés côté serveur.
4. **Sync/QA** : transaction de clôture, outbox persistante, retry sûr, ACK serveur, conflit/roster changé, révocation, perte réseau, redémarrage, une seconde tablette; absence de faux succès; tests PG réels et APK Android préprod.
5. **Smoke physique** : NTAG213 et NTAG216, 30+ scans rapides, passage mode avion, fermeture forcée après plusieurs scans, reprise, validation et vérification PostgreSQL, aucune duplication, puis contrôle non-régression QR et manuel. Bloqué tant que #921 n'a pas son smoke concluant.

## Gate CTO
Aucun Ready/Merge sans **diff GitHub indépendant sur le HEAD exact**, base/merge-base/ahead-behind, CI Required verte, tests sécurité ciblés, absence de données sensibles dans la PR, relecture des invariants, et smoke nécessaire. Périmètre de cette PR : **ce seul document**. Aucune exécution de tests locaux ou PostgreSQL effectuée dans cet audit documentaire ; ne pas extrapoler des tests existants au parcours nouveau.

## Décision
**NO GO sur une implémentation précipitée de la sauvegarde des reçus existants** : ils ne peuvent pas exister hors réseau et expirent sous 4 heures. Priorité : arrêter le contrat cryptographique et la gestion des données locales sous revue CTO, puis implémenter en PR atomiques. #921 demeure un blocage de recette physique, pas de préparation du contrat.
