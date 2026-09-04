import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { API_URL } from "../lib/apiUrl";

const CONTACT_EMAIL = "contact@somafrik.app";
const OPERATOR_NAME = "Baudouin Okito";
const OPERATOR_COUNTRY = "France";
const DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Demande de suppression de compte Somafrik")}`;
const CNIL_URL = "https://www.cnil.fr/fr/plaintes";

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="Retour à l’accueil Somafrik"><BrandLogo size="md" /></Link>
          <Link to="/connexion" className="font-semibold text-blue-700 hover:underline">Se connecter</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-10">
        <article className="rounded-2xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-extrabold text-slate-950">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : 4 septembre 2026</p>
          <div className="mt-8 space-y-7 leading-7 text-slate-700">{children}</div>
        </article>
      </main>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <section>
        <h2 className="text-xl font-bold text-slate-950">Identité de l’opérateur</h2>
        <p>
          L’opérateur actuel de la plateforme Somafrik est <strong>{OPERATOR_NAME}</strong> ({OPERATOR_COUNTRY}).
          Contact : <a className="text-blue-700 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          Aucune société, SIREN ou adresse postale n’est publiée ici au-delà de ces éléments.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Rôles responsable / sous-traitant</h2>
        <p>
          Pour les données scolaires saisies par un établissement (élèves, familles, notes, présences, paiements, documents),
          l’établissement est <strong>responsable de traitement</strong>. Somafrik agit alors en <strong>sous-traitant</strong>
          (art. 28 RGPD) pour fournir le logiciel. Pour les comptes opérateurs, journaux techniques, facturation d’abonnement
          plateforme et sécurité de l’infrastructure, {OPERATOR_NAME} est responsable de traitement.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Données traitées</h2>
        <p>
          Selon votre rôle : identité, coordonnées, établissement, rôles, données de connexion et de sécurité,
          inscriptions, classes, présences, évaluations, bulletins, documents, communications, pièces jointes
          et paiements enregistrés par l’établissement. Les jetons d’accès et de rafraîchissement ne sont jamais
          renvoyés dans les fiches utilisateur.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Finalités et bases légales</h2>
        <p>
          Authentifier les utilisateurs et sécuriser les accès (intérêt légitime / exécution du contrat de service) ;
          fournir les fonctions scolaires commandées par l’établissement (exécution du contrat avec l’établissement) ;
          notifications push demandées (intérêt légitime / consentement selon le canal) ; support et traces d’audit
          de sécurité (intérêt légitime et, le cas échéant, obligation légale).
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Destinataires et sous-traitants</h2>
        <p>
          Personnes habilitées de l’établissement ; API Somafrik ; hébergement Render ; base PostgreSQL Supabase ;
          notifications Expo Push. Les données ne sont pas vendues. Détail : documentation interne
          <code className="mx-1">docs/compliance/sous-traitants-transferts.md</code>.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Transferts hors EEE</h2>
        <p>
          Render, Supabase et Expo peuvent impliquer des traitements hors EEE selon leur infrastructure.
          Les garanties applicables (DPA / SCC des prestataires) sont listées dans le registre des sous-traitants.
          Aucun transfert supplémentaire n’est activé par l’application (pas de SMS, WhatsApp ou e-mail transactionnel embarqué).
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Conservation</h2>
        <p>
          Comptes : durée d’utilisation puis suppression ou anonymisation. Sessions et jetons de rafraîchissement : expiration courte puis purge.
          Jetons push inactifs : purge configurable. Journaux d’audit, dossier scolaire et pièces comptables :
          conservés selon les obligations de l’établissement ; ils ne sont pas auto-supprimés par le job applicatif.
          Matrice : <code>docs/compliance/matrice-conservation.md</code>.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Vos droits</h2>
        <p>
          Accès, rectification, effacement, limitation, opposition, et portabilité lorsque les conditions de l’art. 20 RGPD
          sont réunies. Retrait du consentement pour les notifications facultatives. Une vérification d’identité peut être
          demandée. Pour supprimer votre compte : <Link className="text-blue-700 underline" to="/suppression-compte">Suppression de compte</Link>.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Réclamation CNIL</h2>
        <p>
          Vous pouvez saisir la CNIL : <a className="text-blue-700 underline" href={CNIL_URL}>{CNIL_URL}</a>.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Mineurs et élèves</h2>
        <p>
          Les comptes élèves sont gérés dans le cadre scolaire par l’établissement et, selon le cas, par les représentants légaux.
          Un élève ne doit jamais transmettre son mot de passe ou PIN dans une demande de support.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Sécurité</h2>
        <p>
          Une seule API (pas d’accès client aux tables Supabase). Interdiction serveur pour les administrateurs
          plateforme sur les données personnelles d’établissement. Jeton d’accès ≤ 15 min en production, jeton de
          rafraîchissement rotatif et haché, révocation à la déconnexion ou de toutes les sessions. Chiffrement en
          transit (HTTPS). Pièces jointes : types, taille, octets magiques, pas d’adresse publique anonyme.
        </p>
      </section>
    </LegalLayout>
  );
}

