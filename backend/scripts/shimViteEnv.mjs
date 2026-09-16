import { register } from "node:module";

register(new URL("./shimViteEnvLoader.mjs", import.meta.url).href);
