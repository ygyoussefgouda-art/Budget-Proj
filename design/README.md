# Design folder

Put pictures here for Claude to look at and use. Nothing in this folder is built into the app or the Docker image.

| Folder | What to put in it |
|---|---|
| `inbox/` | New pictures to use: screenshots of apps you like, logos, icons, photos, colour ideas. Any file name is fine. Add a short note next to an image (e.g. `logo.png` + `logo.txt`) if you want something specific done with it. |
| `references/` | Design references already used for the current look (`reference-1.jpeg`: dark expense tracker with a donut; `reference-2.jpeg`: budget tiles with progress rings). |

When you add something, tell Claude "check the design inbox". Claude will look at the images, apply them to the app (theme colours, logo, icons) and move the used ones to `references/`.

## Screenshots

`screenshots/` has presentation pictures of the app (phone size, dark, light and Arabic) and `overview.png` (a 16:9 slide).
They are made with demo data by `scripts/screenshots.mjs`: build the web app (`cd web` then `npm run build`), then run
`node scripts/screenshots.mjs` from the repo root. It starts its own empty copy of the app on port 3200, so your data is never touched.
