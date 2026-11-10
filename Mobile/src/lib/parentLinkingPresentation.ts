/**
 * Retour de liaison parent : création d'un compte + GRANT PARENT transactionnels
 * dans l'API PostgreSQL. Les secrets sont montrés une seule fois, jamais loggés
 * ni enregistrés dans AsyncStorage, SecureStore ou un store applicatif.
 */
type ParentLinkFeedback = { title: string; message: string };

function nonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parentLinkSuccessFeedback(payload: unknown): ParentLinkFeedback {
  const row = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const user = row.user && typeof row.user === "object"
    ? row.user as Record<string, unknown>
    : {};
  const created = row.createdUser === true;
  if (created) {
    const identifier = nonEmptyString(user.identifier)
      || nonEmptyString(user.userCode)
      || nonEmptyString(user.loginCode);
    const secret = nonEmptyString(row.temporaryPassword);
    if (!identifier || !secret) {
      return {
        title: "Parent lié — accès à vérifier",
        message: "Le compte a été créé mais les identifiants ne sont pas disponibles dans la réponse. Ne remettez pas d'accès provisoire ; demandez une réinitialisation sécurisée.",
      };
    }
    return {
      title: "Accès parent créés",
      message: `Identifiant : ${identifier}\nMot de passe temporaire : ${secret}\n\nÀ remettre en privé au parent. Notez-les maintenant : ce mot de passe ne sera pas réaffiché.`,
    };
  }
  return {
    title: row.created === false ? "Parent déjà lié" : "Parent lié",
    message: "Le compte existant a été réutilisé. Aucun nouveau mot de passe n'a été généré.",
  };
}
