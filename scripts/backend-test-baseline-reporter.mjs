// MONO-T0 — reporter node:test qui écrit chaque résultat de test en JSON.
// Utilisé par scripts/backend-test-baseline.js pour classer PASS / FAIL / SKIP
// par fichier, sans dépendre du format texte du reporter « spec ».

function statusOf(type, data) {
  if (type === "test:fail") return "fail";
  if (data.skip !== undefined && data.skip !== false) return "skip";
  if (data.todo !== undefined && data.todo !== false) return "todo";
  return "pass";
}

function errorMessage(data) {
  const error = data.details?.error;
  if (!error) return undefined;
  const message = error.cause?.message ?? error.message ?? String(error);
  return String(message).slice(0, 500);
}

export default async function* baselineReporter(source) {
  const results = [];
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const data = event.data ?? {};
    if (data.details?.type === "suite") continue;
    const status = statusOf(event.type, data);
    results.push({
      file: data.file ?? null,
      name: data.name,
      nesting: data.nesting ?? 0,
      status,
      skipReason: status === "skip" && typeof data.skip === "string" ? data.skip : undefined,
      error: status === "fail" ? errorMessage(data) : undefined,
    });
  }
  yield `${JSON.stringify(results)}\n`;
}
