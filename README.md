# Local draw.io Canvas viewer

A read-only, offline diagrams.net viewer for local `.drawio`, `.dio`, and compatible `.xml` diagrams, with bundled Microsoft/Azure resources and tracked local icon packs.

## Status

The extension includes a runtime entry point generated with the canonical Canvas scaffold and wired to the offline viewer. Real Copilot runtime checks cover discovery, open, actions, input validation, reload/rehydration, and close. Browser checks cover rendering from the URL returned by the runtime. These checks do not automate the desktop app's installer or panel chrome.

## Install in Copilot

Use **Install extension from GitHub** with the extension folder URL:

```text
https://github.com/Erlendrushf/ghcp-canvas-drawio/tree/compact-offline-package/canvas-extension
```

**Use the `canvas-extension` folder, not the repository root or `.github/extensions/drawio-viewer`.** The GitHub installer enforces a 5,000,000-byte total limit. The source extension exceeds that limit even without its icons; the generated install folder fits it. The URL must reference a revision containing this packaging fix; unpublished local changes are not available to the GitHub installer.

The compact package contains losslessly Brotli-compressed vendor assets in chunks smaller than 1,000,000 bytes. It retains the full viewer and stencil bundle and the same Microsoft/Azure icons. The local provider verifies chunk checksums and decodes the bundle in memory; no first-run download, external CDN, filesystem extraction, or internet connection is required. Only editor-only sidebar preview thumbnails, editor styles, and an unused editor font are excluded.

The root forwarding `extension.mjs` supports local-checkout discovery, not size-limited GitHub installation. The uncompressed source folder remains available for development.

Choose **project** scope to share the extension and tracked icon packs with a repository. Cloning and opening this repository also makes `.github/extensions/drawio-viewer/extension.mjs` available to project discovery. If the current conversation predates the entry point, reload extensions or start a new conversation.

Ask Copilot to open a diagram, for example: "Open `examples/azure.drawio` in the draw.io viewer." The Canvas ID is `drawio-viewer`, and its open input is `{ "path": "examples/azure.drawio" }`. Paths are relative to the active session's working directory, not the extension installation directory.

The Canvas wire protocol is experimental.

## Run the implemented viewer locally

Node.js 22.2 or newer is required. The committed renderer, parser, and icon resources need no installation or internet access at runtime.

```sh
npm run preview -- examples/azure.drawio
```

Open the printed loopback URL in a browser. Treat its unpredictable URL as a local access credential; do not share it. Stop the preview with Ctrl+C.

Paths are relative to the working directory. The viewer rejects paths outside that directory, including symlink escapes. It never writes diagram files.

## Features and boundaries

- Zoom, fit, reset, pages, layers, refresh, and automatic file-change refresh.
- Compressed, uncompressed, mixed-page, and bare `mxGraphModel` XML.
- The pinned standard JavaScript shapes/stencils and Microsoft Office / legacy Azure stencil families.
- Azure SVG images under `img/lib/azure2`, legacy `mscae`, Active Directory, and Dynamics assets.
- Embedded SVG/PNG images subject to validation.
- Clear diagnostics for missing resources, unsupported math, external fonts, and blocked external links.
- No editing, saving diagrams, export, cloud storage, remote URL fetching, popup editor, or lightbox.

Remote icons are not downloaded. Recognized upstream diagrams.net image URLs can resolve to the corresponding bundled local asset. Other image paths need an explicit icon-pack mapping.

The UI uses app theme variables for its controls. The diagram surface remains light to preserve its intended colors.

## Import a missing icon

1. Expand **Import local icon pack** and select local SVG/PNG files.
2. Enter a new pack name and source/usage-rights information.
3. Map each file to an **exact** missing resource identifier; diagnostics supply suggestions.
4. Review the destination and mappings, then select **Import reviewed files and mappings**.

Imports write only to the installed extension's `assets/icon-packs/<pack-name>/` directory. For project-source discovery that is:

```text
.github/extensions/drawio-viewer/assets/icon-packs/<pack-name>/
```

