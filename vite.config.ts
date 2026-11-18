import { defineConfig, type Plugin } from "vite";
import generateEncounter from "./netlify/functions/generate-encounter.mjs";

// Serves the Netlify function at the same path during `npm run dev`, so AI encounter
// generation works locally without the Netlify CLI. Locally the browser calls it
// directly; on Netlify it runs as a background job (Netlify Blobs isn't available
// here). Critter Codex does the same for its artwork function.
function localEncounterApi(): Plugin {
  return {
    name: "local-encounter-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/.netlify/functions/generate-encounter", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += data.length;
            if (size > 200 * 1024) {
              res.statusCode = 413;
              res.end(JSON.stringify({ error: { code: "bad_request", message: "The request is too large." } }));
              return;
            }
            chunks.push(data);
          }
          const request = new Request("http://localhost/.netlify/functions/generate-encounter", {
            method: req.method,
            headers: { "content-type": req.headers["content-type"] || "application/json" },
            body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
          });
          // No Netlify time limit locally, so give OpenAI as long as the background function does.
          const result = await generateEncounter(request, undefined, { timeoutMs: 5 * 60 * 1000 });
          res.statusCode = result.status;
          res.end(Buffer.from(await result.arrayBuffer()));
        } catch {
          // Never log the request: it contains the API token.
          server.config.logger.error("Local encounter generation request failed.");
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: "server", message: "Generation request failed." } }));
        }
      });
    },
  };
}

// Port 5174 so this can run beside Critter Codex (5173), whose bridge
// allows http://localhost:5174 during development.
export default defineConfig({ base: "/", plugins: [localEncounterApi()], server: { port: 5174, strictPort: true } });
