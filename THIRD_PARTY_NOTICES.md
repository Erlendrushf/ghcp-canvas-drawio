# Third-party runtime resources

## diagrams.net / draw.io

Source: <https://github.com/jgraph/drawio>

Pinned commit: `c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3`

The original root Apache-2.0 license is retained at `.github/extensions/drawio-viewer/assets/vendor/drawio/LICENSE`. In the compact `canvas-extension` install folder, this license and the image/shape/stencil notices are retained as plain files under `assets/vendor/drawio/` as well as inside the lossless vendor bundle.

Additional original notices are retained under `img/LICENSE`, `shapes/LICENSE`, and `stencils/LICENSE` within that vendor directory. They include restrictions relating to using the icon/stencil assets in Atlassian products and its marketplace ecosystem. The root Apache license alone is not a complete statement of every asset's terms.

Runtime files are copied unmodified from the pinned source. Configuration and integration code are separate. The vendor manifest records every shipped file's checksum.

Microsoft product names and icons remain their owners' property. Official Microsoft Azure icon guidance and terms: <https://learn.microsoft.com/en-us/azure/architecture/icons/>. Microsoft permits specified uses in architecture diagrams, training, and documentation and reserves other rights; review the applicable terms for the actual assets and intended distribution. Do not imply Microsoft or diagrams.net endorsement.

## xmldom

Source: <https://github.com/xmldom/xmldom>

Package: `@xmldom/xmldom` version `0.9.12`

The package's original license is retained at `.github/extensions/drawio-viewer/assets/vendor/xmldom/LICENSE` and, in the compact installation, `assets/vendor/xmldom/LICENSE`. Its unmodified runtime library and package metadata are vendored, with a checksum manifest.

## Development dependencies and imports

Playwright is used only for development/browser validation; consult the installed package's Apache-2.0 license and third-party notices when distributing that tooling. It is not bundled as an extension runtime dependency.

User-imported icon packs retain supplied source/rights information in each pack's manifest. That field records provenance; it does not grant rights or constitute legal approval. Review imported assets before committing or publishing.

No code from the GPL-3.0 VS Code draw.io integration has been copied into this integration.
