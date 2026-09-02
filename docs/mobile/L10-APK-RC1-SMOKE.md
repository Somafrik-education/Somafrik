# L10 — Smoke APK RC1 (téléphone réel)

PR Draft uniquement. **Aucun `eas submit`. Aucun upload Google Play. Aucun merge Ready.**

Ce document est le protocole terrain de **L10**. Il ne rouvre pas le chantier métier.

Décision CTO L9 (2026-08-21) : **GO APK RC1**. Périmètre fonctionnel **figé**. Pas de nouveau chantier métier avant l’APK, sauf P0/P1 révélé par ce smoke.

Installation de l’APK : [PREVIEW-APK.md](./PREVIEW-APK.md).

## Contrat RC1

APK de **test terrain** : consultation canonique + writes pédagogiques / communication **déjà branchés**.

Ce n’est **pas** :

- la parité Web totale ;
- une release production ;
- un upload Play Store.

API obligatoire :

```text
https://somafrik-api-preprod.onrender.com
```

Identité APK :

| Champ | Valeur |
| ----- | ------ |
| Profil EAS | `preview` |
| Artefact | APK interne |
| Nom lanceur | **Somafrik** |
| Badge | **Preview QA** |
| Package | `com.somafrik.app` |
| Comptes | préproduction uniquement |

## Hors critères de blocage RC1

Ne pas marquer NO-GO si absent ou volontairement Web-only :

- NFC
- Mobile Money / saisie paiement Mobile
- GRANT / REVOKE Mobile
- création Élève / Classe / Paiement Mobile

## NO-GO immédiat

Un seul de ces faits **arrête** RC1 (P0/P1) :

| # | Fait |
| - | ---- |
| 1 | Crash / écran blanc non récupérable |
| 2 | Login impossible avec un compte préprod valide |
| 3 | Mauvaise cible API (production, localhost, LAN, HTTP) |
| 4 | 401 / 403 incohérent (droit live vs UI, ou session non invalidée) |
| 5 | Cross-tenant (données d’un autre établissement) |
| 6 | Faux succès d’écriture (toast/liste locale sans PostgreSQL, ou Web-only présenté comme écriture Mobile réussie) |
| 7 | Corruption de données |

Si un NO-GO est constaté : **stop terrain**, ticket P0/P1, pas de poursuite des parcours optionnels.

## Prérequis avant smoke téléphone

1. Humain : `eas login` dans `Mobile/` (cette VM Cloud n’a pas `EXPO_TOKEN`).
2. `eas whoami` puis `eas project:info` (projectId `47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5`).
3. `eas build --platform android --profile preview` — attendre **finished**.
4. Télécharger l’APK, **désinstaller** toute `com.somafrik.app` (Play / autre signature), installer l’APK Preview (**Somafrik**).
5. Confirmer le badge **Preview QA** et le texte login `API : https://somafrik-api-preprod.onrender.com/api`.

Interdit : `eas submit`, Play, PIN démo, comptes production.

## Rôles à tester

Trois comptes préprod **distincts**, même établissement (sauf le test cross-tenant) :

1. **Admin School**
2. **Directeur / Proviseur / Préfet**
3. **Enseignant**

Comptable, Parent, Élève : consultation utile si comptes existants, **pas** bloquants RC1. Surveillant : hors RC1.

## Parcours communs (chaque rôle)

Cocher uniquement après observation téléphone. `—` = non applicable au rôle.

| # | Contrôle | Admin School | Directeur / Préfet | Enseignant | NO-GO si |
| - | -------- | ------------ | ------------------ | ---------- | -------- |
| C1 | Lanceur **Somafrik**, badge **Preview QA** | | | | Nom ≠ Somafrik / pas de badge |
| C2 | Login préprod OK, session persistée, Home après `permissionsBootstrap ready` | | | | Login impossible / Home avant ready |
| C3 | Texte API = préprod HTTPS, pas `api.somafrik.app` | | | | Mauvaise préprod |
| C4 | Rôle / libellé cohérents avec le compte (pas de Super Admin fantôme) | | | | Identité reconstruite |
| C5 | Mise en arrière-plan puis retour : **un** refresh live, UI métier seulement si ready | | | | Écran métier pendant loading ; 401/403 sans logout |
| C6 | Listes cœur hydratées (classes, élèves, enseignants selon droit) — vide réel ≠ erreur | | | | Catalogue local / autre tenant |
| C7 | Messages : lecture, envoi si droit, pas de faux succès offline non mis en outbox | | | | Envoi « réussi » sans file ni API |
| C8 | Bulletins : liste + ouverture PDF si publié ; erreur explicite sinon | | | | Crash PDF / succès vide |
| C9 | Logout puis relogin | | | | Session zombie |

## Parcours métier par rôle

### Admin School

