import { Badge, Card, SectionHeader } from "@/design-system";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";
import { schoolSetupOptionalCompleteness } from "../../lib/schoolSetupWeb";

const OPTIONAL_KEYS = ["periods", "teachers", "students", "feeGrids", "notifications"] as const;

export function SchoolSetupOptionalCompleteness({ payload }: { payload: SchoolSetupPayload }) {
  const optional = payload.optional;
  const items = schoolSetupOptionalCompleteness(payload);
  const byId = new Map(items.map((item) => [item.id, item]));

  return (
    <Card className="p-5">
      <SectionHeader
        title="Complétude recommandée"
        description="Pour aller plus loin : ces indicateurs restent informatifs et ne bloquent pas la configuration essentielle."
      />
      <ul className="mt-4 space-y-2">
        {OPTIONAL_KEYS.map((id) => {
          const item = byId.get(id);
          const done = Boolean(optional?.[id] ?? item?.done);
          return (
            <li
              key={id}
              className="flex min-h-11 items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm"
            >
              <span className="font-semibold text-ink">{item?.label ?? id}</span>
              <Badge tone={done ? "success" : "warning"}>{done ? "Configuré" : "À compléter"}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
