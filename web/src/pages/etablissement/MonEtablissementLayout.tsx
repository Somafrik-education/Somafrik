import { Outlet } from "react-router-dom";
import { BookOpen, Contact, GraduationCap, Link2, School, Users } from "lucide-react";
import { TabNav, type TabItem } from "../../components/layout/TabNav";

const ETABLISSEMENT_TABS: TabItem[] = [
  { to: "/etablissement/classes", label: "Classes", icon: School },
  { to: "/etablissement/matieres", label: "Matières", icon: BookOpen },
  { to: "/etablissement/eleves", label: "Élèves", icon: GraduationCap },
  { to: "/etablissement/enseignants", label: "Enseignants", icon: Users },
  { to: "/etablissement/contacts", label: "Contacts", icon: Contact },
  { to: "/etablissement/relations-parent-enfant", label: "Parents & élèves", icon: Link2 },
];

/** Module Mon établissement : en-tête + onglets, contenu via <Outlet />. */
export function MonEtablissementLayout() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-brand">Mon établissement</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Mon établissement</h1>
        <p className="mt-1 text-sm text-muted">
          Classes, matières, effectifs, contacts et liaisons parent-enfant de l'établissement.
        </p>
      </div>
      <TabNav tabs={ETABLISSEMENT_TABS} />
      <Outlet />
    </div>
  );
}
