# 3D Interactive Universe Map — Architecture & Math Reference

> Inspired by "When Engineer thinks like Mathematicians 😎" (Developer Rahul)
> Goal: render millions of real galaxies (SDSS) as a navigable 3D point cloud, Earth at origin.

---

## 1. High-Level Pipeline

```
[SDSS SkyServer / CasJobs SQL query]
        ↓  (RA, Dec, redshift z, magnitude, object type)
[Python ETL: Astropy + Pandas]
        ↓  redshift → distance (cosmology)
        ↓  spherical (RA, Dec, D) → Cartesian (X, Y, Z)
[Binary/JSON export: Float32Array of x,y,z (+ color/mag)]
        ↓
[Three.js / WebGL frontend]
        ↓  BufferGeometry + Points, OrbitControls
[Interactive 3D map in browser]
```

Two clean stages: a one-time **offline data pipeline** (Python) that does all the heavy math and produces a static, pre-computed point file, and a **lightweight frontend** (Three.js) that just renders points — no live computation needed in-browser.

---

## 2. Data Source

**Sloan Digital Sky Survey (SDSS)** — the standard free source for this.

- **SkyServer SQL interface**: https://skyserver.sdss.org/dr18/SearchTools/sql — run ADQL/SQL queries directly in browser, download CSV.
- **CasJobs** (https://skyserver.sdss.org/casjobs/) — for larger queries (millions of rows), runs async jobs against the full catalog.
- **Astroquery** (Python package) — query SDSS programmatically without leaving your script.

Fields you need per object:

| Field | Meaning |
|---|---|
| `ra` | Right Ascension (degrees) |
| `dec` | Declination (degrees) |
| `z` | Redshift |
| `petroMag_r` (optional) | brightness, for point size/color |
| `class` | GALAXY / STAR / QSO — filter to GALAXY |

Example SkyServer query (SpecObj table, galaxies with good redshift):
```sql
SELECT TOP 2000000 ra, dec, z, class
FROM SpecObj
WHERE class = 'GALAXY' AND zWarning = 0 AND z > 0
```

---

## 3. The Math

### 3.1 Sky Coordinates → Radians

RA is often given in degrees already on SDSS (0–360°); if you get it in hours (0–24h), convert first:

```
RA_deg = RA_hours × 15
```

Then to radians for trig functions:
```
α (alpha) = RA_deg  × π / 180
δ (delta) = Dec_deg × π / 180
```

### 3.2 Redshift → Distance (the hard part)

You cannot just do `distance = v / H0` (Hubble's law) except for very nearby, low-redshift objects — it breaks down because the universe's expansion rate has changed over cosmic time. You need the **comoving distance** integral from a proper cosmological model (flat ΛCDM):

```
D_C(z) = (c / H0) × ∫[0 to z]  dz' / E(z')

where:
E(z) = √( Ωm(1+z)³ + ΩΛ )
```

- `c` = speed of light (km/s)
- `H0` = Hubble constant (~67–70 km/s/Mpc)
- `Ωm` ≈ 0.3 (matter density parameter)
- `ΩΛ` ≈ 0.7 (dark energy density parameter)

**In practice, don't hand-roll this integral** — use Astropy's built-in cosmology models, which implement exactly this:

```python
from astropy.cosmology import Planck18 as cosmo
distance_mpc = cosmo.comoving_distance(z).value  # in Megaparsecs
```

For a quick-and-dirty low-z approximation (sanity check only, breaks down above z≈0.1):
```
D ≈ c·z / H0
```

### 3.3 Spherical → Cartesian (Earth at origin)

Once you have distance `D` and angles `α`, `δ`:

```
x = D × cos(δ) × cos(α)
y = D × cos(δ) × sin(α)
z = D × sin(δ)
```

This is standard spherical-to-Cartesian conversion, just using astronomical angle names instead of physics-textbook θ/φ. Earth sits at `(0, 0, 0)`.

---

## 4. Tech Stack

**Data pipeline (offline, run once or on refresh):**
- Python 3
- `astropy` — cosmology models, unit handling, coordinate frames (has `SkyCoord` which can do RA/Dec/distance → Cartesian for you directly)
- `astroquery` — pull data straight from SDSS
- `pandas` / `numpy` — vectorized math over millions of rows
- Output: a flat binary file (`Float32Array`) or compressed JSON — NOT a huge verbose JSON with millions of objects; binary is 10-50x smaller and faster to parse.

**Frontend (interactive viewer):**
- `three.js` — `THREE.Points` + `THREE.BufferGeometry` for the point cloud (this is the only way to render millions of points at 60fps — never create millions of individual meshes)
- `OrbitControls` for navigation
- Optional: `THREE.Color` per-vertex for coloring by redshift/distance (e.g. blue=near, red=far)
- Optional: level-of-detail (LOD) or octree spatial partitioning to cull points outside the camera frustum at very large scale

**No backend needed at runtime** — this can be a fully static site (the Python step is a build step, not a server).

---

## 5. Suggested File Structure

```
universe-map/
├── pipeline/
│   ├── fetch_sdss.py        # astroquery pull → raw CSV
│   ├── transform.py         # redshift→distance, spherical→cartesian
│   └── export_binary.py     # writes points.bin (x,y,z,color as Float32)
├── web/
│   ├── index.html
│   ├── main.js               # Three.js scene setup, loads points.bin
│   ├── points.bin            # generated data
│   └── style.css
└── README.md
```

---

## 6. Build Order (step-by-step)

1. Query a small SDSS sample first (~10k galaxies) to validate the math end-to-end.
2. Write `transform.py`: RA/Dec/z → Cartesian using Astropy's `SkyCoord` + `Planck18` cosmology.
3. Export as raw binary `Float32Array` (x, y, z, [optional: r, g, b]).
4. Build a minimal Three.js scene: `BufferGeometry`, `PointsMaterial`, `OrbitControls`, load the binary via `fetch()` + `ArrayBuffer`.
5. Verify visually — you should see a rough "shell" structure since SDSS surveys specific patches of sky, not the whole sphere.
6. Scale up to the full multi-million-row dataset; add performance tuning (point size attenuation, fog for depth cues, frustum culling).
7. Polish: color by redshift (distance), click-to-inspect, search by coordinates, camera fly-through.

---

## 7. Performance Notes for Millions of Points

- Use **one** `BufferGeometry` with a single `Float32Array` position buffer — not one object per galaxy.
- Use `THREE.Points` with a custom shader material if you want size-by-distance or brightness-based rendering (way faster than per-point JS logic).
- Binary transfer format >> JSON for millions of rows (parse time and payload size both drop drastically).
- Consider decimating/sampling the dataset for a "preview" LOD and streaming in higher-density data on zoom.
