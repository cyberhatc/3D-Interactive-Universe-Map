# Universe Map — Multi-Scale Zoom: Cosmic Web → Milky Way → Solar System → Earth

> Extends the existing SDSS galaxy map. The core challenge here isn't just "more data" — it's that you're spanning ~13 orders of magnitude in distance (billions of light-years down to kilometers) in one continuous zoom. That breaks normal 3D rendering if you don't plan for it. This doc covers both the data sources and the precision/architecture problem.

**Status:** The four-tier system is **implemented and running** (`web/index.html` → `main-multiscale.js`), plus a **light-speed journey** (Earth → edge of the mapped universe) and **full-sky real galaxies** (2MRS merged with the SDSS wedge). Sections marked ✅ are done; ⏳ mark things that are intentionally deferred (full Gaia DR3, runtime texture streaming).

---

## 1. The Four Scale Tiers

| Tier | Scale | Content | Data source (implemented) |
|---|---|---|---|
| 1 | Gpc – Mpc (billions to millions of ly) | **Full-sky** galaxies with real morphology + **real SDSS photo cutouts** | `galaxies.bin` = SDSS deep wedge **merged with 2MRS full-sky catalog** (`pipeline/fetch_sdss.py` + `pipeline/fetch_2mrs.py` → `pipeline/merge_galaxies.py`) ✅ |
| 2 | kpc – pc (thousands to a few ly) | Milky Way: real nearby stars + procedural spiral arms | `stars.bin` (HYG v44, `pipeline/fetch_hyg.py`) + procedural disk/arms ✅ |
| 3 | AU (light-minutes to light-hours) | Solar System: Sun, planets, orbits, Voyager 1 | Kepler orbital elements (J2000) computed in-browser ✅ |
| 4 | km – planet surface | Individual planet detail: size, composition, texture | NASA fact-sheet constants + Solar System Scope textures ✅ |

You render these as **separate layers that swap in/out by camera distance**, not one giant unified point cloud — explained in Section 5.

---

## 2. What Is Actually Implemented (vs. planned)

### 2.1 Rendering architecture — ONE shared camera, four scenes
- A **single `THREE.PerspectiveCamera`** (`near 0.1, far 1e7`, `logarithmicDepthBuffer: true`) renders **every** scene. `web/scenes/SceneManager.js` + `CrossfadeRenderer.js` crossfade between scenes by rendering both layers with the same camera and mixing the pixels.
- Because the vantage point is identical, the crossfade reads as a **true continuous zoom**, and `OrbitControls` never needs rebinding. This is the practical version of the "separate scenes, independent cameras" idea from older drafts — the doc's "scene swap with a smooth camera animation" from Section 5.
- **Why this defeats the precision problem:** each scene keeps its own **coordinate origin** (Earth / Sun / Sun / planet) and its own **unit scale** (Mpc / pc / 0.005 AU / km). The numeric camera position is shared, but its *interpretation* changes per scene. So zooming "past Neptune" (say camera at `(0,0,40000)` = 200 AU) smoothly hands over to the Milky Way layer where the same number is 40 kpc out in the disk. No scene ever needs float precision beyond ~5 orders of magnitude.

### 2.2 Tier 1 — Cosmic Web (full-sky real galaxies) ✅
- Pipeline: `pipeline/fetch_sdss.py` + `pipeline/fetch_2mrs.py` → `pipeline/merge_galaxies.py` (was `transform.py` → `export_binary.py`).
- `galaxies.bin`: header `uint32 count`, then `count × 15 float32` = `[x, y, z, r, g, b, size, ra, dec, redshift, morph, survey, brightness, b_a, mag]`.
  - `x/y/z` = comoving Cartesian Mpc (Planck18), Earth at origin.
  - `size` = physical radius (Mpc); `morph` = 0 elliptical / 1 S0 / 2 spiral / 3 irregular; `survey` = 0 SDSS / 1 2MRS; `b_a` = axis ratio; `mag` = apparent magnitude (petroMag_r / Ks).
- **Full sky (2026 fix):** SDSS alone was a narrow deep wedge. The **2MRS catalog** (Huchra et al. 2012, Ks ≤ 11.75, z < 0.17, ~44k galaxies with real ZCAT T-type morphology) fills the whole sky. SDSS galaxies within 5″ of a 2MRS match are dropped (896 removed) → **142,611 galaxies**, redshift range 0.000007–0.50.
- **Physical sizes (2025 fix):** `size` is a physical radius derived from magnitude/radius (`L ∝ 10^(-0.4m)`, isophotal angular size × distance for 2MRS), clamped 0.005–10 Mpc. The vertex shader projects it to true angular size:
  ```glsl
  float pointSize = size * uScale / max(-mvPosition.z, 1.0);
  ```
  No double-distance-division bug; distant galaxies are correctly sub-pixel while a nearby large galaxy resolves to ~100 px.
