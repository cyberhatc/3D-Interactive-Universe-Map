#!/usr/bin/env python3
"""
Fetch and export the HYG stellar database (real nearby stars) for the Milky Way scene.

Data source: astronexus HYG-Database (hyg_v44) — heliocentric Cartesian XYZ in
parsecs, already in the exact frame the Milky Way scene uses (Sun at origin,
1 unit = 1 pc). This gives real stars within a few thousand light-years,
while the procedural spiral arms supply the galaxy-wide structure.

Download source (codeberg, LFS):
  https://codeberg.org/astronexus/hyg/raw/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz
  (use the LFS "media" URL so curl gets the actual bytes, not the LFS pointer)

Output binary format (mirrors galaxies.bin):
  Header: uint32 = number of stars
  Data:   N * 9 float32 = [x, y, z, r, g, b, size, mag, absmag]
          x/y/z in parsecs (heliocentric), r/g/b in 0..1, size = visual size
          for the shader, mag = apparent magnitude, absmag = absolute magnitude.
"""

import argparse
import gzip
import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HYG_URL = (
    "https://codeberg.org/astronexus/hyg/media/branch/main/"
    "data/hyg/CURRENT/hyg_v44.csv.gz"
)
FLOATS_PER_STAR = 9


def download_hyg(url: str, cache: Path) -> Path:
    """Download (gzipped) HYG CSV to `cache` if it doesn't exist yet."""
    if cache.exists():
        print(f"Using cached data at {cache}")
        return cache
    print(f"Downloading HYG from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "3duniverse-pipeline"})
    with urllib.request.urlopen(req, timeout=300) as resp, open(cache, "wb") as fh:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            fh.write(chunk)
    print(f"Downloaded {cache} ({cache.stat().st_size / 1e6:.1f} MB)")
    return cache


def ballesteros_temperature(bv):
    """B-V color index -> effective temperature (K). Ballesteros (2012) formula."""
    return 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))


def temperature_to_rgb(t_kelvin):
    """Approximate blackbody temperature -> normalized (r, g, b) in 0..1."""
    t = t_kelvin / 100.0
    if t <= 66.0:
        r = 255.0
    else:
        r = 329.698727446 * ((t - 60.0) ** -0.1332047592)
    if t <= 66.0:
        g = 99.4708025861 * math.log(t) - 161.1195681661
    else:
        g = 288.1221695283 * ((t - 60.0) ** -0.0755148492)
    if t >= 66.0:
        b = 255.0
    elif t <= 19.0:
        b = 0.0
    else:
        b = 138.5177312231 * math.log(t - 10.0) - 305.0447927307

    def _clamp(v):
        return max(0.0, min(255.0, v)) / 255.0

    return _clamp(r), _clamp(g), _clamp(b)


def visual_size(absmag):
    """Absolute magnitude -> shader size attribute (bigger = brighter star)."""
    size = 0.4 * 10.0 ** (-0.2 * (absmag - 6.0))
    return float(np.clip(size, 0.3, 6.0))


def build_stars(input_path: Path, max_dist_pc: float, max_points: int, output_path: Path):
    print(f"Reading {input_path} ...")
    if str(input_path).endswith(".gz"):
        with gzip.open(input_path, "rt") as fh:
            df = pd.read_csv(fh)
    else:
        df = pd.read_csv(input_path)
    print(f"Loaded {len(df)} stars")

    # Heliocentric Cartesian XYZ (parsecs). The Milky Way scene uses Sun-at-origin
    # with 1 unit = 1 pc, so we use these coordinates verbatim.
    df = df.dropna(subset=["x", "y", "z", "absmag", "ci"])
    # Skip the Sun itself (id == 0) — a dedicated Sun marker exists in the scene.
    df = df[df["id"] != 0]

    before = len(df)
    df = df[df["dist"] <= max_dist_pc]
    print(f"Filtered to {len(df)} stars within {max_dist_pc} pc (removed {before - len(df)})")

    if max_points and len(df) > max_points:
        # Uniform random sample for performance. HYG is distance-limited
        # (~90% of stars within 840 pc), so the local bubble stays dense.
        df = df.sample(n=max_points, random_state=42)
        print(f"Sampled down to {len(df)} stars")

    colors = np.array(
        [temperature_to_rgb(ballesteros_temperature(bv)) for bv in df["ci"].values],
        dtype=np.float32,
    )
    sizes = np.array([visual_size(a) for a in df["absmag"].values], dtype=np.float32)

    n = len(df)
    data = np.zeros((n, FLOATS_PER_STAR), dtype=np.float32)
    data[:, 0] = df["x"].values.astype(np.float32)
    data[:, 1] = df["y"].values.astype(np.float32)
    data[:, 2] = df["z"].values.astype(np.float32)
    data[:, 3] = colors[:, 0]
    data[:, 4] = colors[:, 1]
    data[:, 5] = colors[:, 2]
    data[:, 6] = sizes
    data[:, 7] = df["mag"].values.astype(np.float32)
    data[:, 8] = df["absmag"].values.astype(np.float32)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as fh:
        np.array([n], dtype=np.uint32).tofile(fh)
        data.flatten().tofile(fh)
    print(f"Exported {n} stars to {output_path} ({output_path.stat().st_size / 1e6:.2f} MB)")

    meta = {
        "count": int(n),
        "floats_per_star": FLOATS_PER_STAR,
        "source": HYG_URL,
        "units": "parsecs, Sun at origin",
        "bounds": {
            "x": [float(df["x"].min()), float(df["x"].max())],
            "y": [float(df["y"].min()), float(df["y"].max())],
            "z": [float(df["z"].min()), float(df["z"].max())],
        },
        "distance_range_pc": [float(df["dist"].min()), float(df["dist"].max())],
    }
    meta_path = output_path.with_suffix(".json")
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"Saved metadata to {meta_path}")


def main():
    parser = argparse.ArgumentParser(description="Fetch & export HYG star data")
    parser.add_argument("--url", type=str, default=HYG_URL, help="HYG gz CSV URL")
    parser.add_argument(
        "--cache", type=Path, default=Path("../data/hyg_v44.csv.gz"), help="Cache path for raw CSV"
    )
    parser.add_argument("--max-dist", type=float, default=1000.0, help="Max heliocentric distance in pc")
    parser.add_argument("--max-points", type=int, default=60000, help="Max stars to export")
    parser.add_argument("--output", type=Path, default=Path("../web/stars.bin"), help="Output binary path")
    args = parser.parse_args()

    cache = download_hyg(args.url, args.cache)
    build_stars(cache, args.max_dist, args.max_points, args.output)


if __name__ == "__main__":
    main()
