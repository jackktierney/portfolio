# Portfolio site

Plain HTML/CSS/JS, horizontally scrolling, six sections: Hero → About (unlock bio) → ZEPHYR → Baye Fall → Commercial → Contact.

## Editing with the Site Editor app

The easiest way to edit this site — add/remove category and project pages, drop in and reorder images, pick background colours, edit the about/contact text and project credits — is the offline editor in `editor/`. It reads and writes your files directly; nothing is uploaded anywhere.

**Requires a Chromium-based browser** (Helium, Chrome, Edge, Brave — not Safari or Firefox, which don't support the folder-saving feature it relies on).

1. Start a local server from this folder (needed so the browser will grant folder access — just opening the file directly with `file://` won't work):
   ```
   python3 -m http.server 8642
   ```
2. In Helium/Chrome, go to `http://localhost:8642/editor/editor.html`.
3. Click **Open website folder…** and pick this folder (the one with `index.html` and `content.json` in it).
4. Edit pages from the sidebar. Click **Save & Rebuild** to write your changes back — this updates `content.json` and regenerates every `.html` page and `js/script.js` to match.

Everything the editor knows about your site — every page's text, colours, images, and how projects link together — lives in `content.json`. The actual `.html` files are *generated* from it, so avoid hand-editing them directly once you're using the editor (your hand-edits would get overwritten on the next Save & Rebuild). `css/style.css` and the fonts in `assets/fonts/` aren't touched by the editor — keep editing those by hand as usual.

## View it locally
Open `index.html` directly in a browser, or for the most accurate preview run a local server from this folder:
```
python3 -m http.server 8000
```
then visit `http://localhost:8000`.

## Editing content
- **Text**: edit directly in `index.html` — every placeholder (`Your Name`, bio copy, project descriptions, client names, email, social links) is plain text/HTML.
- **Hero image**: in `index.html`, find `.hero-image` and either drop a file at `assets/images/hero.jpg`, or change the `url('assets/images/hero.jpg')` to any image link.
- **ZEPHYR / Baye Fall layouts**: currently a placeholder 3-column grid (`.grid-item`) in `index.html` under `id="zephyr"` / `id="bayefall"`. Once you send the real layout images, these grids get rebuilt to match — for now, swap the dashed placeholder boxes for `<img>` tags or background images the same way as the hero.
- **Commercial thumbnails**: same pattern, inside `.commercial-thumb` divs.
- **Colors/fonts**: all in `css/style.css` under the `:root` variables at the top (`--bg`, `--fg`, `--accent`, `--font-display`, `--font-body`).

## Navigation
- Vertical mouse wheel / trackpad scroll is translated into horizontal movement (`js/script.js`).
- Right-hand dots jump to any section; the active one highlights automatically.
- Left/Right arrow keys also work.