export function AccountDeletionPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(`${API_URL.replace(/\/$/, "")}/api/privacy/erasure-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolCode: String(form.get("schoolCode") ?? "").trim(),
          identifier: String(form.get("identifier") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          role: String(form.get("role") ?? "").trim(),
          reason: String(form.get("reason") ?? "").trim(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Demande refusée");
      }
      setStatus("ok");
      setMessage("Demande enregistrée. L’établissement ou l’opérateur la traitera après vérification d’identité.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Impossible d’enregistrer la demande.");
    }
  }

  return (
    <LegalLayout title="Demander la suppression d’un compte">
      <section>
        <h2 className="text-xl font-bold text-slate-950">Comment faire</h2>
        <p>
          Envoyez une demande depuis l’adresse e-mail ou le numéro associé au compte. Indiquez votre nom, votre identifiant Somafrik,
          le code de l’établissement et votre rôle. Ne transmettez jamais votre mot de passe ou votre code PIN.
        </p>
        <a className="mt-4 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800" href={DELETION_MAILTO}>
          Envoyer la demande
        </a>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Enregistrer la demande dans Somafrik</h2>
        <p>Une demande tracée (statut « en attente ») est créée. Elle n’efface pas immédiatement le dossier scolaire.</p>
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <input name="schoolCode" required placeholder="Code établissement" className="w-full rounded-lg border px-3 py-2" />
          <input name="identifier" required placeholder="Identifiant" className="w-full rounded-lg border px-3 py-2" />
          <input name="email" type="email" placeholder="E-mail de contact" className="w-full rounded-lg border px-3 py-2" />
          <input name="role" placeholder="Rôle" className="w-full rounded-lg border px-3 py-2" />
          <textarea name="reason" placeholder="Motif (optionnel)" className="w-full rounded-lg border px-3 py-2" />
          <button type="submit" disabled={status === "sending"} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white">
            Enregistrer la demande
          </button>
        </form>
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Vérification et traitement</h2>
        <p>
          Somafrik ou l’établissement vérifie l’identité et les droits du demandeur avant toute action. La demande est traitée
          dans un délai maximal d’un mois, sauf vérification complexe ou obligation légale justifiant un délai supplémentaire.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Ce qui sera supprimé</h2>
        <p>
          L’accès au compte est désactivé. Les identifiants de connexion, coordonnées et données de profil qui ne sont plus
          nécessaires sont supprimés ou anonymisés. Les sessions actives sont révoquées.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-bold text-slate-950">Ce qui peut être conservé</h2>
        <p>
          Les notes, présences, bulletins, paiements, documents scolaires et journaux d’audit peuvent être conservés sous une
          forme identifiée ou anonymisée lorsque l’établissement ou la loi doit préserver l’intégrité du dossier scolaire,
          financier ou de sécurité. Ces données ne restent accessibles qu’aux personnes habilitées.
        </p>
      </section>
      <p>Consultez également notre <Link className="text-blue-700 underline" to="/confidentialite">Politique de confidentialité</Link>.</p>
    </LegalLayout>
  );
}
