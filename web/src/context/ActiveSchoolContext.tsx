import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { School } from "../types";
import { SCHOOL_SCOPED_CANONICAL_KEYS } from "../lib/canonicalDomains";
import type { DomainKey } from "../lib/domainLoaders";
import {
  pickInitialSchoolCode,
  userRequiresSchoolSelection,
  withSchoolScope,
  writeStoredSchoolCode,
} from "../lib/activeSchool";
import { normalize } from "../lib/format";
import { scopedSchools } from "../lib/scope";
import { useAuth } from "./AuthContext";
import { useData } from "./DataContext";

interface ActiveSchoolContextValue {
  activeSchoolCode: string;
  activeSchool: School | null;
  availableSchools: School[];
  requiresSelection: boolean;
  scopedUser: ReturnType<typeof withSchoolScope>;
  setActiveSchoolCode: (code: string) => void;
}

const ActiveSchoolContext = createContext<ActiveSchoolContextValue | null>(null);

export function ActiveSchoolProvider({ children }: { children: ReactNode }) {
  const { session, permissionsReady } = useAuth();
  const { state, ensureDomains, invalidateDomains, purgeSchoolScopedState } = useData();
  const user = session?.user ?? null;

  const availableSchools = useMemo(() => scopedSchools(user, state), [user, state]);
  const availableCodes = useMemo(() => availableSchools.map((school) => school.code), [availableSchools]);

  const [activeSchoolCode, setActiveSchoolCodeState] = useState(() =>
    pickInitialSchoolCode(user, availableCodes),
  );

  const previousSchoolRef = useRef(activeSchoolCode);

  useEffect(() => {
    if (!permissionsReady || !session?.accessToken) return;
    void ensureDomains(["schools"]).catch(() => undefined);
  }, [permissionsReady, session?.accessToken, ensureDomains]);

  useEffect(() => {
    const previous = previousSchoolRef.current;
    if (previous && previous !== activeSchoolCode && previous !== "*") {
      purgeSchoolScopedState(previous);
      const scopedDomains = [...SCHOOL_SCOPED_CANONICAL_KEYS, "academicConfigs"] as DomainKey[];
      invalidateDomains(scopedDomains);
    }
    previousSchoolRef.current = activeSchoolCode;
    writeStoredSchoolCode(activeSchoolCode);

    invalidateDomains(["academicConfigs"], { schoolCode: activeSchoolCode });
    if (!permissionsReady || !activeSchoolCode || activeSchoolCode === "*") return;
    void ensureDomains(["academicConfigs"], { schoolCode: activeSchoolCode, force: true }).catch(
      () => undefined,
    );
  }, [activeSchoolCode, ensureDomains, invalidateDomains, permissionsReady, purgeSchoolScopedState]);

  useEffect(() => {
    setActiveSchoolCodeState((current) => {
      const next = pickInitialSchoolCode(user, availableCodes);
      if (!current) return next;
      if (availableCodes.some((code) => normalize(code) === normalize(current))) return current;
      return next;
    });
  }, [user, availableCodes.join("|")]);

  const setActiveSchoolCode = useCallback((code: string) => {
    setActiveSchoolCodeState(code);
    writeStoredSchoolCode(code);
  }, []);

  const activeSchool =
    availableSchools.find((school) => normalize(school.code) === normalize(activeSchoolCode)) ?? null;

  const scopedUser = withSchoolScope(user, activeSchoolCode);
  const requiresSelection = userRequiresSchoolSelection(user);

  const value = useMemo(
    () => ({
      activeSchoolCode,
      activeSchool,
      availableSchools,
      requiresSelection,
      scopedUser,
      setActiveSchoolCode,
    }),
    [activeSchool, activeSchoolCode, availableSchools, requiresSelection, scopedUser, setActiveSchoolCode],
  );

  return <ActiveSchoolContext.Provider value={value}>{children}</ActiveSchoolContext.Provider>;
}

export function useActiveSchool(): ActiveSchoolContextValue {
  const ctx = useContext(ActiveSchoolContext);
  if (!ctx) {
    throw new Error("useActiveSchool doit être utilisé dans ActiveSchoolProvider");
  }
  return ctx;
}
