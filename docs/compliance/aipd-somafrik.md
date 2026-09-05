# Analyse d’impact relative à la protection des données — plateforme Somafrik

**Type :** AIPD formelle (DPIA) — art. 35 RGPD  
**Date :** 5 septembre 2026  
**Version :** 1.0 — dépôt git, **non signée**  
**Opérateur / responsable pour les traitements plateforme :** Baudouin Okito — France — `contact@somafrik.app`  
**Pour les données scolaires :** l’établissement est responsable ; Somafrik est sous-traitant.  
**Décision CTO du 5 septembre 2026 :** le screening seul **ne clôt pas** l’AIPD. Le présent document est l’analyse formelle à valider par le CTO avant GO final.  
**Pas de SIREN / société / adresse inventés.**

Le screening `aipd-screening.md` reste une **annexe de critères** ; il n’a pas valeur d’AIPD.

---

## 1. Pourquoi une AIPD

Le traitement est susceptible d’engendrer un risque élevé :

- données de **mineurs** et personnes vulnérables (élèves) ;
- **dimension multi-établissements** (même infrastructure, cloisonnement logique) ;
- dossier scolaire et, selon l’usage, pièces jointes pouvant contenir des données de santé ou autres données de l’art. 9 si l’établissement les y dépose ;
- incident Data API Supabase constaté le 4 septembre 2026 (surface théorique PostgREST, exploitation non prouvée dans git).

Une consultation CNIL préalable n’est pas déclenchée par ce seul document ; elle relèverait d’une décision CTO si les risques résiduels restaient élevés après mesures.

---

## 2. Description du traitement

### 2.1 Finalités

| Finalité | Base (indicative) | Responsable |
|---|---|---|
| Fournir le logiciel de gestion scolaire commandé par l’établissement | Contrat avec l’établissement (art. 6.1.b côté responsable) | Établissement (Somafrik sous-traitant) |
| Authentifier et sécuriser les accès | Intérêt légitime / contrat de service | Opérateur pour l’infra ; établissement pour les comptes école |
| Notifications push demandées | Intérêt légitime / consentement selon le canal | Établissement + opérateur (Expo) |
| Traces d’audit de sécurité | Intérêt légitime, obligation de sécurité | Opérateur + établissement selon accès |
| Comptes opérateurs, facturation d’abonnement | Contrat / intérêt légitime | Opérateur (responsable) |

### 2.2 Données et personnes

Personnes : élèves (souvent mineurs), représentants légaux, personnel scolaire, opérateurs plateforme.

Données : identité, identifiants, coordonnées, rôles, connexion/sécurité, scolarité (inscriptions, classes, présences, notes, bulletins), communications et PJ, paiements de scolarité, jetons push.

**Pas** de publicité, analytics SDK, SMS, WhatsApp ou e-mail transactionnel embarqués dans le backend actuel.

### 2.3 Destinataires et sous-traitants ultérieurs

Personnes habilitées de l’établissement ; API Somafrik ; **Render** (hébergement, origin GCP us-west1 / Oregon constaté le 5 septembre 2026) ; **Supabase** (PostgreSQL, région AWS = hostname du pooler live, hors secrets git) ; **Expo** (push, GCP États-Unis selon documentation prestataire). Détail : `sous-traitants-transferts.md`.

### 2.4 Conservation

Matrice `matrice-conservation.md` : pas de durée unique pour le dossier scolaire. Sessions / push purgés par job optionnel. Audit, scolaire, finance, sauvegardes hébergeur : **pas** d’auto-purge applicative.

### 2.5 Transferts hors EEE

Oui, du fait de Render (Oregon), Expo (États-Unis) et, selon la région AWS du projet, éventuellement Supabase. Mécanismes : DPA prestataires, SCC et/ou Data Privacy Framework. Preuves : `sous-traitants-transferts.md`.

---

## 3. Nécessité et proportionnalité

