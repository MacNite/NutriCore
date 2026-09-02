// `output: "standalone"` makes the build emit its own server, and Next refuses
// to serve that build through `next start`. The image runs `node server.js`
// beside the assets the Dockerfile copies in, so the same layout is assembled
// here: whatever is started locally or in the end-to-end suite is then the
// server production actually runs.
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const standalone = resolve(".next/standalone");
const server = resolve(standalone, "server.js");

if (!existsSync(server)) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

// The standalone output carries the server bundle alone. Browser chunks are
// replaced rather than merged, because a previous build leaves files behind
// that the current build ID no longer refers to.
const staticDir = resolve(standalone, ".next/static");
rmSync(staticDir, { recursive: true, force: true });
cpSync(resolve(".next/static"), staticDir, { recursive: true });
cpSync(resolve("public"), resolve(standalone, "public"), { recursive: true });

// server.js changes into its own directory and reads PORT and HOSTNAME from the
// environment, exactly as it does in the container.
await import(pathToFileURL(server).href);