- **Morphology atlas shader:** each galaxy renders from a 4-cell canvas texture atlas (elliptical / S0 / spiral / irregular) with drawn spiral arms and irregular clumps, a per-galaxy hash rotation, and axis-ratio flattening from `b_a` — real galaxies read as galaxies, not dots.
- **Real SDSS photos:** for the brightest SDSS galaxies near the camera, the scene fetches **live DR18 cutouts** (`skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg`) as cross-origin `Image` textures (pool of 8 sprites, faded out once the camera flies past). If CORS/offline blocks a cutout, a DOM fallback card (`#galaxy-photo`) shows it instead.
- `web/scenes/CosmicWebScene.js` owns the layer: starfield, pulsing Earth marker at origin, axes, near/far distance filters (`setFilter`), and a light-speed wave sphere (`startLightWave`/`stopLightWave`) driven by `updateWave(dt)`.

### 2.3 Tier 2 — Milky Way & nearby stars ✅
- **Real stars from the HYG database** (`pipeline/fetch_hyg.py`): downloads `hyg_v44` from `codeberg.org/astronexus/hyg` (LFS media URL), filters to heliocentric distance ≤ 1000 pc, samples to ≤ 60,000 stars, computes per-star RGB from the B–V color index (Ballesteros temperature → blackbody RGB) and visual size from absolute magnitude.
- `stars.bin`: header `uint32 count`, then `count × 9 float32` = `[x, y, z, r, g, b, size, mag, absmag]`, **heliocentric parsecs** (Sun at origin).
- **Scene layout (Sun-centered):** the Sun is at the origin; the **galactic center** is placed at `(-8200, 0, -20)` pc. The procedural exponential disk, log-spiral arms (pitch ~12°, calibrated to Reid et al.), and bulge are all generated around the galactic center, while the real HYG stars occupy the local bubble. 1 scene unit = 1 pc.
- **Realistic Milky Way look (added):** the arms carry **density clumping** (young blue O/B stars concentrated in HII associations along each arm, redder populations between), a **central bar** (~4 kpc elongated stellar bar) is generated in `createCentralBar()`, the bulge uses a warm mottled `createGalaxyCore()` shader, and `createDustLanes()` scatters dark interstellar dust through the disk plane so the galaxy reads as a real barred spiral rather than a uniform point soup.
- **Why not full Gaia yet (⏳):** Gaia DR3 is the gold standard (~1.8B stars) but is a much larger pipeline task. HYG gives real, correct nearby stars today; Gaia density can be layered in later by swapping `fetch_hyg.py` for a `fetch_gaia.py` with the same 9-float output format. The spiral arms remain procedural because no complete star census exists for the whole galaxy — even for professional astronomers.

### 2.4 Tier 3 — Solar System (Kepler orbital mechanics) ✅
- No external API needed at runtime: `web/scenes/SolarSystemScene.js` solves **Kepler's equation** (Newton–Raphson) from J2000 heliocentric ecliptic elements (a, e, i, Ω, ω, M₀) and rotates the perifocal frame into 3D. Verified numerically: Earth ≈ 1.014 AU, Jupiter ≈ 5.29 AU, Neptune ≈ 29.9 AU today, and the orbits stay bounded over ±1000 years.
- **Real planet textures:** each planet now streams its real surface map from Solar System Scope (CC BY 4.0) — Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, plus a textured **Sun**. A flat-color `MeshStandardMaterial` remains as the fallback if offline/CORS blocks the fetch.
- **Saturn's rings** use a procedural canvas texture with the real band structure: bright A ring, dark Cassini division, bright B ring.
- Time scale slider advances the Julian Date (`daysPerSecond`, default 2); planets visibly move.
- **Voyager 1 marker** ("farthest human reach"): a **live JPL Horizons query** (`COMMAND=-31`, `CENTER=500@10`) is attempted at startup; if CORS/offline blocks it, the distance falls back to an analytic drift from the 2026 reference (≈ 171.3 AU, +3.56 AU/yr). The marker and a faint trajectory line reach ~171 AU = 34,200 scene units (solar far plane is 40,000).
- Planet meshes and labels are clickable → fly to that planet's detailed view (Tier 4).

### 2.5 Tier 4 — Planet detail ✅
- `web/scenes/PlanetScene.js`: physical radius (km), rotation period, axial tilt, real surface textures from **Solar System Scope** (CC BY 4.0) with a plain-color fallback, plus per-planet atmosphere glow (Earth/Venus/Mars), Moon for Earth, Saturn's rings.
- **Sun included:** `PlanetScene` supports a Sun detail view (emissive `MeshBasicMaterial`, no light-driven shading). Click the Sun in the Solar System view to open it.
- **Bug fixed:** the atmosphere was previously never created (checked a nonexistent `name` field). It now keys off the planet name and gets a per-planet color.

