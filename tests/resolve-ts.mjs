// Lets `node --test` load the app's TypeScript modules, which import each other
// without file extensions (Vite style). Used by `npm test`.
import { register } from "node:module";
register(new URL("./resolve-ts-hooks.mjs", import.meta.url));
