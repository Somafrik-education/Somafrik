import type { LucideIcon } from "lucide-react";
import { ComingSoonState } from "../../design-system";

interface PagePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}

/**
 * @deprecated Préférer `ComingSoonState` depuis `@/design-system` (D2.6).
 * Wrapper de coexistence (API LucideIcon conservée).
 */
export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  badge = "Bientôt disponible",
}: PagePlaceholderProps) {
  return (
    <ComingSoonState
      icon={<Icon className="h-7 w-7" />}
      title={title}
      description={description}
      badge={badge}
    />
  );
}
