import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  clearDemoRuntimeState,
  demoWatermarkLabel,
  isDemoRuntimeExpired,
  loadDemoRuntimeState,
  type DemoRuntimeState,
} from "../../lib/demoRuntime";
import { demoRuntimeEnabled } from "../../lib/featureFlags";

const MARK_COUNT = 18;

function ensureNoIndexMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "robots";
    document.head.appendChild(meta);
  }
  meta.content = "noindex,nofollow,noarchive";
}

export function DemoRuntimeChrome() {
  const { setSession } = useAuth();
  const [runtime, setRuntime] = useState<DemoRuntimeState | null>(() => loadDemoRuntimeState());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!demoRuntimeEnabled || !runtime) return;
    ensureNoIndexMeta();

    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [runtime]);

  useEffect(() => {
    if (!demoRuntimeEnabled || !runtime) return;
    if (!isDemoRuntimeExpired(runtime, now)) return;

    clearDemoRuntimeState();
    setRuntime(null);
    setSession(null);
    window.location.replace("https://somafrik.app/demo?session=expired");
  }, [now, runtime, setSession]);

  const watermark = useMemo(
    () => (runtime ? demoWatermarkLabel(runtime, now) : ""),
    [runtime, now],
  );

  if (!demoRuntimeEnabled || !runtime || isDemoRuntimeExpired(runtime, now)) return null;

  return (
    <>
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-bold text-amber-950 sm:text-sm">
        Mode démonstration — les données présentées sont fictives et sont réinitialisées régulièrement.
        <span className="ml-2 font-medium text-amber-800">Session {runtime.id.slice(0, 8).toUpperCase()}</span>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40 grid grid-cols-2 content-around gap-x-12 gap-y-16 overflow-hidden px-4 py-10 opacity-[0.07] sm:grid-cols-3"
      >
        {Array.from({ length: MARK_COUNT }, (_, index) => (
          <span
            key={index}
            className="select-none whitespace-nowrap text-[10px] font-black uppercase tracking-wider text-slate-900 [transform:rotate(-24deg)] sm:text-xs"
          >
            {watermark}
          </span>
        ))}
      </div>
    </>
  );
}
