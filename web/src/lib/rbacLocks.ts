export type RbacAction = "create" | "read" | "update" | "delete";

export type RbacActionFlags = Record<RbacAction, boolean>;

export type RbacLockKind = "role_invariant" | "dependency";

export type RbacActionLock = {
  locked: boolean;
  reason: RbacLockKind | null;
};

export type RbacCrudFlags = {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

const FLAG_BY_ACTION: Record<RbacAction, keyof RbacCrudFlags> = {
  create: "canCreate",
  read: "canRead",
  update: "canUpdate",
  delete: "canDelete",
};

const EMPTY_MANDATORY: RbacActionFlags = {
  create: false,
  read: false,
  update: false,
  delete: false,
};

export const DEFAULT_MODULE_DEPENDENCIES: Record<string, RbacAction[]> = {
  create: ["read"],
  update: ["read"],
  delete: ["read"],
};

export const MANDATORY_LOCK_TOOLTIP = "Permission obligatoire pour le fonctionnement de ce rôle";
export const DEPENDENCY_LOCK_TOOLTIP =
  "Requise tant qu'une action CREATE, UPDATE ou DELETE est active sur ce module";

export function emptyMandatoryFlags(): RbacActionFlags {
  return { ...EMPTY_MANDATORY };
}

export function mandatoryFlagsForModule(
  mandatoryByRole: Record<string, Record<string, Partial<RbacActionFlags>>> | undefined,
  roleKey: string,
  moduleKey: string,
): RbacActionFlags {
  const row = mandatoryByRole?.[roleKey]?.[moduleKey];
  return {
    create: row?.create === true,
    read: row?.read === true,
    update: row?.update === true,
    delete: row?.delete === true,
  };
}

export function describeActionLock(options: {
  action: RbacAction;
  flags: RbacCrudFlags;
  mandatory: RbacActionFlags;
}): RbacActionLock {
  const { action, flags, mandatory } = options;
  if (mandatory[action]) {
    return { locked: true, reason: "role_invariant" };
  }
  const dependentActive = flags.canCreate || flags.canUpdate || flags.canDelete;
  if (action === "read" && dependentActive) {
    return { locked: true, reason: "dependency" };
  }
  return { locked: false, reason: null };
}

export function lockTooltip(reason: RbacLockKind | null): string {
  if (reason === "role_invariant") return MANDATORY_LOCK_TOOLTIP;
  if (reason === "dependency") return DEPENDENCY_LOCK_TOOLTIP;
  return "";
}

export function applyMandatoryOverlay(flags: RbacCrudFlags, mandatory: RbacActionFlags): RbacCrudFlags {
  return {
    canCreate: flags.canCreate || mandatory.create,
    canRead: flags.canRead || mandatory.read,
    canUpdate: flags.canUpdate || mandatory.update,
    canDelete: flags.canDelete || mandatory.delete,
  };
}

export function toggleCrudFlag(
  current: RbacCrudFlags,
  field: keyof RbacCrudFlags,
  mandatory: RbacActionFlags,
): RbacCrudFlags {
  const action = (Object.keys(FLAG_BY_ACTION) as RbacAction[]).find((key) => FLAG_BY_ACTION[key] === field);
  if (!action) return current;
  const lock = describeActionLock({ action, flags: current, mandatory });
  if (lock.locked) return current;
  const next: RbacCrudFlags = { ...current, [field]: !current[field] };
  if ((field === "canCreate" || field === "canUpdate" || field === "canDelete") && next[field]) {
    next.canRead = true;
  }
  return applyMandatoryOverlay(next, mandatory);
}
