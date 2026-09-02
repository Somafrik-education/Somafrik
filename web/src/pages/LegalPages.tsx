import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";

const CONTACT_EMAIL = "contact@somafrik.app";
const DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Demande de suppression de compte Somafrik")}`;

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
          <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : 2 septembre 2026</p>
          <div className="mt-8 space-y-7 leading-7 text-slate-700">{children}</div>
        </article>
      </main>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Politique de confidentialité">
      <section><h2 className="text-xl font-bold text-slate-950">Responsable et contact</h2><p>Somafrik fournit une plateforme de gestion scolaire. L’établissement scolaire reste responsable des données qu’il saisit pour sa communauté. Pour toute question ou demande relative à vos données, écrivez à <a className="text-blue-700 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Données traitées</h2><p>Selon votre rôle, Somafrik peut traiter votre identité, vos coordonnées, votre établissement, vos rôles et droits, vos données de connexion et de sécurité, ainsi que des données scolaires nécessaires au service : inscriptions, classes, présences, évaluations, bulletins, documents, communications et paiements enregistrés par l’établissement.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Finalités</h2><p>Ces données servent à authentifier les utilisateurs, fournir les fonctions scolaires autorisées, sécuriser les accès, synchroniser l’application, envoyer les notifications demandées, assurer le support et conserver les traces d’audit nécessaires à la sécurité et aux obligations de l’établissement.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Partage et hébergement</h2><p>Les données sont accessibles aux personnes habilitées par l’établissement et aux prestataires techniques indispensables à l’hébergement, aux notifications et au fonctionnement de Somafrik. Elles ne sont pas vendues. L’accès est limité selon le rôle et l’établissement.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Conservation et sécurité</h2><p>Les données de compte sont conservées pendant l’utilisation du service, puis supprimées ou anonymisées lorsqu’elles ne sont plus nécessaires. Certaines données scolaires, financières, de sécurité ou d’audit peuvent être conservées plus longtemps lorsque la loi ou les obligations de l’établissement l’exigent. Somafrik applique des contrôles d’accès, le chiffrement des communications et une journalisation de sécurité.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Vos droits</h2><p>Vous pouvez demander l’accès, la rectification, la limitation ou la suppression de vos données. Une vérification d’identité peut être demandée. Pour supprimer votre compte, consultez la page <Link className="text-blue-700 underline" to="/suppression-compte">Suppression de compte</Link>.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Enfants et élèves</h2><p>Les comptes et données d’élèves sont gérés dans le cadre scolaire par l’établissement et, selon le cas, par leurs représentants légaux. Un élève ne doit jamais transmettre son mot de passe dans une demande de support.</p></section>
    </LegalLayout>
  );
}

export function AccountDeletionPage() {
  return (
    <LegalLayout title="Demander la suppression d’un compte">
      <section><h2 className="text-xl font-bold text-slate-950">Comment faire</h2><p>Envoyez une demande depuis l’adresse e-mail ou le numéro associé au compte. Indiquez votre nom, votre identifiant Somafrik, le code de l’établissement et votre rôle. Ne transmettez jamais votre mot de passe ou votre code PIN.</p><a className="mt-4 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800" href={DELETION_MAILTO}>Envoyer la demande</a></section>
      <section><h2 className="text-xl font-bold text-slate-950">Vérification et traitement</h2><p>Somafrik ou l’établissement vérifie l’identité et les droits du demandeur avant toute action. La demande est traitée dans un délai maximal d’un mois, sauf vérification complexe ou obligation légale justifiant un délai supplémentaire.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Ce qui sera supprimé</h2><p>L’accès au compte est désactivé. Les identifiants de connexion, coordonnées et données de profil qui ne sont plus nécessaires sont supprimés ou anonymisés. Les sessions actives sont révoquées.</p></section>
      <section><h2 className="text-xl font-bold text-slate-950">Ce qui peut être conservé</h2><p>Les notes, présences, bulletins, paiements, documents scolaires et journaux d’audit peuvent être conservés sous une forme identifiée ou anonymisée lorsque l’établissement ou la loi doit préserver l’intégrité du dossier scolaire, financier ou de sécurité. Ces données ne restent accessibles qu’aux personnes habilitées.</p></section>
      <p>Consultez également notre <Link className="text-blue-700 underline" to="/confidentialite">Politique de confidentialité</Link>.</p>
    </LegalLayout>
  );
}
