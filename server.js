// The whole helpdesk, started from the project's main folder: "npm start"
// or "node server.js". Hosting companies that run Node.js apps
// (SiteGround's Node.js Projects and the like) start this file.
// It runs the server folder's start (server/src/start.js): database
// updates, then the website and the API together, on the PORT the host
// gives it.
import path from "node:path";
import process from "node:process";

// The server's own files (.env, uploads...) are found from its folder
process.chdir(path.join(import.meta.dirname, "server"));
await import("./server/src/start.js");
