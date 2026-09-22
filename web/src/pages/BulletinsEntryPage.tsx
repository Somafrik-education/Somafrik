import { useAuth } from "../context/AuthContext";
import { isParentRole } from "../lib/format";
import { EntityPage } from "./EntityPage";
import { ParentBulletinsPage } from "./ParentBulletinsPage";

export function BulletinsEntryPage() {
  const { session } = useAuth();
  if (isParentRole(session?.user?.role)) return <ParentBulletinsPage />;
  return <EntityPage entity="bulletins" />;
}
