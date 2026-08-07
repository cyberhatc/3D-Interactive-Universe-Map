# Universe Map — Features, Realism & Click-Data Spec

> Companion to `3d-universe-map-architecture.md`. This one is about what makes it feel *alive* — detailed, unique, scientifically real, and click-to-explore.

---

## 1. Visual Realism (make it look like real space, not a point cloud demo)

- **Starfield skybox** — a background sphere textured with a real star map (e.g. ESA Gaia all-sky image or a procedural star noise shader) so it doesn't look empty when zoomed out.
- **Milky Way band** — a faint glowing texture band across the sky sphere; grounds the viewer in "we're inside a galaxy too."
- **Bloom / glow post-processing** — Three.js `UnrealBloomPass` on bright points so galaxies feel luminous, not flat dots.
- **Color by redshift** — near galaxies = blue/white, far galaxies = deep red/orange. This is scientifically real (cosmological redshift) AND gives the scene instant depth and beauty.
- **Size by brightness** (`petroMag_r`) — brighter/closer galaxies render as slightly larger points, dimmer ones smaller — adds natural depth cueing.
- **Depth fog** — very distant points fade slightly, reinforcing 3D depth perception (careful: don't fully hide the "great walls"/voids structure).
- **Subtle twinkle shader** — tiny per-point brightness oscillation (sine wave keyed to a random phase per vertex) — makes the field feel alive rather than static.
- **Ambient camera drift** — when idle, slowly auto-rotate/drift the camera; feels like floating, not staring at a frozen chart.

## 2. The "Fall in Love With the Universe" Moments

- **Opening sequence**: start zoomed in tight on Earth/Sun, then a slow pull-back reveal as the full galaxy field fades in — mirrors the actual emotional arc of "here's how small we are."
- **Earth beacon**: a small pulsing marker at the origin labeled "You are here" — the one fixed point of reference in an otherwise incomprehensible scale.
- **Scale narration/UI**: an on-screen readout of current camera distance in escalating human terms — "1,000 light-years... 1 million ly... 1 billion ly" — makes the scale visceral instead of abstract.
- **Guided tour mode**: 3–5 preset camera flythroughs to real structures in the SDSS data — e.g. the *Sloan Great Wall* (a real galaxy supercluster filament) or a cosmic void — with a short caption explaining what's being shown.
- **Ambient audio**: optional low drone/space-ambient soundtrack, muted by default — hugely boosts the "immersive" feeling for very little dev effort.
- **Lookback time framing**: since light takes time to travel, looking at a distant galaxy means seeing its light as it was billions of years ago. Surface this explicitly: *"You're looking 4.2 billion years into the past."* This single fact is usually the moment people feel wonder.

## 3. Click-to-Inspect: How It Works Technically

Raycasting against a `THREE.Points` cloud of millions of vertices naively is slow. Two practical approaches:

**A. Simple raycasting (fine up to ~100k–300k visible points)**
```js
raycaster.params.Points.threshold = 2; // pixel tolerance
const intersects = raycaster.intersectObject(pointsMesh);
const index = intersects[0].index; // vertex index → look up in your data array
```

**B. GPU picking (for millions of points)**
- Render a second, invisible pass where each point's color encodes its index (id) instead of its real color.
- Read back the single pixel under the mouse click via `gl.readPixels`.
- Decode the color back to an index — O(1) regardless of point count.
- This is the standard trick for "click on any of N objects" at scale in WebGL.

Either way: keep a parallel plain-JS array (`galaxyData[i] = {ra, dec, z, objid, ...}`) indexed identically to the position buffer, so a resolved index instantly gives you the full record.

## 4. What to Show When a Galaxy Is Clicked

Pull straight from the fields you already fetched from SDSS, plus a couple of derived values:

| Field | Source | Notes |
|---|---|---|
| SDSS Object ID (`objid`) | SDSS query | unique identifier |
| Right Ascension / Declination | SDSS query | sky position |
| Redshift (z) | SDSS query | raw measured value |
| Comoving distance | derived (Astropy) | in Mpc and converted to light-years |
| Lookback time | derived (Astropy: `cosmo.lookback_time(z)`) | "light left this galaxy X billion years ago" |
| Apparent magnitude (`petroMag_r`, etc.) | SDSS query | brightness as seen from Earth |
| Object class | SDSS query | GALAXY / QSO / STAR |
| **Real image thumbnail** | SDSS SkyServer cutout image service | `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?ra={ra}&dec={dec}&scale=0.4&width=200&height=200` — pulls an actual photo of that patch of sky, huge realism boost |
| Link out | SDSS Explore tool | deep link to `https://skyserver.sdss.org/dr18/VisualTools/explore/summary?objid={objid}` for the curious user to dig further |

This turns every click into a tiny "profile card" for a real, specific galaxy — with an actual photo — rather than just an abstract dot.

## 5. Unique/Differentiating Features (beyond a basic point-cloud viewer)

- **Search bar**: jump camera to a named object or RA/Dec coordinates.
- **Filter/toggle by object type**: galaxies only, quasars only, nearby vs. far.
- **"Cosmic web" highlight mode**: color/opacity boost for filament structures vs. voids, since SDSS data visibly shows this large-scale structure.
- **Time-scrubber**: a slider that fades in galaxies by lookback time — press play and watch the "observable universe" build up outward from Earth as if time is unwinding.
- **Comparison mode**: click two galaxies, show distance between them and light-travel time between clicks.
- **Shareable camera state**: encode camera position/target in the URL so someone can share "look at this exact view."

## 6. Vibe-Coding Notes (keeping AI-generated code sane)

- Keep the **data pipeline output format frozen early** (e.g. a fixed binary layout: x,y,z,color,index) — so you can freely regenerate frontend code without breaking the data contract.
- Ask your AI pair-programmer for **one feature at a time** (e.g. "add GPU picking to this existing Three.js scene") rather than "build the whole app," so each generated chunk is reviewable.
- Keep the **click-data lookup array** and the **render buffer** as separate, clearly-named files/modules — this is the piece most likely to get tangled if generated all at once.
- Cache SDSS cutout images (they're small JPEGs) rather than re-fetching on every click of the same galaxy.
