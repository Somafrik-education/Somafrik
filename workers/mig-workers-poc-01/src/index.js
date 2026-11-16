import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createPocApp } from "./app.js";
import { handleNotificationBatch } from "./queue.js";

const app = createPocApp({
  getEnv: () => env,
});
app.listen(3000);
const httpHandler = httpServerHandler({ port: 3000 });

function refused() {
  return new Response(JSON.stringify({ code: "POC_ENVIRONMENT_REFUSED" }), {
    status: 403,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, requestEnv, ctx) {
    if (requestEnv.APP_ENV !== "workers-poc") return refused();
    return httpHandler.fetch(request, requestEnv, ctx);
  },
  async queue(batch, requestEnv) {
    if (requestEnv.APP_ENV !== "workers-poc") {
      throw new Error("POC_ENVIRONMENT_REFUSED");
    }
    await handleNotificationBatch(batch, requestEnv.HYPERDRIVE?.connectionString);
  },
};