| # | Contrôle | Attendu | NO-GO |
| - | -------- | -------- | ----- |
| A1 | Utilisateurs / rôles en **lecture** | Données préprod | GRANT/REVOKE présentés comme réussis |
| A2 | Matières / affectations si droit | Write canonique `courses` / `assignments` uniquement | Autre CRUD Admin générique « enregistré » |
| A3 | Annonces | Lecture + archive si droit. **Nouvelle annonce** → écran fail-closed, **aucune** ligne créée | Toast succès sans API |
| A4 | Paiements | Historique. Saisie → « Saisie indisponible » / Web-only | Encaissement Mobile « OK » |
| A5 | Permissions | Lecture. Bannière GRANT/REVOKE Web | Matrice modifiée localement |

### Directeur / Proviseur / Préfet

| # | Contrôle | Attendu | NO-GO |
| - | -------- | -------- | ----- |
| D1 | Pilotage : Home, classes, élèves | Listes PostgreSQL du **même** établissement | Autre école |
| D2 | Appel (si `Présences:*`) | POST `/presences` réel ; outbox si offline puis sync | Présence locale jamais envoyée mais « OK » |
| D3 | Notes / évaluations (si droit) | POST/PATCH canoniques | Note inventée localement |
| D4 | Planning (si droit) | CRUD `/course-schedules` réel | Créneau cosmétique |
| D5 | Pas de création Élève / Classe Mobile | Fail-closed ou Web-only, pas de succès | Élève créé seulement dans l’app |

### Enseignant

| # | Contrôle | Attendu | NO-GO |
| - | -------- | -------- | ----- |
| T1 | Scope enseignant | Uniquement ses classes / matières | Données hors affectation |
| T2 | Appel | Saisie + sync préprod | Faux succès |
| T3 | Notes | Saisie + sync préprod | Faux succès |
| T4 | Messages | Lecture / envoi si droit | Faux succès |
| T5 | Pas de GRANT, pas d’encaissement, pas d’inscription | Actions absentes ou Web-only | Write réussi à tort |

## Réseau lent, reconnexion, outbox

Outbox Mobile : **messages, présences, notes** uniquement. Aucun enqueue UI paiements.

| # | Contrôle | Attendu | NO-GO |
| - | -------- | -------- | ----- |
| N1 | Mode avion puis listes | Erreur / offline explicite, pas de données fantômes | Catalogue de démo |
| N2 | Appel ou note ou message hors-ligne (si droit) | File outbox visible, pas de « enregistré définitif » | Succès PostgreSQL annoncé |
| N3 | Retour réseau | Flush **seulement** si `permissionsBootstrap === "ready"` | Write avec droits périmés |
| N4 | Réseau lent (2G / throttling) | Spinner / retry, pas de double POST silencieux | Doublon notes / présences |
| N5 | 401/403 mid-session (token retiré côté serveur si possible) | Session locale effacée, retour login | Métier qui continue |

## Web-only : jamais une écriture Mobile réussie

Chaque action ci-dessous doit être **absente**, **lecture seule**, ou **refus explicite** (alerte / fail-closed). Aucun toast « enregistré ».

| Action | Preuve UI attendue |
| ------ | ------------------ |
| NFC | Pas de parcours d’appel NFC |
| Mobile Money / saisie paiement | `Saisie indisponible` + copy Web établissement |
| GRANT / REVOKE | Bannière lecture seule / Web canonique |
| Création Élève / Classe | Fail-closed SafeAdminCrud ou pas d’entrée write |
| Nouvelle annonce | `admin-crud-fail-closed` — « aucune modification locale n’est appliquée » |
| Audit / Support MVP | Pas de journal réel / pas de ticket créé |

## Preuve à joindre (humain)

Pour chaque rôle, conserver :

- capture login (badge + `API : https://somafrik-api-preprod.onrender.com/api`) ;
- capture Home après foreground ;
- une liste hydratée ;
- un write pédagogique réussi **vérifié** (réapparaît après kill/relaunch, ou visible Web préprod) ;
- une action Web-only refusée explicitement ;
- outbox : item en file puis sync.

Ne pas coller dans une PR publique une URL d’artifact EAS authentifiée par cookie.

## Verdict L10

| État | Signification |
| ---- | ------------- |
| `BLOCKED_EAS_AUTH` | Pas de login Expo dans l’environnement → pas d’APK. Action humaine. |
| `BLOCKED_NO_DEVICE` | APK non installée / pas de téléphone. |
| `NO-GO` | Un critère de la section NO-GO. |
| `GO TERRAIN RC1` | Les trois rôles passent C1–C9 + parcours rôle + N1–N5 + Web-only refusés. |

Le vert CI (`verify:mobile-preview-apk`) **n’est pas** un GO terrain.