| Exigence | Mesure dans le produit |
|---|---|
| Minimisation | Pas de Data API cliente ; pas de dump `auditLog` au login plateforme ; Superadmin / Admin Pays **403** sur les données personnelles d’établissement |
| Durée | Jeton d’accès ≤ 15 min en production ; refresh rotatif ; conservation scolaire laissée à l’établissement |
| Droits | Page `/suppression-compte`, workflow `privacy_requests`, export établissement (403 plateforme) |
| Cloisonnement | `schoolCode` obligatoire et concret pour les listes d’effacement ; pas de `*` |
| Enfants | Comptes élèves gérés par l’établissement ; mot de passe / PIN interdits dans le support |

Le traitement multi-établissements est nécessaire au modèle SaaS ; le cloisonnement logique + deny plateforme est la mesure de substitution à des instances physiquement séparées (non fournies aujourd’hui).

---

## 4. Analyse des risques

Échelle : impact (1–4) × vraisemblance (1–4). Seuil d’attention : ≥ 8 avant mesures, ou impact 4.

| Scénario | Impact | Vrais. avant | Mesures | Vrais. après | Résiduel |
|---|---|---|---|---|---|
| Accès PostgREST `anon` aux tables `public` (incident 2026-09-04) | 4 | 4 | Lockdown Data API + boot + gate ; dashboard « disabled » **non prouvé** dans git | 2 | Élevé tant que la preuve dashboard / curl live n’est pas versée |
| Vol de jeton d’accès | 3 | 3 | TTL ≤ 15 min, Bearer only, HS256 + contrôle `alg`/`typ` | 2 | Modéré |
| Rejeu d’un refresh déjà rotaté | 4 | 3 | Rotation, hash, grâce 15 s **renvoyant le jeton courant chiffré**, reuse → révocation famille | 2 | Modéré |
| Admin plateforme lit le dossier d’un établissement | 4 | 3 | Deny HTTP avant scope école | 1 | Faible |
| Effacement qui détruit le dossier scolaire ou, à l’inverse, laisse le compte utilisable | 3 | 3 | Anonymisation compte + révocation ; dossier conservé ; statut `deleted` refuse login | 2 | Modéré (effacement partiel, assumé) |
| Restore d’un backup réintroduit un compte anonymisé | 3 | 2 | Procédure ops : réexécuter l’effacement ; **pas** de test de restore daté dans git | 2 | Modéré |
| PJ contenant des données de santé déposées par l’école | 4 | 2 | Types limités, pas d’URL anonyme ; **pas** de DLP contenu | 2 | Modéré |
| Transfert US (CLOUD Act) | 3 | 3 | DPA + SCC / DPF ; régions consignées | 2 | Modéré — inhérent aux prestataires US |
| Croisement inter-établissements | 4 | 2 | Isolation `school_id` / `schoolCode` | 1 | Faible |

**Risques résiduels non acceptables pour un GO AAB sans suite :** preuve Data API dashboard ; DPA **signés** ; restore testé ; région AWS Supabase extraite du hostname live collée au registre ; AIPD **signée CTO**.

---

## 5. Mesures prévues / déjà dans le code

P0-1 lockdown Data API ; P0-2 deny plateforme ; sessions P1 ; erasure partielle ; matrice de conservation différenciée ; pages publiques confidentialité et suppression ; pack `docs/compliance/`.

Mesures **hors code**, à la charge du CTO / ops : signer les DPA prestataires et établissement ; désactiver Data API dans le dashboard ; brancher un cron de purge **uniquement** sessions/push ; test de restore ; AIPD signée.

---

## 6. Avis

**Avis de l’analyste (Cursor, rôle DEV) :** l’AIPD est **requise** et **n’est pas close** par un screening. Les mesures techniques P0/P1 réduisent plusieurs scénarios. Les risques résiduels listés §4 s’opposent à un GO final (préprod prouvée, `main`, AAB, Play) tant qu’ils ne sont pas traités.

**Avis CTO :** case à remplir lors du contrôle — GO / NO GO / GO avec réserves.

| | |
|---|---|
| Date | |
| Nom | |
| Décision | **non signée** |

---

## 7. Révision

Réviser à chaque incident majeur, ajout de sous-traitant, ou avant GO AAB / Play Data Safety.
