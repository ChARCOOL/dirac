# Architecture board primary-label font

Inter Medium, normal style, weight 500. These are unmodified WOFF2 assets from the pinned [`@fontsource/inter@5.2.5`](https://www.npmjs.com/package/@fontsource/inter/v/5.2.5) distribution, downloaded through jsDelivr. Inter upstream: https://github.com/rsms/inter.

- `inter-latin-500-normal.woff2`: 24,368 bytes
  - Source: https://cdn.jsdelivr.net/npm/@fontsource/inter@5.2.5/files/inter-latin-500-normal.woff2
  - SHA-256: `b0e7558f4710a1e255b93e3deefe3aebb19f3bb41c150f685a74d3b1a1c79e87`
- `inter-latin-ext-500-normal.woff2`: 31,760 bytes
  - Source: https://cdn.jsdelivr.net/npm/@fontsource/inter@5.2.5/files/inter-latin-ext-500-normal.woff2
  - SHA-256: `f2a063e5054e5a4431a1cfe06a1de0f36250a7250c7ac93b6ae33f286c98aedc`
- `LICENSE-Inter.txt`: unmodified SIL Open Font License 1.1 from https://cdn.jsdelivr.net/npm/@fontsource/inter@5.2.5/LICENSE.

`fonts.css` registers the local CSS family alias `Board Inter` with the original Fontsource subset unicode ranges and `font-display: swap`. Import that stylesheet from the board entry or shared typography styles, then use `"Board Inter", system-ui, sans-serif` for primary labels only. Characters outside the bundled Latin/Latin Extended subsets use the fallback fonts; no remote font request is necessary.

Vite's library build inlines these relative font assets as data URLs. The board host and browser smoke fixture permit `font-src data:` specifically for this offline bundle; they do not permit remote font origins. Descriptor typography is intentionally not changed here.
