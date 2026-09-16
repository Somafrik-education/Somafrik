/** Chargeur ESM : substitue apiUrl.ts pour le runner Node (pas de Vite). */
export async function load(url, context, nextLoad) {
  if (url.includes("/web/src/lib/apiUrl.ts") || url.endsWith("/lib/apiUrl.ts")) {
    return {
      format: "module",
      shortCircuit: true,
      source: 'export const API_URL = "http://127.0.0.1";\n',
    };
  }
  return nextLoad(url, context);
}
