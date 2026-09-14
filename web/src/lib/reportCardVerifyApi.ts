import { API_URL } from "./apiUrl";

export type VerifyResult =
  | { ok: true; payload: unknown; verification_status?: string }
  | { ok: false; reason: string };

export async function verifyReportCardCapability(capability: string): Promise<VerifyResult> {
  const response = await fetch(`${API_URL.replace(/\/$/, "")}/api/public/report-cards/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    body: JSON.stringify({ capability }),
  });
  const data = (await response.json().catch(() => null)) as VerifyResult | null;
  if (!data || data.ok !== true) {
    return { ok: false, reason: "not_found" };
  }
  return data;
}
