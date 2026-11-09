# NFC-ROLES-ACCESS-01 — Appel direct et droit dédié

**Issue :** #1138 — **PR :** #1139 — **Statut :** DRAFT / HOLD / NO MERGE / NO DEPLOY

## Décision CTO
Un utilisateur scolaire disposant de `Appel scolaire:CREATE` peut ouvrir Présences,
puis **Démarrer l'appel NFC/QR → Choisir une classe autorisée → Scanner**, sans
l'autorisation de consulter la fiche de la classe ou la liste scolaire.

- Le Superadmin administre seul la matrice RBAC existante. Aucun chemin d'édition
  Admin School n'est créé.
- Enseignant : affectations de classes actives ; responsable scolaire : classes
  actives de son établissement, sur attribution explicite de son propre rôle.
- Surveillant/Comptable : uniquement si le Superadmin leur donne le nouveau droit ;
  aucun grant par défaut.
- Parents, Élèves, rôles plateforme : exclus.
- L'affichage Mobile n'est jamais une autorité ; pack et sync revérifient
  les droits par rôle en PostgreSQL.

## API et Mobile
- `GET /api/student-cards/roll-call/offline/v1/classes` : réponse
  `{ classes: [{classId,classCode,className}] }` uniquement, `no-store`,
  état de l'établissement relu et autorisations de classe identiques à pack/sync.
- Pack `GET /offline/v1/pack` et sync `POST /offline/v1/sync` :
  `Appel scolaire:CREATE` au lieu du droit large de modification de présences.
- Mobile : sélecteur autonome chargé par API, aucune navigation vers une fiche,
  réponse filtrée sur liste blanche, requêtes obsolètes écartées après changement
  de compte, moteur SQLCipher/NFC/QR existant inchangé.
- Les actions de **vérification d'une carte** et **appel NFC/QR** utilisent
  des permissions distinctes.

## Compatibilité des grants au premier démarrage
`migrateRollCallGrantsOnce` est exécuté après l'ensemencement du catalogue
et des anciennes permissions, avant l'ouverture du serveur.

- Migration transactionnelle PostgreSQL, verrou consultatif et marqueur
  `rbac_one_time_migrations('nfc-roles-access-01')`.
- Copie initiale des grants Présences existants (CREATE ou UPDATE) vers
  `roll_call` dans les mêmes portées role/pays/établissement, y compris les
  overrides négatifs. Jamais de droit par défaut pour les autres rôles.
- Une révocation de `roll_call` après l'initialisation n'est **jamais**
  rétablie par un second démarrage.
- Les grants déjà explicitement configurés pour `roll_call` sont respectés.
- Aucune migration destructive des présences ou appels SQLCipher.

**Ordre de déploiement impératif :** schéma/catalogue/grants prêts avant que les
routes NFC puissent accepter une demande ; éviter les versions de Backend
hétérogènes pendant la bascule. **Pas de déploiement prod dans cette PR.**

## Recette bloquante (à compléter avec preuves CI exactes)
1. RBAC HTTP + PostgreSQL réel : Directeur/Secrétaire avec
   `Appel scolaire:CREATE`, sans droits de lecture classe/élève.
2. Liste des classes de son établissement uniquement, affectations de
   l'enseignant uniquement, aucun élève ni détail scolaire renvoyé.
3. Droit retiré après téléchargement du pack : liste/pack/sync refusés.
4. Droit de vérification sans droit d'appel et inversement.
5. Bootstrap deux fois : droit révoqué non ressuscité, overrides école respectés.
6. Test L4-09 : seules les ancres et fichiers exacts de la PR passent ;
   fichiers étrangers ou ancres absentes échouent.
7. Test Mobile, native Hermes/SQLCipher, multi-scan de 10 cartes et QR.
8. Smoke physique de préproduction : Directeur, Secrétaire, Enseignant ;
   classe sélectionnée sans ouvrir sa fiche ; clôture et synchronisation.

## Repli / rollback
- Ne pas effacer les appels SQLCipher ni les journaux d'appels PostgreSQL.
- Revenir au code précédemment déployé si le backend est incompatible ;
  les grants `roll_call` restent en base mais ne suffisent pas à ouvrir les
  anciens endpoints. Ne pas supprimer les grants pour « nettoyer ».
- Aucun GO-PROD avant tests du HEAD exact, diff GitHub indépendant et smoke.

**La présence d'une PR Draft et de tests source n'est pas une preuve de réussite CI.**
