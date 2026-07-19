# Portfolio site

Plain HTML/CSS/JS, horizontally scrolling, six sections: Hero → About (unlock bio) → ZEPHYR → Baye Fall → Commercial → Contact.

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
