# Portfolio site — design spec (draft v1)

Status: **draft, not yet approved**. Open questions are marked ❓ throughout and collected again at the bottom. Nothing here gets built for real until this doc is signed off.

---

## 1. Concept & tone

Lo-fi, analog, personal-web. Minimal and image-led — the photography does the talking, UI chrome stays small and gets out of the way. Feels handmade: a scanned notebook / zine, not an agency portfolio.

Reference points:
- **[fearoffun.neocities.org](https://fearoffun.neocities.org/)** — the primary structural/typographic reference (see breakdown below)
- **DAZED** — editorial minimalism, confident use of white/negative space
- **La Haine** poster grid — 3×3 photo grid with a title card dropped into the dead-center cell (see attached image)
- Hand-drawn artwork, e.g. *The Hermit* (Mountain Ash Band) — informs the hand-written-title direction
- Woodland / analog colour photography (the images you sent) — sets the palette

---

## 2. What we're borrowing from fearoffun.neocities.org

Pulled directly from the site's source:

- **Layout**: single narrow centered column, fixed width (~500px desktop), everything centered. No sidebars, no wide multi-column grids outside the art grid.
- **Type**: a tiny (12px) custom bitmap font (`Greybeard-18px.ttf`) with `ms gothic` / generic sans-serif fallback. Body text is genuinely small — this is a deliberate "old internet" cue, not an accessibility oversight.
- **Colour**: one flat muted background colour per site (their moss green `#4a4e42` + cream text `#e8e5cc`), not white. The whole page is tinted.
- **Page load**: body fades in from `opacity: 0` over 1s — soft, not flashy.
- **Image grid**: `.art-grid` — thumbnails in a plain CSS grid, tight, no captions. Hover = slight rotation + grayscale/contrast shift.
- **Links**: dotted underline, not solid.
- **Nav**: a single row of text links separated by a glyph (🞶), collapsing to a `<select>` dropdown on mobile.
- **Home page trick**: a solid-colour placeholder block (`#img-load`) sits in the DOM immediately; JS then picks a random image from a hardcoded array and injects it. This is *why* the homepage has a "flash" quality — you see the flat colour block for a beat before the photo pops in.

This last point is a good mechanical basis for the "e-reader refresh" transition you described — more on that in §7.

---

## 3. What we're borrowing from the La Haine grid

- 8 photographic stills in a 3×3 grid, title card in the exact center cell.
- Images butt up against each other — no gutters, no borders, no captions on the images themselves.
- The title card in the reference uses a bold, interlocking cropped wordmark. In our case the equivalent will be **your hand-written title**, supplied as an image.

---

## 4. Site structure

❓ **Needs confirmation — see open questions.** Working assumption based on your message:

| Page | Purpose |
|---|---|
| Landing | Single rotating image (from your colour set) + links below it |
| *Bio/About* | ❓ status unclear post-pivot — see Q1 |
| ZEPHYR | Project page, 3×3 grid template |
| Baye Fall | Project page, 3×3 grid template |
| Commercial | ❓ format unclear — see Q2 |
| Contact | Single rotating image (from your b&w set) + email/Instagram links below it |

No horizontal scroll. Each page is its own page, navigated via a small text-link nav (fearoffun-style), not a continuous scroll.

---

## 5. Page specs

### Landing
- One image, centered, chosen at random (or in sequence — ❓ Q3) from your supplied **colour** photo set on every load — same mechanism as fearoffun's `img-load` trick.
- Below the image: text links to the other pages.
- This page sets the site's colour mood — warm, analog, woodland.

### Contact
- Same pattern as Landing, but pulling from your **black & white** photo set instead.
- Links below: `mailto:` email address, Instagram.
- No form. No other content.

### Project pages (ZEPHYR, Baye Fall)
- 3×3 grid, 8 photos + center cell.
- Center cell contains:
  - **Title** — your hand-written title, image asset (not web type)
  - **ROLE:** — plain text, your role on the project
  - **WATCH** — click opens a popup/modal with an embedded video
  - **ABOUT** — click opens a popup/modal with project description text
  - **CREDITS** — click opens a popup/modal with credits list
- Popups: small centered modal box, same muted/dotted-underline visual language as the rest of the site — not a generic white lightbox. ❓ Q4 confirms exact treatment.
- Grid should ideally fit without page scroll — depends on your actual image aspect ratios, will need real assets to finalize.

### Commercial
❓ Q2 — same 3×3 template repeated per client, or a running list/grid of thumbnails linking out? Need your call before this can be specced properly.

---

## 6. Typography

Two directions, both prototyped in `spec-tests/prototype.html` — see §8:

- **Option A — Pixel/bitmap**, closest to fearoffun's actual font. Tiny, mono, deliberately "old internet." Prototype uses VT323 (free, similar spirit to Greybeard) as a stand-in — final build could use a licensed/custom bitmap font if you have one in mind.
- **Option B — Typewriter**, mechanical/manuscript feel, more legible at larger sizes, closer to a "field notes" or zine aesthetic than "old website" aesthetic. Prototype uses Special Elite.

Hand-written titles are **always image assets** in your own handwriting, regardless of which body font wins — never rendered in a web font.

❓ Q5 — pick a direction (or a third option) after looking at the prototype.

---

## 7. Colour

- Background colour shifts per page to sit well against whichever images are showing, same principle as fearoffun's single moss-green field but applied per-section instead of site-wide.
- Palette source:
  - Colour photo set → Landing + project pages
  - B&W photo set → Contact (rendered as muted charcoal/grey field, not true black)
- Until real images are supplied, spec assumes a muted woodland palette: moss, bark brown, dusk grey, cream/paper, one warm amber accent. Exact hex values get locked once your photos are in hand — ideally I'll pull them algorithmically from the actual images rather than eyeballing. ❓ Q6.

---

## 8. Texture & motion

- **Film grain**: a subtle, fixed full-viewport noise overlay across the entire site, low opacity, blended over everything. Prototyped in `spec-tests/prototype.html`.
- **Page transition ("e-reader flash")**: a brief flash/invert + redraw stutter on navigation between pages, mimicking an e-ink screen refresh. Prototyped as a working demo — two mock pages you can flip between to see the effect in `spec-tests/prototype.html`.
- **Image hover** (grid thumbnails): slight rotation + grayscale/contrast shift on hover, matching fearoffun's `.artwork img:hover` treatment.

---

## 9. Content & assets you'll provide

- [ ] Colour photo set → Landing page rotation (basis for warm/woodland palette)
- [ ] B&W photo set → Contact page rotation
- [ ] ZEPHYR: 8 grid images, hand-written title (image), role text, video for WATCH, about copy, credits
- [ ] Baye Fall: same as above
- [ ] Commercial: assets TBD pending Q2
- [ ] Email address + Instagram handle for Contact page

---

## 10. Open questions

1. **Bio/About** — does a dedicated bio page still exist in this pivot, and if so where does it live (own nav item, folded into Landing, dropped entirely)? The earlier "unlock" padlock interaction was designed for the old horizontal-scroll build — keep the idea (reskinned to fit this lo-fi aesthetic), or drop it now that the concept has moved to a fearoffun-style multi-page site?
2. **Commercial page** — same 3×3-grid-per-client template as ZEPHYR/Baye Fall, or a simpler running grid/list of client thumbnails?
3. **Landing/Contact image rotation** — random on every load (like fearoffun), or a fixed sequence/slideshow that advances on a timer or click?
4. **Popup style for WATCH/ABOUT/CREDITS** — small dotted-border modal box (closest to fearoffun's own visual language), full-bleed takeover, or an inline `<details>`-style expand-in-place (also used on fearoffun) instead of a popup?
5. **Typography direction** — Option A (pixel/bitmap) or Option B (typewriter)? See prototype.
6. **Colour approach** — should I hand-pick a muted palette to complement your photos, or algorithmically extract dominant/muted tones per image so backgrounds shift with whichever photo is showing?

---

## 11. Prototype

`spec-tests/prototype.html` is a working, self-contained test file (open directly in a browser, no server needed) covering:
- Font comparison (Option A vs Option B)
- Film grain overlay
- 3×3 grid template with center text block + working WATCH/ABOUT/CREDITS popups
- E-reader flash page transition (click between two mock pages)

Placeholder colour blocks stand in for real photography until your image sets are supplied.
