# RC1 — Requalification tickets ouverts — 2026-09-19

**Mandat :** [#719](https://github.com/Somafrik-education/Somafrik/issues/719) · commentaire CTO [#720 `#5744875678`](https://github.com/Somafrik-education/Somafrik/issues/720#issuecomment-5744875678)  
**Baseline :** `develop@afa01321a42df3cfe825a789fc1a948ea0bf1e4c`  
**Règle :** un ticket ouvert n’est pas une preuve de reproductibilité. RC1 vérifie le **code actuel**.

| ID | Ticket | Verdict baseline | Sévérité RC1 | Preuve |
|----|--------|------------------|--------------|--------|
| RQ-717 | PR #717 HelpHost startup crash | **STILL_OPEN** | **P0** | `Mobile/src/help/HelpHost.tsx` appelle `useNavigation` / `useNavigationState` ; `AppNavigator.tsx` rend `<HelpHost />` hors `Stack.Navigator`. Correctif uniquement sur la PR Draft #717 (CI rouge, base antérieure). |
| RQ-645 | #645 Mobile Push préprod | **NEEDS_RUNTIME** | **P0** | Pipeline code présent (`pushNotifications.ts`, `POST /mobile/push-devices`, preview accepté en préprod). Enregistrement mobile avale les erreurs (`.catch(() => undefined)`). Aucune preuve device / FCM / EAS sur cette baseline. PR #647 Draft non mergée. |
| RQ-646 | #646 Web Push navigateur | **STILL_OPEN** | **P1** | `scripts/lot6-parity.test.ts` affirme l’absence `PushManager` / `VAPID` / `web-push`. Routes push = mobile only. PR #648 Draft non mergée. |
| RQ-499 | #499 storage Android AAB | **FIXED_ON_BASELINE** (source) / **NEEDS_RUNTIME** (AAB) | **P2** | `blockedPermissions` + plugin `tools:node="remove"` + gates readiness. #500 mergée. Issue GitHub encore ouverte. Manifeste AAB EAS non réinspecté ici. |
| RQ-503 | #503 RGPD / AAB conforme | **STILL_OPEN** (umbrella) / code P0 **FIXED_ON_BASELINE** | **P1** | Lockdown Data API + deny plateforme + routes `/confidentialite` `/suppression-compte` dans le tree. Preuve HTTP préprod live et AAB store **non rejouées**. |
| RQ-510 | #510 dette Expo / RN | **STILL_OPEN** | **P3** | `npm audit` Mobile : 20 vulns (16 high / 4 moderate) sur la chaîne Expo. Pas d’exploit runtime prouvé dans ce lot. |

## Conséquence gate RC1

- P0 ouverts **≠ 0** (#717 certain sur le tree ; #645 non levé sans runtime).
- P1 ouverts **≠ 0** (#646 certain ; #503 preuve live manquante).

**RC1 ne peut pas être PASS** sur cette observation.