### 2.6 Light-speed journey (Earth → edge of the mapped universe) ✅
- `web/JourneyController.js`: a **strict light-speed** flight — the camera's distance from Earth `L` **is** the light-travel time, so the view always shows exactly what light arriving "now" at Earth would look like (lookback time = distance in ly). Camera orientation starts looking back at Earth, then takes the chosen direction (Andromeda / Galactic Center / Sloan Great Wall / northern sky / current view).
- **Zones** (see `ZONES`): planet `<4.5e-8 ly`, solar `<0.01 ly`, milky `<104,371 ly` (32 kpc), cosmic `<6.35e9 ly` (~1946 Mpc). Each zone renders with its own scene-unit scale (km / 0.005-AU / pc / Mpc) and **adaptive near/far** (near = `L×1e-4`, far = `L×1e3`), so the same flight camera crosses from the Earth's surface to the edge of the galaxy web without precision loss.
- **Cruise = exponential zoom:** speed = `CRUISE_K × L` (K = 0.55/s), so the whole flight takes ~90 s and each scale gets roughly equal screen time; the HUD always reports the true speed (1 s = X ly) and light-time distance.
- **Manual time control:** pause/resume (or Space), and a log-scale speed slider (10⁻⁹ → 10¹⁰ ly/s). At 1 s = 1 ly you are at true light speed.
- **UI:** `#journey-hud` (zone label, light-time text, speed), Start/Pause/Cruise/Exit buttons, direction select. The app auto-crossfades scenes at zone boundaries (`requestTransition`), and reaches the edge of the 2MRS+SDSS map at ~6.35 Gly.

---

## 3. Data Sources Per Tier

### Tier 1 — SDSS + 2MRS (see `docs/3d-universe-map-architecture.md`)
- **SDSS SkyServer / CasJobs** — the existing pipeline fetches ~100k galaxies with RA, Dec, redshift, Petrosian magnitude (`pipeline/fetch_sdss.py`), forming the deep z ≤ 0.5 wedge.
- **2MRS (Two Micron All Sky Redshift Survey)** — `pipeline/fetch_2mrs.py` downloads the **full-sky** catalog (43,507 galaxies, Ks ≤ 11.75, z < 0.17) via the **HEASARC Xamin TAP** service (the CDS VizieR mirror is blocked by an anti-bot page):
  ```python
  POST https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync
  QUERY = SELECT name, ra, dec, ks_mag_0, ... , radial_velocity FROM twomassrsc
  ```
  The response is a VOTable with BINARY (base64) encoding — parse with `astropy.io.votable.parse(io.BytesIO(raw))` (not `pd.read_xml`). Includes real ZCAT T-type morphology (→ elliptical/S0/spiral/irregular), J/H/Ks magnitudes, and isophotal radii.

### Tier 2 — Milky Way
- **HYG database** (`pipeline/fetch_hyg.py`): the maintained catalog (formerly `astronexus/HYG-Database`, now `codeberg.org/astronexus/hyg`), ~119k stars already in heliocentric XYZ **parsecs** — the exact frame the scene uses.
- **Gaia DR3 (⏳ planned):** `astroquery.gaia`:
  ```python
  from astroquery.gaia import Gaia
  job = Gaia.launch_job("SELECT TOP 500000 ra, dec, parallax, phot_g_mean_mag "
                         "FROM gaiadr3.gaia_source WHERE parallax > 0")
  ```
  Convert parallax → distance (`d[pc] = 1000 / parallax_mas`) and galactic coordinates → Cartesian, then export the same 9-float `stars.bin` format.
- **Procedural spiral arms:** log-spiral function, pitch ~12°, calibrated to maser-parallax studies (Reid et al.). The arms are centered on the galactic center and pass through the Sun's location (the "Orion/Local arm"), which is physically correct.

### Tier 3 — Solar System
- **JPL Horizons** is used *optionally* for the live Voyager 1 distance:
  `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND=-31&...&CENTER=500@10`
  (JSON, `RG=` = heliocentric range in km). Browser CORS blocks it, so it's best-effort with the analytic fallback described above. If you want *date-accurate planet positions*, add a Python `fetch_horizons.py` that snapshots planet vectors into a JSON the scene can load — the Kepler elements are approximate (good to ~0.1°).
- **Outermost human-reached point:** Voyager 1, ~171+ AU and climbing. It doubles as the literal "edge of exploration" marker.

