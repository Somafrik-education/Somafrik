# Contrat métier — Préinscription publique (site vitrine)

> Document de préparation C1.2. **Aucune route publique n’est exposée** dans cette itération.

## Objectif

Décrire le futur flux permettant à une famille de déposer une demande de préinscription depuis le site vitrine, sans jamais accéder aux capacités administratives de l’ERP Somafrik.

## Flux cible

```
Site vitrine
    │
    ▼
Demande de préinscription (endpoint public dédié)
    │
    ▼
Contrôle administratif dans Somafrik
    │
    ▼
Validation
    │
    ▼
Création ou activation de l’inscription scolaire
```

## Propriétaire du futur endpoint

| Élément | Responsable |
|---------|-------------|
| Endpoint public | Backend API Somafrik (surface publique isolée) |
| Validation métier / conversion | Back-office établissement (module Élèves / Inscription) |
| Site vitrine | Client public (formulaire) — **aucun droit ERP** |

Le site vitrine ne doit **jamais** :

- appeler les routes administratives de l’ERP ;
- attribuer un matricule officiel ;
- affecter une classe ;
- marquer une inscription comme validée ;
- transmettre des permissions administratives au navigateur.

## Payload proposé

```ts
interface PublicPreEnrollmentRequest {
  schoolCode: string;
  academicYear: string;
  requestedLevelId: string | null;

  student: {
    firstName: string;
    lastName: string;
    birthDate: string | null; // YYYY-MM-DD
    gender: string | null;
  };

  guardian: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    relationshipType: string;
  };

  consent: {
    privacyPolicyAccepted: boolean;
    acceptedAt: string; // ISO-8601
  };
}
```

## Champs obligatoires

- `schoolCode`
- `academicYear`
- `student.firstName`, `student.lastName`
- `guardian.firstName`, `guardian.lastName`, `guardian.phone`, `guardian.relationshipType`
- `consent.privacyPolicyAccepted === true`
- `consent.acceptedAt`

## Validation attendue

- Formats civil pour `birthDate` (`YYYY-MM-DD`) sans décalage de fuseau.
- Téléphone / e-mail normalisés.
- Année scolaire reconnue par l’établissement.
- Niveau demandé optionnel (`requestedLevelId`).

## Consentement

- Refus si `privacyPolicyAccepted` est faux.
- Horodatage `acceptedAt` conservé pour audit.

## Antispam / limitation de débit

- CAPTCHA ou équivalent côté endpoint public (hors C1.2).
- Rate-limiting par IP / empreinte.
- Rejet des soumissions répétées abusives.

## Idempotence

- Clé d’idempotence recommandée : hash (`schoolCode` + année + identité élève + téléphone responsable + jour UTC).
- Relance du même formulaire → même référence publique, pas de doublon métier.

## Référence publique

- Format indicatif : `PRE-2027-000184`
- Cette référence technique n’est **pas** un matricule officiel.
- Stockée sur l’inscription via `applicationReference` + `source = PUBLIC_WEBSITE`.

## Conversion administrative

1. Statut initial : `PRE_REGISTERED`
2. Examen : `PENDING_REVIEW` / `INCOMPLETE`
3. Acceptation : `APPROVED`
4. Finalisation : `ENROLLED` (+ affectation de classe)
5. Refus : `REJECTED`

Le matricule officiel n’est attribué qu’au moment décidé par l’établissement.

## Lien avec C1.2

C1.2 prépare uniquement :

- les statuts canoniques ;
- les sources (`PUBLIC_WEBSITE`, …) ;
- les dates métier ;
- l’affichage lecture de la référence publique dans le dossier élève.

Aucune mutation ni endpoint public n’est livré dans C1.2.
