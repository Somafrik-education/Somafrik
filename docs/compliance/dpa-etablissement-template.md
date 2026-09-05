# Accord de sous-traitance — établissement client Somafrik (article 28 RGPD)

**Nature :** modèle de contrat. **Aucune valeur tant qu’il n’est pas signé** par les deux parties.  
**Sous-traitant :** Baudouin Okito — France — `contact@somafrik.app` (l’« Opérateur »).  
**Responsable de traitement :** l’établissement scolaire identifié en-tête de la version signée (le « Responsable »).  
**Pas de SIREN, société ou adresse inventés.** À compléter hors git lors de la signature.

---

## Article 1 — Objet, durée, nature et finalité

1.1 **Objet.** L’Opérateur fournit le logiciel Somafrik (interface web, API, application mobile) afin que le Responsable gère la scolarité de son établissement (comptes, inscriptions, classes, présences, évaluations, bulletins, communications, pièces jointes, paiements de scolarité).

1.2 **Nature du traitement.** Collecte, enregistrement, organisation, conservation, consultation, utilisation, communication par transmission interne à l’établissement, restriction, effacement et anonymisation, dans la mesure nécessaire au service.

1.3 **Finalité.** Exécution du contrat de service scolaire. **Interdit :** marketing, profilage commercial, revente, entraînement de modèles, croisement inter-établissements.

1.4 **Durée.** Celle du contrat de service, augmentée des durées de conservation prévues à l’article 10 et à la matrice de conservation de l’Opérateur (sessions, journaux, sauvegardes hébergeur).

---

## Article 2 — Catégories de personnes concernées

Élèves (y compris mineurs) ; représentants légaux ; personnel de l’établissement (direction, secrétariat, enseignants, préfecture des études) ; éventuellement fournisseurs scolaires identifiés par l’établissement ; utilisateurs habilités par le Responsable.

---

## Article 3 — Catégories de données

Selon les modules activés par le Responsable : identité et identifiants de compte ; coordonnées ; établissement / rôle ; données de connexion et de sécurité (y compris jetons d’accès et de rafraîchissement, jetons de notification) ; inscriptions, classes, présences, évaluations, bulletins ; communications et pièces jointes (PDF, JPEG, PNG) ; paiements et grilles de frais enregistrés par l’établissement. Les pièces jointes **peuvent** contenir des données sensibles si l’établissement les y dépose ; ce n’est pas une finalité de Somafrik.

---

## Article 4 — Instructions documentées

4.1 L’Opérateur ne traite les données **que** sur instruction documentée du Responsable, y compris pour les transferts, sauf obligation légale.

4.2 Constituent des instructions : l’usage du logiciel par les comptes habilités ; les paramétrages d’établissement ; les demandes d’effacement / export passées par les canaux prévus (page publique de suppression, API privacy, export établissement).

4.3 L’Opérateur informe le Responsable si une instruction lui paraît contraire au RGPD.

---

## Article 5 — Confidentialité

Les personnes autorisées à traiter les données (personnel de l’Opérateur, prestataires ultérieurs) sont tenues à une obligation de confidentialité. Les rôles plateforme Superadmin / Admin Pays **n’ont pas** d’accès HTTP aux données personnelles métier d’un établissement (`GET /api/students`, `GET /api/audit`, export, listes d’effacement école).

---

## Article 6 — Sécurité (art. 32)

Mesures mises en œuvre dans le produit, dans l’état du dépôt : HTTPS ; authentification JWT HS256 ; jeton d’accès ≤ 15 minutes en production ; jetons de rafraîchissement hashés, rotatifs, révoquables ; verrouillage Data API Supabase (`anon` / `authenticated`) ; cloisonnement par établissement ; contrôle des pièces jointes (types, taille, octets magiques, pas d’adresse publique anonyme) ; journalisation sans secrets. Le Responsable reste responsable des habilitations qu’il attribue dans son établissement.

---

## Article 7 — Sous-traitants ultérieurs

7.1 Sous-traitants ultérieurs autorisés à la date du modèle : **Supabase** (PostgreSQL), **Render** (hébergement API et site), **Expo** (notifications push et compilation de l’application). GitHub n’héberge pas les données scolaires ; il traite du code et des journaux de CI.

7.2 L’Opérateur informe le Responsable de tout ajout ou remplacement. Le Responsable peut s’y opposer pour motif légitime. Les sous-traitants ultérieurs sont liés par des obligations au moins équivalentes au présent article 28.

7.3 Lieux et mécanismes : registre `docs/compliance/sous-traitants-transferts.md` (régions réellement constatées + DPA / SCC / Data Privacy Framework des prestataires).

---

## Article 8 — Droits des personnes

Le Responsable est le point de contact des personnes. L’Opérateur assiste le Responsable (accès, rectification, effacement, limitation, opposition, portabilité lorsque l’art. 20 s’applique) via les fonctions du logiciel et `POST /api/privacy/erasure-requests`. L’effacement de compte **anonymise le compte et révoque les sessions** ; il **ne détruit pas** automatiquement le dossier scolaire, financier ou les pièces jointes, que le Responsable peut devoir conserver.

La page publique `https://somafrik.app/suppression-compte` enregistre une demande ; elle n’exécute pas l’effacement.

---

## Article 9 — Violation de données

L’Opérateur notifie **le Responsable sans délai injustifié** après en avoir pris connaissance (art. 33.2), avec les éléments utiles, **sans secrets** et **sans listes d’élèves**. **C’est le Responsable** qui notifie l’autorité de contrôle (en France : CNIL, 72 heures lorsqu’un risque existe) et les personnes, sauf mandat écrit contraire. Voir `docs/compliance/procedure-violation-donnees.md`.

---

## Article 10 — Sort des données en fin de contrat

À la fin du service, selon l’instruction du Responsable : export des données d’établissement (`GET /api/data-export`, rôles établissement uniquement) puis suppression ou anonymisation des comptes d’accès. Les sauvegardes des hébergeurs suivent leur propre délai ; un restore peut réintroduire un compte anonymisé — procédure : réexécuter l’effacement. Les dossiers scolaires conservés sur instruction ou obligation légale ne sont pas auto-purgés par l’application.

---

## Article 11 — Assistance, documentation et audit

11.1 L’Opérateur assiste le Responsable pour les analyses d’impact, consultations préalables et demandes d’autorité, dans la limite des informations dont il dispose.

11.2 L’Opérateur met à disposition les documents de conformité du dépôt (registres, matrice de conservation, AIPD, la présente trame).

11.3 Droit d’audit **documentaire** raisonnable (questionnaires, attestations, extraits de politique prestataire). Pas d’accès direct à la production ni aux données d’autres établissements. Les audits techniques destructifs ou d’intrusion restent soumis à GO CTO et à un périmètre écrit.

---

## Article 12 — Transferts hors EEE

Les transferts éventuels vers Render, Supabase, Expo ou GitHub s’appuient sur le DPA de chaque prestataire et, le cas échéant, les clauses contractuelles types et/ou le Data Privacy Framework. Détail des régions constatées : `docs/compliance/sous-traitants-transferts.md`.

---

## Signatures (version papier / PDF hors git)

Responsable (établissement) : nom, fonction, date, signature  
Opérateur : Baudouin Okito, date, signature