### Tier 4 — Planet Detail
- Constants sourced from **NASA Planetary Fact Sheet**; textures from **Solar System Scope** (`solarsystemscope.com/textures`, CC BY 4.0). Fallback colored spheres if offline.

---

## 4. The Math (implemented in-browser)

### 4.1 Parallax → Distance (for a future Gaia pipeline)
```
distance (pc) = 1000 / parallax_mas
```

### 4.2 Kepler Position from Orbital Elements (used by Tier 3) ✅
Given (a, e, i, Ω, ω, M₀) at epoch J2000:
1. Mean anomaly: `M = M₀ + n(t − t₀)`, with `n = 2π / (a^1.5 · 365.25636)` rad/day.
2. Solve Kepler's equation iteratively: `M = E − e·sin E` (Newton–Raphson).
3. True anomaly: `tan(ν/2) = √((1+e)/(1−e)) · tan(E/2)`; distance `r = a(1 − e·cos E)`.
4. Perifocal → heliocentric ecliptic rotation by Ω, i, ω (implemented as the standard 3-axis Euler sequence).

### 4.3 Star Color from B–V (used by `fetch_hyg.py`)
Ballesteros (2012) temperature, then a blackbody → RGB fit:
```
T = 4600 · ( 1/(0.92·(B−V)+1.7) + 1/(0.92·(B−V)+0.62) )     [K]
```

---

## 5. Zoom / Transition Architecture (as built)

```
Scene A: Cosmic Web (SDSS layer, Mpc)          near/far 0.1 – 1e7 (shared camera)
   ↓ crossfade when camera < ~100 Mpc from Earth
Scene B: Milky Way (HYG stars + arms, pc)      Sun at origin, GC at (-8200,0,-20)
   ↓ crossfade when camera < ~50 kpc from Sun
Scene C: Solar System (Kepler orbits, 0.005 AU/unit)
   ↓ click a planet (or Planet button)
Scene D: Planet close-up (km)
```

The thresholds live in `SCALE_THRESHOLDS` in `web/main-multiscale.js` (`cosmicToMilkyWay: 100`, `milkyWayToSolar: 50000`, `solarToPlanet: 200000`). All layers render with the **same shared camera**, so each transition is a pixel crossfade of the identical view — no jump cut. Zooming back out inverts the chain (planet → solar at >200,000 units, solar → milky at >100,000, milky → cosmic at >300 units). Entry poses were chosen to avoid transition cascades (e.g. re-entering the Milky Way lands ~4 kpc from the Sun, well inside the disk). **The light-speed journey (Section 2.6) drives the same scene-swap chain automatically by light-time distance.**

---

## 6. Build Order — status

1. ✅ Tier 3 (solar system) — smallest dataset, validated the Kepler math + scale-layer architecture.
2. ✅ Planet textures, rotation, axial tilt (Tier 4), including the Sun detail view.
3. ✅ Voyager 1 marker with live Horizons distance + analytic fallback.
4. ✅ Tier 2 with the HYG database (small, already XYZ parsecs) — validated the Milky Way scene.
5. ✅ Procedural spiral-arm shape + central bar + dust lanes for a realistic barred-spiral Milky Way.
6. ✅ The crossfade transition points wired between the four scenes (shared camera).
7. ✅ Tier 1 full sky: 2MRS merged with the SDSS wedge (142,611 galaxies), morphology atlas shader, real SDSS photo cutouts.
8. ✅ Light-speed journey (JourneyController): Earth → edge of the mapped universe with user-controlled time.
9. ⏳ Optimization/deferred: full Gaia DR3 density, moons/rings on more planets, date-accurate Horizons snapshots, level-of-detail streaming for SDSS.

---

## 7. Running It

```
# regenerate/refresh data (2MRS + SDSS + HYG stars)
cd pipeline && python3 run_pipeline.py

# serve the static site
cd web && python3 -m http.server 8080
# open http://localhost:8080
```

Pipeline outputs:
- `web/galaxies.bin` + `web/galaxies.json` (Tier 1, 15 floats/galaxy, 142,611 galaxies)
- `web/stars.bin` + `web/stars.json` (Tier 2, 9 floats/star, parsecs)
- `data/raw_2mrs.csv` (2MRS, from HEASARC TAP), `data/galaxies_merged.parquet`

Controls: drag = orbit, wheel = zoom, `1`–`4` = jump scale, click a planet (or its label) in the Solar System view to fly to its detail view, "Light Speed Wave" expands the light sphere in the cosmic view (toggle to stop), the time slider accelerates the solar-system clock. **Start Journey** begins the light-speed flight from Earth (pause/Space, cruise, and the log-speed slider give you manual time control).
