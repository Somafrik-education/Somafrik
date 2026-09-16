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
import { getAccessToken } from "../api/client";
import { demoRuntimeEnabled } from "../lib/featureFlags";
import { useAuth } from "./AuthContext";
import { useData } from "./DataContext";

interface ActiveSchoolContextValue {
  activeSchoolCode: string;
  activeSchool: School | null;
  availableSchools: School[];
  requiresSelection: boolean;
  scopedUser: ReturnType<typeof withSchoolScope>;
  setActiveSchoolCode: (code: string) => void;
  scopeTransition: "idle" | "switching";
}

const ActiveSchoolContext = createContext<ActiveSchoolContextValue | null>(null);

type DemoSessionSchool = {
  demo?: boolean;
  school?: School & { loginCode?: string };
};

export function ActiveSchoolProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { state, ensureDomains, invalidateDomains, beginScopeTransition, scopeSwitching } = useData();
  const user = session?.user ?? null;
  const demoSession = session as (typeof session & DemoSessionSchool) | null;
  const exchangedSchool =
    demoRuntimeEnabled && demoSession?.demo === true && demoSession.school
      ? demoSession.school
      : null;

  const availableSchools = useMemo(() => {
    const scoped = scopedSchools(user, state);
    if (!exchangedSchool) return scoped;

    // /api/demo/exchange renvoie déjà le contexte établissement authentifié
    // avec UUID + loginCode + schoolCode. En Démo, réutiliser cette autorité
    // évite un second snapshot /backoffice/establishments/:code coûteux.
    const code = String(exchangedSchool.code ?? user?.schoolCode ?? "").trim();
    if (!code) return scoped;
    const normalizedSchool: School = {
      ...exchangedSchool,
      code,
      publicId:
        exchangedSchool.publicId ??
        exchangedSchool.loginCode ??
        user?.schoolPublicCode ??
        undefined,
    };
    const withoutDuplicate = scoped.filter(
      (school) => normalize(school.code) !== normalize(normalizedSchool.code),
    );
    return [normalizedSchool, ...withoutDuplicate];
  }, [user, state, exchangedSchool]);
  const availableCodes = useMemo(() => availableSchools.map((school) => school.code), [availableSchools]);

  const [activeSchoolCode, setActiveSchoolCodeState] = useState(() =>
    pickInitialSchoolCode(user, availableCodes),
  );

  const previousSchoolRef = useRef(activeSchoolCode);

  useEffect(() => {
    if (!session?.accessToken || !getAccessToken()) return;
    if (demoRuntimeEnabled && demoSession?.demo === true && exchangedSchool) {
      return;
    }
    const membership = String(user?.schoolCode ?? "").trim();
    if (membership && membership !== "*") {
      void ensureDomains(["schools"], { schoolCode: membership }).catch(() => undefined);
      return;
    }
    void ensureDomains(["schools"]).catch(() => undefined);
  }, [
    session?.accessToken,
    user?.schoolCode,
    ensureDomains,
    demoSession?.demo,
    exchangedSchool,
  ]);

  useEffect(() => {
    const previous = previousSchoolRef.current;
    if (previous && previous !== activeSchoolCode && previous !== "*") {
      const scopedDomains = [...SCHOOL_SCOPED_CANONICAL_KEYS, "academicConfigs"] as DomainKey[];
      invalidateDomains(scopedDomains);
    }
    previousSchoolRef.current = activeSchoolCode;
    writeStoredSchoolCode(activeSchoolCode);

    invalidateDomains(["academicConfigs"], { schoolCode: activeSchoolCode });
    if (!activeSchoolCode || activeSchoolCode === "*") return;
    void ensureDomains(["academicConfigs"], { schoolCode: activeSchoolCode, force: true }).catch(
      () => undefined,
    );
  }, [activeSchoolCode, ensureDomains, invalidateDomains]);

  useEffect(() => {
    setActiveSchoolCodeState((current) => {
      const next = pickInitialSchoolCode(user, availableCodes);
      if (!current) return next;
      if (availableCodes.some((code) => normalize(code) === normalize(current))) return current;
      return next;
    });
  }, [user, availableCodes.join("|")]);

  const setActiveSchoolCode = useCallback((code: string) => {
    if (normalize(code) !== normalize(activeSchoolCode)) {
      beginScopeTransition(code);
    }
    setActiveSchoolCodeState(code);
    writeStoredSchoolCode(code);
  }, [activeSchoolCode, beginScopeTransition]);

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
      scopeTransition: scopeSwitching ? ("switching" as const) : ("idle" as const),
    }),
    [activeSchool, activeSchoolCode, availableSchools, requiresSelection, scopedUser, setActiveSchoolCode, scopeSwitching],
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
