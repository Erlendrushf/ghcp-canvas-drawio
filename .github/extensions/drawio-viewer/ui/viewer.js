/* global GraphViewer, mxStencilRegistry, Graph */
const $ = id => document.getElementById(id);
let viewer, lastHash, pending = false, again = false;
const runtimeDiagnostics = new Set();
mxStencilRegistry.allowEval = false;
const getStencil = mxStencilRegistry.getStencil;
mxStencilRegistry.getStencil = function(name) {
  const result = getStencil.apply(this, arguments);
  if (!result && name.startsWith("mxgraph.")) runtimeDiagnostics.add(`Missing stencil: ${name}`);
  return result;
};
Graph.prototype.openLink = function() { runtimeDiagnostics.add("External navigation is disabled"); };
function report(messages) {
  $("diagnostics").replaceChildren(...messages.map(text => {
    const li = document.createElement("li"); li.textContent = text; return li;
  }));
  $("issues").hidden = !messages.length;
}
async function json(path, data) {
  const response = await fetch(path, data === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
async function render() {
  if (pending) { again = true; return; }
  pending = true;
  try {
    const state = await json("state");
    $("filename").textContent = state.path;
    if (state.error) throw new Error(state.error);
    const page = viewer?.currentPage || 0;
    const scale = viewer?.graph.view.scale;
    runtimeDiagnostics.clear();
    viewer?.graph.destroy();
    $("diagram").replaceChildren();
    $("diagram").style.width = "calc(100% - 1.6rem)";
    $("diagram").style.height = "65vh";
    $("diagram").setAttribute("data-mxgraph", JSON.stringify({
      xml: state.xml, toolbar: "pages layers", "toolbar-nohide": true,
      editable: false, lightbox: false, nav: true, resize: false, border: 20, center: true
    }));
    GraphViewer.createViewerForElement($("diagram"), result => { viewer = result; });
    if (page && page < state.pages.length) viewer.selectPage(page);
    if (lastHash === state.hash && scale) viewer.graph.zoomTo(scale);
    else viewer.graph.fit(20);
    lastHash = state.hash;
    $("status").className = "";
    $("status").textContent = `${state.pages.length} page(s) · ${state.bytes.toLocaleString()} bytes${state.diagnostics.length || runtimeDiagnostics.size ? " · Incomplete: see diagnostics" : ""}`;
    report([...state.diagnostics, ...runtimeDiagnostics]);
    $("missing").replaceChildren(...state.missing.map(value => {
      const option = document.createElement("option"); option.value = value; return option;
    }));
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = error.message;
    viewer?.graph.destroy(); viewer = undefined;
    $("diagram").replaceChildren();
  } finally {
    pending = false;
    if (again) { again = false; void render(); }
  }
}
$("refresh").onclick = async () => { try { await json("refresh", {}); await render(); } catch (error) { $("status").textContent = error.message; } };
$("fit").onclick = () => viewer?.graph.fit(20);
$("zoom-in").onclick = () => viewer?.graph.zoomIn();
$("zoom-out").onclick = () => viewer?.graph.zoomOut();
$("reset").onclick = () => viewer?.graph.zoomTo(1);
$("files").onchange = () => {
  $("mapping-fields").replaceChildren(...Array.from($("files").files).map(file => {
    const div = document.createElement("div"); div.className = "mapping";
    const label = document.createElement("label");
    label.textContent = `${file.name} (${file.size.toLocaleString()} bytes) → exact diagram resource path/URL`;
    const input = document.createElement("input"); input.dataset.file = file.name; input.setAttribute("list", "missing"); input.required = true;
    label.append(input); div.append(label); return div;
  }));
};
$("import").onclick = async () => {
  $("import").disabled = true;
  try {
    const files = [];
    for (const [index, file] of Array.from($("files").files).entries()) {
      if (file.size > 5 * 1024 ** 2) throw new Error("Icon exceeds 5 MiB");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
      });
      files.push({ name: file.name, data, aliases: [$("mapping-fields").querySelectorAll("input")[index].value] });
    }
    const result = await json("import", { name: $("pack-name").value, provenance: $("provenance").value, files });
    $("import-status").textContent = `Imported ${result.count} icon(s) into ${result.name}. Review these tracked assets before publishing.`;
    await render();
  } catch (error) { $("import-status").textContent = error.message; }
  finally { $("import").disabled = false; }
};
document.addEventListener("securitypolicyviolation", event => {
  runtimeDiagnostics.add(`Blocked resource: ${event.blockedURI}`);
  report([...Array.from($("diagnostics").children, node => node.textContent), ...runtimeDiagnostics]);
  $("status").textContent = "Incomplete rendering: blocked resource; see diagnostics";
});
const events = new EventSource("events");
events.onmessage = () => void render();
events.onerror = () => { $("status").textContent = "Connection lost. Refresh or reopen the panel."; };
window.addEventListener("pagehide", () => events.close());
new ResizeObserver(() => { if (viewer) viewer.graph.sizeDidChange(); }).observe($("diagram"));
void render();
