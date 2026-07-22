import type { StudentGuardianViewModel } from "../../lib/studentGuardianViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";

interface StudentEmergencyContactsProps {
  contacts: readonly StudentGuardianViewModel[];
}

export function StudentEmergencyContacts({
  contacts,
}: StudentEmergencyContactsProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title="Contacts d'urgence"
        description="Personnes à joindre en priorité en cas d'urgence."
      />

      {contacts.length === 0 ? (
        <EmptyState className="mt-6" title="Aucun contact d&apos;urgence" />
      ) : (
        <ol className="mt-6 space-y-4">
          {contacts.map((contact, index) => (
            <li
              key={contact.id}
              className="flex items-start gap-3 rounded-xl border border-line px-4 py-3"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm font-bold text-amber-800">
                {index + 1}
              </span>
              <div>
                <p className="font-semibold text-ink">{contact.displayName}</p>
                <p className="text-sm text-muted">
                  {contact.relationshipLabel}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {contact.phoneLabel}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
