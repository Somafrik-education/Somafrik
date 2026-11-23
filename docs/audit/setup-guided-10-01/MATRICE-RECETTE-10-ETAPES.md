# AUDIT-SETUP-GUIDED-10-01 — Matrice finale de recette (10 étapes, Web + Mobile)

## PR concernées

Toutes sont en Draft / HOLD vers `develop`.

| PR | Objet | HEAD |
|---|---|---|
| [#1174](https://github.com/Somafrik-education/Somafrik/pull/1174) | Backend, Web et Mobile : A1 à A5, caractérisation C01 à C06, O3 | `12c0c427` |
| [#1175](https://github.com/Somafrik-education/Somafrik/pull/1175) | A6 : écran Mobile natif des règles de notification (étape 9) | `0867e9f7` |
| [#1176](https://github.com/Somafrik-education/Somafrik/pull/1176) | A7 : erreurs de chargement de l'assistant Mobile | `6127b3fd` |

La matrice suppose les trois PR intégrées.

**Légende :**
- **Auto :** prouvé par un test automatisé. La référence renvoie au test. « PG » désigne un test sur PostgreSQL 16 réel.
- **Code :** vérifié sur les sources et par les tests de contrat. Il n'y a pas eu d'exécution sur un appareil.
- **Smoke :** recette manuelle en préproduction. **Non réalisée**, voir §3.

## 1. Conditions et preuves par étape

| # | Étape | Condition (Backend, identique Web et Mobile) | Non satisfaite → satisfaite | Invalidation après coup | Écran de correction Web / Mobile | Web | Mobile | Smoke |
|---|---|---|---|---|---|---|---|---|
| 1 | Informations établissement | Nom, pays, adresse, téléphone, devise (lecture identique à l'API Profil) | Auto : PG-01, PG-02, PG-03, U-01 à U-03 | Auto : U-01 (champ vidé, étape refusée) | `/parametres/profil` / `EstablishmentProfile` | Auto : Profil, adresse obligatoire, devise visible (`EstablishmentProfilePage.audit10`) | Code : lien et message serveur affiché | NV |
| 2 | Année scolaire | Année courante ou ouverte, avec dates de début et de fin | Auto : B5, B13 | Auto : B4b | `/parametres/annee-scolaire` / `SchoolYearSettings` | Code | Code | NV |
| 3 | Structure pédagogique | ≥ 1 niveau actif, ≥ 1 groupe actif, ≥ 1 classe **active** de l'année courante ou ouverte | Auto : PG-00, PG-ISO | Auto : **PG-C05** (classe inactive) | `/parametres/structure` / `SchoolPedagogicalStructure` | Code | Code | NV |
| 4 | Matières | ≥ 1 matière **active** | Auto : PG-00 | Auto : **PG-04** | `/parametres/structure` / `SchoolPedagogicalStructure` | Code | Code | NV |
| 5 | Enseignants | ≥ 1 enseignant actif, et ≥ 1 affectation active sur une classe et une matière **actives du même établissement** | Auto : PG-00, B11 | Auto : **PG-05, PG-C01, PG-C02, PG-C03** | `/etablissement/enseignants` / `Teachers` | Code | Code | NV |
| 6 | Élèves | ≥ 1 inscription `active` ou `enrolled`, dans une classe **active du même établissement** | Auto : PG-00, PG-06b, B12 | Auto : **PG-06, PG-C04, PG-C06** | `/etablissement/classes` / `Classes` | Code | Code | NV |
| 7 | Finance | ≥ 1 grille de frais **ou** ≥ 1 mode de paiement actif (O2 : règle inchangée) | Auto : PG-00 | — (règle O2) | `/finances/frais` / `FeeGrids` | Code | Code | NV |
| 8 | Paramètres pédagogiques | ≥ 1 type d'évaluation **actif** | Auto : PG-00 | Auto : **PG-08** | **`/parametres/annee-scolaire`** / **`SchoolYearSettings`** (A4) | Auto : W-AUDIT10-08 | Auto : M-AUDIT10-08 | NV |
| 9 | Communication | ≥ 1 règle enregistrée | Auto : postsmoke #1171 | — | `/parametres/notifications` / **`SchoolNotificationSettings`** (A6, #1175) | Auto : postsmoke #1171 | Auto : A6-01 à A6-07 | NV |
| 10 | Utilisateurs et droits | ≥ 1 compte **actif** de l'établissement (O1 : pas de second compte exigé) | Auto : PG-00 | Auto : **PG-10** | `/etablissement/comptes-utilisateurs` / `Users` | Code | Code | NV |

## 2. Mécanismes transverses

| Mécanisme | Web | Mobile | Preuve |
|---|---|---|---|
| Progression = préfixe des étapes persistées et satisfaites, recalculé sur les données | Oui | Oui | B4, B4b, B13, B14, B15 |
| `operational` après les étapes 1 à 6 ; distinct de l'indicateur 3/3 du LOT 0 (inchangé) | Oui | Oui | B6, B7 ; `schoolSetupStatus.js` non modifié |
| Message précis d'une étape refusée (champ manquant, étape précédente nommée) | Oui | Oui (message serveur) | U-01 à U-05 |
| Reprise après reconnexion, réévaluation au retour d'un écran | Oui (relecture au montage) | Oui (`useFocusEffect`) | B3, U-03 |
| Finalisée historiquement ≠ conforme aujourd'hui (O3) | Oui | Oui | W-O3-1, W-O3-2, M-O3 |
| Erreur de chargement visible, sans repli silencieux sur le 3/3 | Oui | **Oui (A7, #1176)** | M-A7 |
| RBAC : écriture réservée à `Paramètres Établissement:UPDATE` ; tenant issu de `users.school_id` | Oui | Oui | B8, B9, A6-01 |
| Isolation entre établissements | Oui | Oui | PG-ISO, B8 |
| Revalidation idempotente, sans doublon | Oui | Oui | B10 |
| Erreurs HTTP non masquées (400, 403, 409, 503) | Oui | Oui | B5, B9, U-04 |

## 3. Smoke préproduction : non réalisé, bloqué

| Prérequis | État |
|---|---|
| Accès réseau à `api-preprod.somafrik.app` et `preprod.somafrik.app` depuis ce conteneur | **Refusé** par la politique réseau de l'environnement (proxy 403) |
| Comptes de test en préproduction (Admin School, rôle en lecture seule, second établissement) | Non fournis |
| Build des 3 PR déployé en préproduction (`develop`) | Non : les PR sont en Draft / HOLD, sans merge |
| Application Mobile native installable (APK de préproduction) | Non disponible ici (aucun appareil ni émulateur) |

**Scénario prêt à exécuter**, une fois les prérequis réunis. Pour chaque étape, Web puis Mobile :

1. Partir d'un établissement de test neuf. L'étape est refusée, avec un message précis.
2. Ouvrir l'écran de correction depuis l'assistant, puis créer la donnée exigée.
3. Revenir, puis « Enregistrer et continuer ». L'étape passe, la progression augmente de 10 %.
4. Fermer, puis rouvrir ou se reconnecter. La progression est conservée.
5. Archiver ou désactiver la donnée. L'étape redevient non faite.
6. Avec un rôle en lecture seule, l'écriture est refusée (403) et les interrupteurs sont désactivés.
7. Second établissement : aucune donnée partagée.
8. Établissement finalisé puis invalidé : l'alerte « n'est plus conforme aujourd'hui » s'affiche.

Pour chaque étape, consigner :
- les captures avant et après ;
- la réponse API ;
- le SHA déployé.

**Établissement `SCH-861371F01E094E9E8970` (production) :** la requête de lecture seule du rapport (§2) est à exécuter **uniquement** sur GO CTO explicite.
