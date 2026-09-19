# GO Production — Contrat CTO / Cursor / GitHub

**Statut :** contrat opérationnel officiel  
**Chantier maître :** [#720](https://github.com/Somafrik-education/Somafrik/issues/720)  
**Qualification RC1 :** [#719](https://github.com/Somafrik-education/Somafrik/issues/719) (phase G1)  
**Baseline gelée :** `develop@afa01321a42df3cfe825a789fc1a948ea0bf1e4c`  
**Dernière mise à jour :** 2026-09-19 (sync CTO `#5744979652` / `#5744980024`)  
**Décision associée :** [ADR-015](./DECISIONS.md#adr-015--chatgpt-cto--cursor-développeur--github-pont-unique)

Les conversations (chat Cursor, e-mail, réunions) **ne remplacent pas** ce contrat.  
Aucune décision de merge, de Ready ou de GO ne repose uniquement sur un compte-rendu d’agent.

---

## 1. Rôles

### ChatGPT — CTO

ChatGPT pilote le chantier de bout en bout :

- définit les lots, le périmètre, les interdictions et les critères PASS / FAIL ;
- contrôle les résultats Cursor par **diff GitHub indépendant** (issue + PR + SHA, jamais le seul récit agent) ;
- décide **HOLD** / **GO READY** / **MERGE** / **GO PRODUCTION** ;
- vérifie l’anti-dérive après Ready (`develop` bougé, HEAD changé) ;
- fusionne uniquement le **HEAD exact audité** ;
- vérifie le merge commit, ses parents et le tip `develop` après coup ;
- produit le rapport final GO / NO-GO.

### Cursor — développeur / QA exécutant

Cursor :

- travaille uniquement dans le périmètre du **mandat CTO** publié sur GitHub ;
- exécute tests, corrections et preuves ;
- ouvre les PR en **Draft** ;
- publie HEAD, base, ahead/behind, diffstat, commandes et résultats ;
- **STOP** avant Ready / Merge ;
- ne fusionne rien ;
- ne touche pas production, Render, EAS, Firebase, DNS ou secrets sans mandat CTO explicite.

### GitHub — pont de communication unique

Toute communication opérationnelle ChatGPT ↔ Cursor passe par GitHub :

| Surface | Rôle |
|---------|------|
| Issues | mandats, backlog, décisions, HOLD / GO |
| Pull Requests | exécution, preuves, STOP |
| Commentaires de revue | contrôles CTO, corrections demandées, GO |
| Actions | preuves CI sur le HEAD exact |
| Commits / SHAs | références contractuelles |

Le chat Cursor n’est qu’un canal d’exécution. Il n’est **pas** le registre des décisions.

---

## 2. Communication obligatoire

### Cursor → CTO (chaque livraison)

Publier dans le **corps de la PR** (et, si possible, un commentaire sur l’issue du lot) :

```text
PR : #<n>
Base : develop@<sha>
HEAD : <sha>
Ahead / behind : <n> / <n>
Diffstat : <fichiers, +/−>
Fichiers runtime : <liste ou « aucun — docs only »>
Tests exécutés : <commandes + résultat>
CI : <état sur ce HEAD>
P0 / P1 / P2 / P3 : <comptes>
Preuves : <chemins docs/audits ou Actions>
Non testé : <liste honnête>
Décision Cursor : STOP — pas Ready, pas merge
```

### CTO → Cursor (chaque mandat)

Publier sur l’**issue du lot** (ou commentaire de revue) :

```text
MANDAT CTO — <id lot>
Base obligatoire : develop@<sha> (ou HEAD develop du jour, à rapporter)
Périmètre : …
Interdictions : …
Critères PASS / FAIL : …
Livrable : 1 PR Draft vers develop
Après ouverture : STOP pour diff indépendant
```

Un lot suivant n’est ouvert **qu’après** contrôle du lot précédent.

---

## 3. Phases

| Phase | Issue | Objectif | État |
|-------|-------|----------|------|
| **G0** Freeze & baseline | #720 | Geler `develop`, figer ce contrat, inventorier les PR hors release | **cette PR** — HOLD doc-sync |
| **G1** RC1 qualification | #719 | E2E métier + fonctionnel + performance + sécurité | **Livrée #722 — HOLD** ; #717 **CLOSED** ; P0 restant #645 |
| **G2** Release Candidate | à ouvrir | Version/tag RC, builds Web / backend / Android / iOS, smoke artefacts | **INTERDITE** tant que P0/P1 RC1 ≠ 0 |
| **G3** Préproduction intégrale | à ouvrir | Recette rôles + workflows sur préprod, même PostgreSQL Web ↔ Mobile | HOLD |
| **G4** Stores & conformité | à ouvrir | Play Closed Testing + Apple / privacy / account deletion | HOLD |
| **G5** Backend / DB / sécurité prod | à ouvrir | Backup, restore, migrations, secrets, CORS, rollback — **aucun write prod** | HOLD |
| **G6** GO / NO-GO | à ouvrir | Rapport + SHAs + build IDs + risques résiduels | HOLD |
| **G7** Production | à ouvrir | Uniquement après commentaire CTO **GO PRODUCTION** | HOLD |

**Aucune G8 n’existe.** Le chantier **s’arrête strictement à G7** (preuve post-déploiement). Ouvrir une G8 est hors contrat.

Les issues historiques **#427** (control plane GP-00x) et **#481** (G6 Render d’un cycle antérieur) **ne sont pas** les phases G0–G7 de ce chantier. Ne pas les réouvrir implicitement.

---

## 4. G0 — Freeze

À partir de `develop@afa01321a42df3cfe825a789fc1a948ea0bf1e4c` :

1. `develop` est **gelé fonctionnellement**.
2. Aucune nouvelle fonctionnalité.
3. Seules sont autorisées, **sur mandat CTO** : corrections RC1, conformité, sécurité, release.
4. Une seule PR Cursor **GO Production active** à la fois (sauf instruction CTO contraire sur l’issue).
5. Les PR Draft déjà ouvertes (démo, parité historique, RC3, push, etc.) restent **hors freeze** : pas de merge opportuniste.
6. #704 reste historique et fermé. Les asymétries Web ↔ Mobile clôturées ne se rouvrent pas sans nouveau mandat produit.
7. Aucune PR `develop → main` sans USER GO + commentaire CTO.

Preuve G0 : [../audits/go-production-g0-baseline-2026-09-19.md](../audits/go-production-g0-baseline-2026-09-19.md).

---

## 5. G1 — RC1 (rappel)

Référence normative : **#719**. Branche prévue : `cursor/release-rc1-readiness`.

Gates :

- E2E métier critique = PASS
- suites fonctionnelles du périmètre = PASS
- performance mesurée (préprod / isolé **uniquement**, jamais la production)
- sécurité défensive = PASS
- P0 ouverts = 0
- P1 ouverts = 0
- CI du HEAD = GREEN
- rapport versionné `docs/release/RC1-READINESS-REPORT.md`

G1 a été **exécutée** dans [#722](https://github.com/Somafrik-education/Somafrik/pull/722) (`docs/release/RC1-READINESS-REPORT.md`, HEAD `9e59c92c988ee1c43f63bf27ea67df482bbf2f65`).  
**CTO : HOLD confirmé.** #717 **CLOSED**. P0 restant **#645** ; P1 **#646** / **#503** empêchent G2.

Cette PR G0 **ne rejoue pas** G1 ; elle enregistre seulement l’état.

---

## 6. G7 — Production (rappel)

Uniquement après commentaire CTO explicite `GO PRODUCTION`, dans cet ordre :

1. backup final
2. backend / database si nécessaire
3. Web
4. Mobile stores / publication
5. smoke production **non destructif**
6. monitoring renforcé
7. preuve post-déploiement

L’agent Cursor **n’exécute jamais** G7 sans ce commentaire.

Après G7 + preuve post-déploiement : **fin du chantier**. **Pas de G8.**

---

## 7. Règles absolues

1. Aucun merge sans diff GitHub indépendant ChatGPT CTO.
2. Toute PR Cursor démarre Draft.
3. HEAD changé après audit = nouvel audit.
4. `develop` changé avant merge = anti-dérive / revalidation.
5. P0 / P1 = HOLD.
6. Pas de feature opportuniste pendant le freeze.
7. Pas de migration ou modification prod implicite.
8. Pas de secret dans commits, logs ou commentaires.
9. Pas de test de charge sur la production.
10. #704 reste historique et fermé.
11. Les asymétries Web / Mobile clôturées ne sont pas rouvertes sans nouveau mandat produit.
12. Le chantier ne se termine qu’après preuve post-déploiement **de G7**.
13. **Aucune G8.** Arrêt strict à G7.

---

## 8. Documents liés

| Document | Rôle |
|----------|------|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Git flow + revue CTO + pont GitHub |
| [DECISIONS.md](./DECISIONS.md) | ADR-001 (flux) et ADR-015 (rôles) |
| [RELEASES.md](./RELEASES.md) | Plan de versions ; HOLD courant |
| [TESTING.md](./TESTING.md) | Pyramide et gates |
| [../audits/release-governance-goprod-2026-09-01.md](../audits/release-governance-goprod-2026-09-01.md) | Gouvernance release **historique** (freeze 2026-09-01 levé) |
| [../audits/web-mobile-parity-final-2026-09-19.md](../audits/web-mobile-parity-final-2026-09-19.md) | Parité Web ↔ Mobile CLOSED GLOBAL |
