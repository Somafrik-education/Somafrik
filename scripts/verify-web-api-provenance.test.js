"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, scriptRefs, verifyWebApiProvenance } = require("./verify-web-api-provenance");

const SHA_A = "8467944526563b956bfd50370079af9e9355b533";
const SHA_B = "78a7749aecfb62b6be79129a6c0e7e6ca3ea4fb1";

function fakeFetch(routes) {
  return async (url) => {
    if (!(url in routes)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => routes[url] };
  };
}

function site({ webSha, apiSha, chunk = "" }) {
  return fakeFetch({
    "https://web.test/build-info.json": JSON.stringify({ gitSha: webSha, gitBranch: "develop", source: "render" }),
    "https://api.test/api/health": JSON.stringify({ status: "ok", gitSha: apiSha }),
    "https://web.test/": '<script type="module" src="/assets/index-AbCdEf12.js"></script>',
    "https://web.test/assets/index-AbCdEf12.js": 'import("./StudentCardTab-ZZZZZZZZ.js");',
    "https://web.test/assets/StudentCardTab-ZZZZZZZZ.js": chunk,
  });
}

test("Web et API au même SHA attendu : OK", async () => {
  const result = await verifyWebApiProvenance(
    { web: "https://web.test/", api: "https://api.test", expect: SHA_A },
    site({ webSha: SHA_A, apiSha: SHA_A }),
  );
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("Écart de version Web / API détecté (cas audit #1193)", async () => {
  const result = await verifyWebApiProvenance({ web: "https://web.test", api: "https://api.test" }, site({ webSha: SHA_A, apiSha: SHA_B }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith("VERSION_SKEW")));
});

test("Web sans build-info.json (build antérieur) : signalé, pas supposé conforme", async () => {
  const fetchImpl = fakeFetch({ "https://api.test/api/health": JSON.stringify({ gitSha: SHA_A }) });
  const result = await verifyWebApiProvenance({ web: "https://web.test", api: "https://api.test" }, fetchImpl);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith("WEB_BUILD_INFO_INDISPONIBLE")));
});

test("Marqueurs : présence suivie dans les chunks chargés dynamiquement", async () => {
  const fetchImpl = site({ webSha: SHA_A, apiSha: SHA_A, chunk: 'const t="Confirmer la révocation de sécurité";' });
  const ok = await verifyWebApiProvenance(
    { web: "https://web.test", api: "https://api.test", markers: ["Confirmer la révocation de sécurité"] },
    fetchImpl,
  );
  assert.equal(ok.ok, true, ok.errors.join("\n"));
  const missing = await verifyWebApiProvenance(
    { web: "https://web.test", api: "https://api.test", markers: ["Révocation absente"] },
    fetchImpl,
  );
  assert.ok(missing.errors.some((error) => error.startsWith("MARQUEUR_ABSENT")));
});

test("parseArgs et scriptRefs", () => {
  assert.deepEqual(parseArgs(["--web", "w", "--api", "a", "--marker", "x", "--marker", "y", "--expect", SHA_A.toUpperCase()]), {
    web: "w", api: "a", markers: ["x", "y"], expect: SHA_A,
  });
  assert.deepEqual(scriptRefs('src="/assets/index-DnYpqg8G.js" from"./react-DtM9o4nw.js"').sort(), ["index-DnYpqg8G.js", "react-DtM9o4nw.js"]);
});
