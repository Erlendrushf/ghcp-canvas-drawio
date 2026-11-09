import { startViewer } from "../.github/extensions/drawio-viewer/lib/server.mjs";
const path = process.argv[2];
if (!path) throw new Error("Usage: npm run preview -- <workspace-relative.drawio>");
const viewer = await startViewer({ root: process.cwd(), path });
console.log(viewer.url);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await viewer.close(); process.exit(0); });
