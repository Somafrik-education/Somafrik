# CARTE-CLÔTURE-01 — procès-verbal de clôture administrative du chantier Carte Élève

**Date :** 24 octobre 2026  
**Base :** `develop` — Somafrik V2  
**Nature :** documentaire, sans changement produit, base, RBAC ou infrastructure  
**Verdict :** fonctionnalités Carte Élève validées en préproduction **sur les parcours rapportés** ; réserves administratives et de promotion listées ci-dessous.  
**Gouvernance :** ce procès-verbal ne vaut ni promotion `develop → main`, ni autorisation de déploiement production.

## 1. Historique GitHub — fusions confirmées

| PR | Chantier | Commit squash sur `develop` |
| --- | --- | --- |
| [#982](https://github.com/Somafrik-education/Somafrik/pull/982) | Précontrôle en lecture seule par classe (API-01) | `a7b10cd4e1439a0468ee37ff536da453a33af523` |
| [#984](https://github.com/Somafrik-education/Somafrik/pull/984) | Préparation, réception et activation sécurisées (API-02) | `53510ca416d72f5d562b62420349daafc212ffc1` |
| [#986](https://github.com/Somafrik-education/Somafrik/pull/986) | Parcours Web, sauvegarde CR80 (WEB-01) | `3a3fc8731a9ce0aa0a2eaa51849828a8111c4b94` |
| [#988](https://github.com/Somafrik-education/Somafrik/pull/988) | Export PDF A4 hors ligne (PDF-02) | `d6b29e9cbdc4884dce1cb971821eccc7451b4c1c` |
| [#989](https://github.com/Somafrik-education/Somafrik/pull/989) | Maquette P1 unique : individuel, CR80, PDF | `0d586a98a45762e2d3ff3bb00925f80a1885c672` |
| [#990](https://github.com/Somafrik-education/Somafrik/pull/990) | Chargement des URL de photographies | `69cadf2434ef9b84b5f8924efee60e55ad9ed59d` |
| [#991](https://github.com/Somafrik-education/Somafrik/pull/991) | Photo canonique depuis les pièces administratives PHOTO | `a0edc64a67f4f1fc73edbbf456b2f3295d82fd11` |

Les sept PR ci-dessus ont été revérifiées comme **merged** sur GitHub avant rédaction de ce PV.

## 2. Acceptation fonctionnelle rapportée — préproduction

| Parcours | Conclusion | Nature de la preuve |
| --- | --- | --- |
| Carte individuelle, maquette P1, identité et photo | PASS | Captures navigateur et validation utilisateur du 24/10/2026 |
| Impression individuelle CR80 | PASS | Confirmation utilisateur « impression OK » |
| Lot classe, document CR80 sauvegardé et conversion hors connexion | PASS | Smoke navigateur rapporté et PDF transmis |
| PDF A4 classe (2 × 4 sur la page examinée) | PASS | PDF transmis, inspection du rendu |
| Lecture QR imprimé | PASS **déclaré par l'utilisateur** | Pas de journal de scan indépendant joint au PV |
| Association NFC NTAG213 à une carte active | PASS **déclaré par l'utilisateur** | Pas de relevé HTTP/PG indépendant joint au PV |
| Non-réémission / non-mutation des cartes existantes | PASS **rapporté lors des tests** | Suites de tests et rapports de smoke précédents ; pas de nouvel état PG capturé pour ce PV |

Ne pas interpréter ces PASS comme une certification de l'intégralité des appareils, imprimantes ou scénarios réels. Le document atteste les parcours observés ou déclarés, et conserve leur provenance.

## 3. Incident photographie et résolution

- Symptôme initial : initiales à la place de la photo sur carte individuelle.
- Cause de code : `students.photo_url` restait vide alors que les photos étaient déposées comme pièces `PHOTO` dans `student_documents` et le stockage privé ; correction #991.
- Diagnostic préproduction du dossier de test : réponse HTTP `404 STUDENT_PHOTO_ABSENT`. L'audit SQL partagé montrait une pièce de type `PHOTO` au statut `archived`, source `administrative_upload`, même établissement, avec clé de stockage.
- Une autre image JPEG avait été déposée sous le type `BIRTH_CERTIFICATE` (« Acte de naissance ») et vérifiée : elle ne constituait pas une pièce PHOTO admissible.
- La capture ultérieure montre effectivement une photographie sur la carte individuelle ; le smoke photo individuel est donc PASS après correction des données de test.
- Le fait que l'ancienne pièce PHOTO soit archivée **ne démontre pas qui l'a archivée ni pourquoi**. Ne pas requalifier une action « Vérifier » en archivage sans preuve technique.

## 4. Réserves ouvertes et suivi distinct

1. **AUDIT-DOC-ARCHIVE-01 — Archivage de l'ancienne pièce PHOTO : OUVERT.** Lire seulement les métadonnées temporelles (`created_at`, `updated_at`, `metadata.archivedAt`, `metadata.verifiedAt`) et les éventuels événements d'audit, avec contrôle d'accès ; vérifier les actions/identifiants de document sans diffuser les données personnelles. Ne pas changer les statuts pour « réparer » l'historique.
2. **Promotion production : NON AUTORISÉE par ce PV.** Avant une éventuelle PR `develop → main` : diff GitHub indépendant sur le HEAD réel, inventaire des changements hors cartes, CI complète, gates et décision CTO explicite.
3. **Preuves QR/NFC :** les scénarios ont été déclarés PASS ; archiver si disponibles les journaux de test minimisés (sans jetons, secrets, photos ni informations identifiantes).

## 5. Sécurité et limites

- Respecter l'isolation établissement, le RBAC (dont `Documents:READ`) et le principe fail-closed.
- Aucune réémission, révocation ou modification de QR/NFC requise pour corriger l'image d'une carte existante.
- Les HTML CR80 et PDF A4 contenant des QR opérationnels doivent être traités comme des documents sensibles, conservés dans un espace privé.
- Aucune suppression ou restauration de données dans le cadre de la clôture administrative.

## 6. Décision de clôture

**Chantier fonctionnel Carte Élève : CLOS pour les parcours préproduction testés et confirmés.**  
**Anomalie d'archivage historique : OUVERTE, en investigation séparée.**  
**Production : HOLD jusqu'à un ordre de promotion distinct.**  
**Ce PV entre dans `develop` uniquement après validation de sa propre PR documentaire, contrôles GitHub et revue indépendante ; aucune fusion automatique.**
