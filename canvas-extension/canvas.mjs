import { startViewer } from "./lib/server.mjs";

export function createDrawioCanvas(createCanvas) {
  const instances = new Map();
  return createCanvas({
    id: "drawio-viewer",
    displayName: "draw.io viewer",
    description: "View local draw.io XML diagrams offline with Microsoft and Azure icons, without modifying diagram files.",
    inputSchema: {
      type: "object", properties: { path: { type: "string", minLength: 1 } },
      required: ["path"], additionalProperties: false
    },
    actions: [
      { name: "refresh", description: "Re-read the diagram file", handler: async ctx => {
        const viewer = instances.get(ctx.instanceId);
        if (!viewer) throw new Error("Diagram panel is not open");
        await viewer.refresh();
        return viewer.info();
      } },
      { name: "get_document_info", description: "Get file hash, pages and resource diagnostics", handler: ctx => {
        const viewer = instances.get(ctx.instanceId);
        if (!viewer) throw new Error("Diagram panel is not open");
        return viewer.info();
      } }
    ],
    open: async ctx => {
      const root = ctx.session?.workingDirectory;
      if (!root) throw new Error("Canvas requires an active workspace directory");
      let viewer = instances.get(ctx.instanceId);
      if (!viewer) {
        viewer = await startViewer({ root, path: ctx.input.path });
        instances.set(ctx.instanceId, viewer);
      }
      return { url: viewer.url, title: ctx.input.path, status: viewer.info().error ? "Unable to load diagram" : "Read-only · Offline" };
    },
    onClose: async ctx => {
      const viewer = instances.get(ctx.instanceId);
      instances.delete(ctx.instanceId);
      await viewer?.close();
    }
  });
}