Each pack contains its assets and `manifest.json` with checksums, provenance, and explicit aliases. Commit the pack with the project so other users receive the same icons. Existing packs and aliases cannot be silently overwritten. ZIP files, executable content, external SVG references, SVG style attributes, and unsupported formats are rejected. Only use icons whose terms permit their intended use and distribution.

For a compact-folder installation the destination is inside that installed folder, not the development source folder. Copy packs intended for redistribution back to the source extension's `assets/icon-packs/` before regenerating `canvas-extension`; generation replaces the generated folder.

Importing does not modify the source diagram. The renderer resolves aliases in memory. An invalid pack or checksum mismatch is reported explicitly on loading.

## Limits

| Input | Maximum |
|---|---:|
| Diagram file | 10 MiB |
| Decoded page XML | 20 MiB |
| Decoded document XML | 50 MiB |
| Individual imported icon | 5 MiB |
| Icon import, decoded total | 50 MiB |
| Files per import | 500 |
| Mappings per icon | 100 |
| PNG image area | 16,777,216 pixels |

Limits are inclusive; exceeding them is an error. Unsupported external resources can produce an explicitly marked incomplete view, but size violations do not silently drop diagram content. Diagram deletion or malformed replacement clears the old rendering and displays an error. A watcher failure is reported; manual refresh remains available.

## Development

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
npm run assets:verify
```

Alternatively, run browser tests with an existing installed Chrome:

```sh
PLAYWRIGHT_CHANNEL=chrome npm test
```

For real extension registration and lifecycle checks, point to an installed SDK and CLI. For example, on macOS with the Copilot desktop app:

```sh
COPILOT_CLI_PATH="$(command -v copilot)" \
COPILOT_SDK_PATH="/Applications/GitHub Copilot.app/Contents/Resources/copilot-sdk" \
PLAYWRIGHT_CHANNEL=chrome npm run test:runtime
```

Run `npm run package:extension` before the runtime checks after changing source files. The runtime checks use an isolated temporary Copilot home, launch no model turns, and remove their temporary installation after stopping the runtime. They exercise direct project discovery, a copied repository-root installation, and the compact install package without root `node_modules`. Reload is driven through the public `session.extensions.reload()` RPC.

Tests cover document decoding, inclusive limits, XML/entity rejection, path/symlink boundaries, icon validation and persistence, exact resource mappings, loopback access control, atomic file replacements, deletion/recovery, adapter lifecycle, and browser rendering with non-loopback requests blocked. Browser checks exercise Azure SVGs, legacy Microsoft/Azure stencil loading, and importing mapped resources while preserving diagram bytes.

Asset preparation is an explicit developer operation, not an application-startup side effect:

```sh
npm run assets:prepare
npm run package:extension
npm run package:verify
```

Asset preparation downloads pinned draw.io source and copies a defined set of assets, recording SHA-256 checksums. It also vendors the declared XML parser with its license and checksums so the extension does not depend on root `node_modules` at runtime. Packaging is deterministic and offline, copies runtime code into `canvas-extension/`, checks the decoded vendor bytes against the original checksums, and fails if any file exceeds 1,000,000 bytes or the folder exceeds 5,000,000 bytes. Commit the regenerated install folder alongside source changes. Imported packs count against this same installation budget when included in a regenerated package.

Integrity checks detect local changes; they do not replace review of an upstream update. Review manifests and notices whenever updating dependencies.

The extension folder separates `extension.mjs` (SDK registration), `canvas.mjs` (runtime declaration), `lib/` (provider), `ui/` (renderer), `assets/vendor/` (pinned runtime dependencies), and `assets/icon-packs/` (project imports).

## Distribution and known limitations

Distribute the generated `canvas-extension` folder through the GitHub repository-folder mechanism, preserving all chunks and subdirectories. Do not use the uncompressed source folder with the size-limited installer. Gist sharing is unsupported because the package contains binary compressed chunks.

Automatic app file associations, remote/cloud workspaces, binary `.drawio.png`/`.drawio.svg` import, mathematical typesetting, and arbitrary Microsoft icon sets are outside this version. Supported icon inventory is pinned, not a promise that every future Microsoft resource is present. Use local mappings for gaps.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistribution. No source-code license has been selected for the new integration code; do not infer one from dependency licenses.
