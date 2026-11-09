# Local draw.io Canvas viewer

A read-only, offline diagrams.net viewer for local `.drawio`, `.dio`, and compatible `.xml` diagrams, with bundled Microsoft/Azure resources and tracked local icon packs.

## Status

The renderer, local HTTP provider, file watching, icon importing, and Canvas declaration adapter are implemented. **Copilot discovery is not yet enabled:** this environment does not expose the canonical `extensions_manage` scaffolding or `extensions_reload` tools required by the app's authoring workflow. There is deliberately no hand-written `extension.mjs` substitute.

The source is on `implement-drawio-viewer`. No remote repository, user-wide installation, or publishing is configured.

To finish app integration when those tools are available, use the app's `/create-canvas` workflow: read the extension guide, scaffold a project Canvas named `drawio-viewer`, wire the generated entry point to `createDrawioCanvas` exported by `canvas.mjs`, then reload and verify discovery, open, actions, schema validation, reconnect, and close. The adapter expects the runtime's active session working directory. Preserve the existing implementation when scaffolding.

Standalone browser rendering is not a substitute for these runtime checks. The Canvas wire protocol is experimental.

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

Imports write only to:

```text
.github/extensions/drawio-viewer/assets/icon-packs/<pack-name>/
```

Each pack contains its assets and `manifest.json` with checksums, provenance, and explicit aliases. Commit the pack with the project so other users receive the same icons. Existing packs and aliases cannot be silently overwritten. ZIP files, executable content, external SVG references, SVG style attributes, and unsupported formats are rejected. Only use icons whose terms permit their intended use and distribution.

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

Tests cover document decoding, inclusive limits, XML/entity rejection, path/symlink boundaries, icon validation and persistence, exact resource mappings, loopback access control, atomic file replacements, deletion/recovery, adapter lifecycle, and browser rendering with non-loopback requests blocked. Browser checks exercise Azure SVGs, legacy Microsoft/Azure stencil loading, and importing mapped resources while preserving diagram bytes.

Asset preparation is an explicit developer operation, not an application-startup side effect:

```sh
npm run assets:prepare
```

The script downloads pinned draw.io source and copies a defined set of assets, recording SHA-256 checksums. It also vendors the declared XML parser with its license and checksums so the extension does not depend on root `node_modules` at runtime. Integrity checks detect local changes; they do not replace review of an upstream update. Review manifests and notices whenever updating dependencies.

The source layout separates `canvas.mjs` (runtime declaration), `lib/` (provider), `ui/` (renderer), `assets/vendor/` (pinned runtime dependencies), and `assets/icon-packs/` (project imports).

## Distribution and known limitations

Distribute the complete extension folder through a repository/folder mechanism after verifying that mechanism and completing app registration. Do not rely on Gist sharing: the viewer exceeds its documented per-file size limit, and the complete offline resources exceed the total limit.

Automatic app file associations, remote/cloud workspaces, binary `.drawio.png`/`.drawio.svg` import, mathematical typesetting, and arbitrary Microsoft icon sets are outside this version. Supported icon inventory is pinned, not a promise that every future Microsoft resource is present. Use local mappings for gaps.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistribution. No source-code license has been selected for the new integration code; do not infer one from dependency licenses.
