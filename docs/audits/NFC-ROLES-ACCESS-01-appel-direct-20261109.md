# NFC-ROLES-ACCESS-01 — Appel NFC/QR direct avec droit dédié

**Statut : DRAFT / HOLD — NO READY — NO MERGE — NO DEPLOY.** Base : `develop@8e2e1cca` (#1136 fusionnée).

## 1. Audit des permissions existantes

| Élément | Avant |
|---|---|
| Catalogue RBAC | modules `Module:ACTION` (`functionalModulesCatalog.js`), seedés en base à chaque démarrage. Aucun droit d'appel dédié. Précédent : module `entry_control` (« Contrôle d'entrée »), sans droit par défaut |
| Pack (`GET …/offline/v1/pack`) et synchronisation (`POST …/offline/v1/sync`) | `Présences:CREATE` ou `Présences:UPDATE` à la route ; rôle isolé avec écriture Présences + périmètre (#1136) |
| Réglages carte (`GET /api/student-cards/capabilities`) | `Présences:CREATE` ou `Présences:UPDATE` |
| Vérification de carte (`POST /api/student-cards/verify`) | `Élèves:READ`, `Voir élèves`, `Gérer élèves`, `Présences:CREATE` ou `Présences:UPDATE` |
| Édition de la matrice RBAC | **Superadmin uniquement** (`assertSuperAdmin`) ; aucune délégation Admin School |
| Mobile | boutons d'appel dans la vue d'**une classe ouverte** (`selectedClass`), affichés selon l'écriture des présences ; réglages carte chargés seulement avec le droit Présences |

Décision CTO : l'édition du nouveau droit reste **Superadmin seul**, dans la matrice existante. La délégation Admin School relève d'un chantier séparé.

## 2. Nouveau droit

- **Module** `roll_call`, libellé et préfixe de jeton **« Présences — Effectuer l'appel (NFC/QR) »**.
- **Effectuer l'appel** = `…:CREATE`. Les dépendances canoniques imposent `READ` avec `CREATE`.
- **Indépendant** des modules Classes, Élèves et Présences.
- **Aucun droit par défaut.**
- **Libellé** : le jeton ne contient ni `QR:` ni `NFC:`, ce que la garde `studentAccessCards.schema.test.js` interdit (modules propres aux cartes).

### Compatibilité, sans droit supprimé ni nouveau titulaire (`backend/lib/rollCallRbacCompat.js`)
- **Copie unique au démarrage** : chaque grant Présences actif en écriture des rôles qui avaient l'appel (TEACHER, SCHOOL_ADMIN, PROVISEUR, PRINCIPAL, PREFET_ETUDES, SECRETARY) reçoit un grant `roll_call` à l'identique : même rôle, même portée globale, pays ou établissement.
  - La copie n'a lieu que si **aucune** ligne `roll_call`, active ou archivée, n'a jamais existé pour ce rôle et cette portée.
  - Les grants ne sont jamais supprimés physiquement (mise à jour ou archivage) : un retrait ultérieur n'est donc **jamais** rétabli.
- **Rôle sans aucun grant** (repli sur les cartes historiques) : le droit d'appel est dérivé à la lecture de l'écriture Présences **du même rôle**, et jamais par union de rôles.
- Surveillant, Comptable et autres rôles : uniquement par attribution explicite.

## 3. Contrat d'autorisation (pack = liste des classes = synchronisation)

`resolveRollCallScope` / `resolveClassRollCallAuthority` / `listRollCallClasses` (`backend/lib/studentCardRollCall.js`) :

1. **Rôles actifs** relus en base : clés canoniques connues, aucun rôle plateforme ; famille (PARENT, STUDENT) exclue.
2. **Droit effectif live** « Présences — Effectuer l'appel (NFC/QR):CREATE », exigé à la route puis revérifié.
3. **Rôle pris isolément**, avec les overrides pays et établissement :
   - **enseignant** dont le rôle TEACHER porte le droit : classes **affectées** uniquement ; présences attribuées à l'enseignant ;
   - **tout autre rôle scolaire** dont le rôle porte le droit : classes **actives de son établissement** ; `teacher_id` NULL, journal `staff`.
4. **Classe active** du même établissement.
5. **Flags** carte, présences et appel hors connexion ; **abonnement** (`write_presence`).

**Nouvelle route `GET /api/student-cards/roll-call/offline/v1/classes`** :
- droit dédié ;
- données minimales `{classId, classCode, className, enrolled}`, sans aucune donnée d'élève ;
- ajoutée au garde plateforme : le Superadmin reste exclu.

**Réglages carte** : `GET /api/student-cards/capabilities` accepte aussi le droit dédié. La réponse ne contient que des drapeaux, sans donnée d'élève.

**Séparation** : consulter une classe (`Classes:READ`) ou les élèves (`Élèves:READ`) n'est **pas** requis. Le pack reste la liste minimale nécessaire au pointage (identité et statut du jour), inchangée.

### Matrice avant / après

| Profil | Avant (#1136) | Après |
|---|---|---|
| Enseignant affecté avec Présences | appel de ses classes | appel de ses classes **si son rôle porte le droit dédié** (copié automatiquement s'il avait Présences en écriture) |
| Directeur / Secrétaire / Préfet / Proviseur / Principal avec Présences | toutes les classes de l'établissement, depuis une classe ouverte | idem **depuis Présences, sans classe**, si le rôle porte le droit dédié (copié automatiquement) |
| Directeur avec le droit dédié **sans** Classes ni Élèves | — (impossible : droit Présences requis, boutons dans la classe) | **appel possible** (prouvé en PostgreSQL) |
| Surveillant / Comptable | refusé | refusé, **sauf droit dédié explicite** (établissement) |
| Présences en écriture **sans** le droit dédié | appel possible | **refusé** (classes, pack, sync) |
| Parent, Élève | refusé | refusé (même avec le jeton) |
| Superadmin, Admin pays | refusé | refusé (garde plateforme, route ajoutée) |

## 4. Mobile

- **Écran Présences** : bloc commun **« actions de carte »**, visible sur la **liste des classes** comme dans une classe.
  1. **« Vérifier une carte »** : sa propre permission (verify).
  2. **« Démarrer l'appel NFC/QR »** : droit dédié et appel hors connexion activé. Un sélecteur affiche les classes autorisées (serveur), sans fiche de classe ni donnée d'élève, puis ouvre le moteur local-first existant (`OfflineRollCallModal`).
  3. **« Vérifier les appels (Appels hors connexion) »** : droit dédié, appels locaux du compte.
- **Dépendance à une classe ouverte supprimée** pour l'affichage et le lancement. Une classe valide reste obligatoire avant le pack et l'enregistrement.
- **Hors connexion** : le sélecteur reprend la dernière liste obtenue pour le même compte et le même établissement (mémoire du processus, jamais persistée), avec un avertissement. Le serveur revérifie tout à la synchronisation.
- **Moteur NFC/QR non réécrit** : multi-scan, aucune requête HTTP par carte, SQLCipher, absences provisoires, statuts protégés, clôture et synchronisation inchangés.

## 5. Tests

| Test | Résultat local |
|---|---|
| `backend/lib/rollCallRoles.http.pg.test.js` (PostgreSQL 16 réel, 35 élèves) | vert : cas A, B, C, D, E et F ci-dessous, plus les sections de #1136 |
| **Nouveau** `backend/lib/rollCallRbacCompat.pg.test.js` | vert : copie à l'identique des portées, aucun nouveau titulaire, rejouable, retrait jamais rétabli au redémarrage, repli rôle par rôle |
| `rollCallOfflinePack` / `rollCallOfflineSync` / `rollCallOfflinePartial` / `studentCardRollCall` / `monoT1.rbacMatrix` (PG) | verts ; les tests de retrait portent désormais sur le droit dédié, et le retrait de Présences seul ne bloque plus l'appel |
| Base unitaire backend | 2 934 réussis, 0 échec, 3 ignorés. Comptage du catalogue 32 → 33 ; contrats RBAC des réglages carte ; garde de rejeu (tout rôle scolaire, famille refusée) |
| Web `admin07AdministrationReplay.audit.test.ts` | vert (33 modules) |
| Mobile `nfcRolesFinal.test.ts`, `studentCardRollCallRoles.test.ts` | verts : matrice de 16 profils sur le droit dédié ; actions communes aux deux vues ; lanceur indépendant de la classe ; jeton identique au serveur |
| Mobile `test:rollcall-offline` (SQLCipher) | 153/153 |
| `verify:student-card-qr`, parités LOT 0 et 1, hydratation, accueil, convergence, synchronisation de bout en bout, TypeScript | verts |
| `verify-mobile-usability.js` | **rouge, déjà rouge sur `develop`** (écran Annonces, ligne 205) ; les contrôles de l'écran Présences (ligne 148) passent |

Cas PostgreSQL :
- **A — Directeur** : sans `Classes:READ` ni `Élèves:READ` (403 sur `/classes` et `/students`). Il obtient pourtant la liste minimale des classes, le pack, les scans, la clôture et la synchronisation (22/35).
- **B — Secrétaire** : même scénario.
- **C — Enseignant** : seulement ses classes affectées. Sans affectation, la liste est vide.
- **D — Accès refusé** : Préfet avec Présences en écriture mais sans le droit dédié ; refusé sur la liste, le pack et la synchronisation, par appel direct de l'API.
- **E — Autre établissement** : liste limitée à son établissement ; lot de A envoyé par B refusé.
- **F — Révocation** : droit retiré entre le pack et la synchronisation, puis refus sans écriture. Aussi : rôle révoqué, override d'établissement refusé.

**Non exécutés :**
- **preuve Hermes / SQLCipher Android** : pas d'appareil dans la session ; à fournir par le workflow CI dédié ;
- **smoke physique**.

**Cas G — Performance** : le moteur de lecture n'est pas modifié (aucun fichier `offline/rollCall/session` ou `store` touché). Le sélecteur n'intervient qu'avant l'ouverture de l'appel.

## 6. Contrôle de périmètre L4-09
`platformPersonalDataGuard.js` (route ajoutée au garde plateforme) active le contrôle LOT 4 en CI. Une exception **ancrée et à liste fermée** `NFC-ROLES-ACCESS-01` est ajoutée sur le modèle des exceptions NFC existantes. Elle est évaluée avant elles, et tout fichier hors liste reste FAIL.

## 7. Risques résiduels
- **Délégation Admin School** absente : seul le Superadmin attribue ou retire le droit. Chantier séparé.
- **Préfet, Proviseur, Principal et autres rôles autorisés** : périmètre de tout l'établissement (aucun modèle de restriction par classe).
- **Rôles en repli historique** (aucun grant) : le droit est dérivé de leurs présences jusqu'à la première configuration du rôle dans la matrice.
- **Noms de classes** dans « Vérifier les appels » : connus après un passage par le sélecteur. Sinon, le libellé reste « Classe » pour un compte sans accès aux classes.
- **Anciennes fenêtres** de pointage individuel et d'appel collectif : toujours inatteignables (#1136).

## 8. Smoke physique (APK Preview préproduction)
1. **Superadmin** : vérifier le droit « Présences — Effectuer l'appel (NFC/QR) » dans la matrice (rôles Secrétaire et Admin School de l'établissement de test) et que les titulaires existants l'ont reçu.
2. **Directeur** avec le droit, **sans** consultation des classes :
   - ouvrir Présences ; « Démarrer l'appel NFC/QR » est visible sans ouvrir de classe ;
   - choisir une classe dans le sélecteur ;
   - scanner 10 cartes : « Présent » immédiat ;
   - clôturer et synchroniser ;
   - en PostgreSQL : 10 présences, journal `staff`, auteur Directeur.
3. **Secrétaire** : même scénario.
4. **Enseignant** : le sélecteur ne montre que ses classes.
5. **Retrait du droit** dans la matrice, puis nouvel appel : le sélecteur est refusé, et la synchronisation d'un pack déjà téléchargé est refusée sans écriture.
6. **Enchaînement rapide** de 10 cartes : aucune attente perceptible ; mode avion pendant les scans.
