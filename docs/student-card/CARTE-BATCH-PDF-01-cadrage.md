# CARTE-BATCH-PDF-01 — Contrat de réalisation et sécurité (CTO)

**Statut : DRAFT / HOLD — cadrage technique initial, aucune émission par lot livrée.**

## Objectif
Ajouter sur chaque ligne de classe un bouton **Émettre / exporter cartes PDF** qui produit un document A4 de cartes CR80 actives, chacune dotée de son QR sécurisé, sans révoquer ni remplacer les cartes déjà actives et sans dégrader leur futur provisionnement NFC.

## Règles non négociables

1. **Une identité de carte unique** : le QR d'une carte imprimée et la puce NFC encodée ultérieurement utilisent le même `student_access_cards.id`, le même `public_id` et la même empreinte `token_hash`. Employer le parcours de provisionnement d'une carte active `POST /api/student-cards/:id/nfc-provision`, **pas** l'émission NFC d'une nouvelle carte ni le remplacement.
2. **Carte active existante** : le secret original est non récupérable en base. Ne jamais remplacer, révoquer ou renouveler automatiquement une carte pour l'inclure dans un PDF. L'interface doit marquer cette carte **déjà active — QR non réexportable** et la laisser intacte. Ne pas créer un faux QR.
3. **Émission nouvelle** : réserver ce flux aux élèves éligibles sans carte active. Autorisation RBAC école, tenant et classe vérifiée côté Backend ; niveau titulaire déterminé ; paramétrage QR activé ; scolarité courante vérifiée.
4. **Sécurité des jetons** : le jeton complet peut être rendu seulement dans une réponse d'émission autorisée et le flux PDF éphémère. Aucun jeton/secret/PDF persistant dans PostgreSQL, navigateur, logs, audit, stockage distant ou URL. Réponse `Cache-Control: no-store`, aucune mise en cache, téléchargement explicite ; avertissement de conservation matérielle du PDF par l'opérateur.
5. **Concurrence/idempotence** : protéger deux opérateurs lançant le lot simultanément et la relance après perte de réponse. Ne pas laisser de cartes inutilisables sans délivrance du QR. Présenter explicitement le risque d'une émission déjà validée en base mais dont la réponse/PDF est perdue : **ne pas remédier par remplacement silencieux**. Concevoir un protocole sûr avant écriture.
6. **Impression** : PDF A4 portrait, cartes CR80 exactes 85,60 × 53,98 mm, au plus 2 colonnes × 5 lignes si les marges et espacements réels le permettent ; repères de découpe discrets, pas de redimensionnement. Les 5 rangées occupent déjà 269,9 mm sur 297 mm : il reste 27,1 mm au total pour marges et entre-rangées. Privilégier une pagination moins dense si les espacements de sécurité ne tiennent pas.
7. **Parité UI** : le composant visuel CARTE-UI-01 doit servir de référence ; titres CARTE D'ÉLÈVE ou CARTE D'ÉTUDIANT exclusivement issus du Backend ; nom canonique établissement (prévoir dépendance CARTE-UI-03A #980), initiales quand photo absente, identité et matricule complets.
8. **Périmètre** : aucune mutation des cartes actives ou de leur `token_hash` ; aucune modification des flux lecture QR, NFC, présence, impayés ou bus. Pas de migration ni de nouvelle API sans justification, tests et mandat explicite.

## Découpage proposé
- **BATCH-AUDIT** (ce document) : localiser exactement la page Classes et ses contrats, lister les états et erreurs possibles, définir le protocole d'émission atomique/récupération d'erreur, traiter la confidentialité du document PDF.
- **BATCH-API** : implémentation Backend transactionnelle à partir de l'API canonique de cartes, avec retour des jetons uniquement au moment de l'émission ; autorisations et tests PostgreSQL.
- **BATCH-WEB-PDF** : bouton sur chaque classe, précontrôle et confirmation du nombre de cartes nouvelles / existantes / bloquées, PDF A4 paginé, suppression immédiate de la représentation temporaire ; tests imprimante et scan.
- **BATCH-NFC-REPLAY** : preuve d'immutabilité `id/public_id/token_hash` avant/après écriture NFC et contrôle de scan QR/NFC. Smoke préprod uniquement après validation CTO séparée.

## Tests obligatoires
Établissements A/B et classes A/B (aucune fuite inter-tenant) ; classe vide ; absent du cycle ; rôles non autorisés ; 0/1/10/11/50 élèves ; mixte élèves/étudiants ; carte déjà active ; concurrent double lancement ; réessai après coupure réseau ; échec PDF ; révocation/perte manuelle ; impression A4 100 % ; scan QR de toutes les cartes et provisionnement NFC sur une carte issue du lot en conservant les trois identifiants.

## Gates de livraison
Chaque lot reste **Draft/HOLD**. Diff GitHub indépendant CTO et CI verte exigés avant Ready/Merge. Pas de déploiement automatique, pas de promotion `main`.
