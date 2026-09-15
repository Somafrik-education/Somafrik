import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { demoRuntimeEnabled } from "../lib/featureFlags";
import { normalizePlatformRole } from "../lib/orgHierarchy";
import {
  clearDemoRuntimeState,
  saveDemoRuntimeState,
  type DemoRuntimeState,
} from "../lib/demoRuntime";
import type { Session } from "../types";

type DemoExchangeResponse = Session & {
  demo?: boolean;
  expiresIn?: number;
  demoSession?: DemoRuntimeState;
};

type EntryStatus = "loading" | "error";

let rememberedEntryCode = "";
const exchanges = new Map<string, Promise<DemoExchangeResponse>>();

function readAndForgetEntryCode() {
  const url = new URL(window.location.href);
  const fromUrl = String(url.searchParams.get("code") ?? "").trim();
  if (fromUrl) rememberedEntryCode = fromUrl;

  if (url.search) {
    window.history.replaceState(window.history.state, "", url.pathname);
  }
  return fromUrl || rememberedEntryCode;
}

function exchangeEntryCode(code: string) {
  const existing = exchanges.get(code);
  if (existing) return existing;
  const request = api.post<DemoExchangeResponse>("/demo/exchange", { code });
  exchanges.set(code, request);
  return request;
}

function installNoIndexMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "robots";
    document.head.appendChild(meta);
  }
  meta.content = "noindex,nofollow,noarchive";
}

export function DemoRuntimeEntryPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [status, setStatus] = useState<EntryStatus>("loading");
  const [message, setMessage] = useState("Préparation de votre espace de démonstration…");

  useEffect(() => {
    installNoIndexMeta();
    clearDemoRuntimeState();

    if (!demoRuntimeEnabled) {
      setStatus("error");
      setMessage("L’environnement de démonstration Web n’est pas activé.");
      return;
    }

    const code = readAndForgetEntryCode();
    if (!code) {
      setStatus("error");
      setMessage("Ce lien de démonstration est absent ou a déjà été utilisé.");
      return;
    }

    let cancelled = false;
    void exchangeEntryCode(code)
      .then((payload) => {
        if (cancelled) return;
        if (!payload?.accessToken || !payload?.user || !payload?.demo || !payload?.demoSession) {
          throw new Error("Réponse de session Démo invalide.");
        }

        const session: Session = {
          ...payload,
          refreshToken: undefined,
          user: {
            ...payload.user,
            role: normalizePlatformRole(payload.user.role),
          },
        };

        saveDemoRuntimeState(payload.demoSession);
        setSession(session);
        rememberedEntryCode = "";
        navigate("/tableau-de-bord", { replace: true });
      })
      .catch((error) => {
        if (cancelled) return;
        clearDemoRuntimeState();
        setSession(null);
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Impossible d’ouvrir la démonstration. Recommencez depuis Somafrik.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, setSession]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl font-black text-brand">
          S
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-brand">
          Somafrik Démo
        </p>
        <h1 className="mt-2 text-2xl font-black text-ink">
          {status === "loading" ? "Ouverture de la démonstration" : "Accès à la démonstration"}
        </h1>
        <p role="status" className="mt-3 text-sm leading-relaxed text-slate-600">
          {message}
        </p>

        {status === "loading" ? (
          <div className="mx-auto mt-6 h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand" aria-label="Chargement" />
        ) : (
          <a
            href="https://somafrik.app/demo"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-gradient px-5 py-3 text-sm font-bold text-white shadow-brand"
          >
            Recommencer depuis Somafrik
          </a>
        )}

        <p className="mt-6 text-xs leading-relaxed text-slate-500">
          Mode démonstration — données fictives, session temporaire et non destinée à la production.
        </p>
      </section>
    </main>
  );
}
