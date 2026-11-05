#!/usr/bin/env bash
# SEC-PDF-02 — CI GitHub uniquement (runner Ubuntu 24.04 jetable).
#
# La sandbox Chromium exige des espaces de noms utilisateur non privilégiés,
# qu'Ubuntu 24.04 restreint par AppArmor. Plutôt que de lever cette
# restriction pour tout le runner, on charge un profil AppArmor dédié qui
# accorde `userns` au seul binaire Chromium de Puppeteer (méthode recommandée
# par Ubuntu pour les navigateurs). La restriction globale reste active : le
# script vérifie que la restriction globale vaut toujours 1.
set -euo pipefail

RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ ! -f "$RESTRICT" ] || [ "$(cat "$RESTRICT")" != "1" ]; then
  echo "Restriction AppArmor des espaces de noms absente : aucun profil nécessaire."
  exit 0
fi

if [ -n "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
  CHROME="$PUPPETEER_EXECUTABLE_PATH"
else
  CHROME="$(cd backend && node -e '(async () => console.log(await require("puppeteer").executablePath()))()')"
fi
CHROME="$(realpath "$CHROME")"
test -x "$CHROME"
echo "Binaire Chromium : $CHROME"

PROFILE=/etc/apparmor.d/somafrik-ci-chromium
sudo tee "$PROFILE" > /dev/null <<PROFILE_EOF
abi <abi/4.0>,
include <tunables/global>

profile somafrik-ci-chromium "$CHROME" flags=(unconfined) {
  userns,
}
PROFILE_EOF
sudo apparmor_parser -r "$PROFILE"

echo "Restriction globale : $(cat "$RESTRICT") (doit rester 1)"
test "$(cat "$RESTRICT")" = "1"
# Information : un programme sans profil dédié reste soumis à la restriction.
if unshare -U -r true 2>/dev/null; then
  echo "Information : unshare -U -r réussit (comportement du noyau sous restriction)."
else
  echo "Information : unshare -U -r refusé hors profil dédié."
fi
