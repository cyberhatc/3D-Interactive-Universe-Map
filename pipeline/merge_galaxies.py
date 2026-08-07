#!/usr/bin/env python3
"""
Merge the two real galaxy catalogs (SDSS deep wedge + 2MRS full sky) into one
universe map dataset, then export the WebGL binary.

Catalogs
--------
- SDSS (raw_galaxies.csv): deep spectroscopic wedge, z <= 0.5, ~100k galaxies.
- 2MRS (raw_2mrs.csv): full-sky, Ks<=11.75, z < 0.17, ~44k galaxies with real
  morphological types (ZCAT T-type), J/H/Ks magnitudes and isophotal radii.

All distances use the same Planck18 cosmology so both catalogs live in one
consistent Cartesian frame (Earth at origin, 1 unit = 1 Mpc).

Binary format (float32, per galaxy):
  Header: uint32 = count
  Data:   N * 15 floats = [x, y, z, r, g, b, size, ra, dec, redshift,
                           morph, survey, brightness, b_a, mag]
    x/y/z      : Cartesian position (Mpc)
    r/g/b      : render color (0..1) — redshift-based hue * brightness
    size       : physical radius (Mpc) — shader renders angular size = size/dist
    ra/dec     : J2000 degrees (for live SDSS cutout lookups)
    redshift   : cosmological redshift
    morph      : 0 = elliptical, 1 = S0, 2 = spiral, 3 = irregular
    survey     : 0 = SDSS, 1 = 2MRS
    brightness : 0..1 normalized apparent brightness (for alpha/size)
    b_a        : axis ratio (0..1)
    mag        : apparent magnitude (petroMag_r / Ks)
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.cosmology import Planck18 as cosmo

FLOATS_PER_GALAXY = 15

MORPH_ELLIPTICAL = 0
MORPH_S0 = 1
MORPH_SPIRAL = 2
MORPH_IRREGULAR = 3


def cartesian(ra_deg, dec_deg, z):
    coords = SkyCoord(
        ra=ra_deg * u.deg, dec=dec_deg * u.deg,
        distance=cosmo.comoving_distance(z), frame="icrs",
    )
    c = coords.cartesian
    return (c.x.value, c.y.value, c.z.value, coords.distance.value)


def redshift_color(z, z_max):
    """Cosmological redshift hue (blue-white -> warm -> red) in 0..1 RGB."""
    t = min(1.0, z / max(z_max, 0.1))
    stops = [
        (0.00, (0.92, 0.95, 1.00)),
        (0.15, (1.00, 0.95, 0.88)),
        (0.35, (1.00, 0.78, 0.55)),
        (0.55, (1.00, 0.55, 0.35)),
        (0.80, (1.00, 0.40, 0.30)),
        (1.00, (0.95, 0.30, 0.30)),
    ]
    for i in range(len(stops) - 1):
        a, ca = stops[i]
        b, cb = stops[i + 1]
        if t <= b:
            s = (t - a) / max(b - a, 1e-6)
            return tuple(ca[j] + (cb[j] - ca[j]) * s for j in range(3))
    return stops[-1][1]


def ttype_to_morph(ctype):
    """ZCAT T-type string -> morphology index."""
    if not isinstance(ctype, str) or len(ctype) == 0:
        return MORPH_SPIRAL
    try:
        t = int(ctype[:2].strip() or ctype[0])
    except (ValueError, IndexError):
        return MORPH_SPIRAL
    if t <= -4:
        return MORPH_ELLIPTICAL
    if t <= 0:
        return MORPH_S0
    if t <= 8:
        return MORPH_SPIRAL
    if t <= 12:
        return MORPH_IRREGULAR
    if t in (15, 16, 19, 20, 98):
        return MORPH_SPIRAL
    return MORPH_SPIRAL


def load_sdss(path: Path, use_extra: bool) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df[df["z"] > 0]
    print(f"SDSS: {len(df)} galaxies")

    x, y, z, dist = cartesian(df["ra"].values, df["dec"].values, df["z"].values)
    out = pd.DataFrame({
        "ra": df["ra"].values, "dec": df["dec"].values, "z": df["z"].values,
        "x": x, "y": y, "pos_z": z, "dist": dist,
    })

    mag = df["petroMag_r"].values.astype(float)
    lum = 10.0 ** (-0.4 * (mag - np.nanmin(mag)))
    out["size"] = np.clip(np.sqrt(lum) * 0.5, 0.02, 5.0)

    if use_extra and {"deVAB_r", "expAB_r"}.issubset(df.columns):
        dev = df["deVAB_r"].fillna(0.5).values.astype(float)
        out["morph"] = np.where(dev >= 0.6, MORPH_ELLIPTICAL, MORPH_SPIRAL)
    else:
        # Deterministic pseudo-morphology spread across the wedge.
        h = np.abs(np.sin(df["ra"].values * 0.37) * np.cos(df["dec"].values * 0.29))
        out["morph"] = np.where(h < 0.45, MORPH_ELLIPTICAL,
                        np.where(h < 0.85, MORPH_SPIRAL, MORPH_IRREGULAR))
    out["survey"] = 0
    out["mag"] = mag
    out["b_a"] = np.where(out["morph"] == MORPH_SPIRAL, 0.45, 0.85)
    return out


def load_2mrs(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df[df["z"] > 0]
    print(f"2MRS: {len(df)} galaxies")

    x, y, z, dist = cartesian(df["ra"].values, df["dec"].values, df["z"].values)
    out = pd.DataFrame({
        "ra": df["ra"].values, "dec": df["dec"].values, "z": df["z"].values,
        "x": x, "y": y, "pos_z": z, "dist": dist,
    })

    # Physical semi-major axis from isophotal angular size (arcsec) * distance.
    ang = df["Riso_arcsec"].fillna(30.0).values / 206265.0
    out["size"] = np.clip(ang * dist, 0.01, 5.0)

    out["morph"] = [ttype_to_morph(t) for t in df["type"].fillna("").values]
    out["survey"] = 1
    out["mag"] = df["Kcmag"].fillna(11.0).values.astype(float)
    out["b_a"] = df["b/a"].fillna(0.5).clip(0.05, 1.0).values.astype(float)
    return out


def deduplicate(sdss, mrs):
    """Drop SDSS galaxies that 2MRS already covers (within 5 arcsec)."""
    if len(mrs) == 0:
        return sdss
    s_coords = SkyCoord(ra=sdss["ra"].values * u.deg, dec=sdss["dec"].values * u.deg)
    m_coords = SkyCoord(ra=mrs["ra"].values * u.deg, dec=mrs["dec"].values * u.deg)
    idx, d2d, _ = m_coords.match_to_catalog_sky(s_coords)
    keep = np.full(len(s_coords), True)
    keep[idx[d2d.arcsec < 5.0]] = False
    print(f"Removed {int(np.sum(~keep))} SDSS galaxies already in 2MRS")
    return sdss[keep]


def main():
    parser = argparse.ArgumentParser(description="Merge SDSS + 2MRS and export")
    parser.add_argument("--sdss", type=Path, default=Path("../data/raw_galaxies.csv"))
    parser.add_argument("--mrs", type=Path, default=Path("../data/raw_2mrs.csv"))
    parser.add_argument("--output", type=Path, default=Path("../web/galaxies.bin"))
    parser.add_argument("--sdss-extra", action="store_true",
                        help="raw_galaxies.csv includes deVAB_r/expAB_r columns")
    args = parser.parse_args()

    sdss = load_sdss(args.sdss, args.sdss_extra)
    mrs = load_2mrs(args.mrs)
    sdss = deduplicate(sdss, mrs)

    all_df = pd.concat([sdss, mrs], ignore_index=True)
    all_df = all_df.dropna(subset=["x", "y", "z", "dist", "size"])
    all_df = all_df[all_df["dist"] > 0]
    all_df["size"] = all_df["size"].clip(0.005, 10.0)
    print(f"Combined: {len(all_df)} galaxies")

    # Redshift-based hue, brightness-scaled.
    z_max = float(all_df["z"].max())
    # Per-survey brightness normalization (0..1, bright ~ 1).
    brightness = np.zeros(len(all_df))
    for surv in (0, 1):
        m = all_df["survey"].values == surv
        mag = all_df.loc[m, "mag"].values.astype(float)
        lo, hi = np.nanpercentile(mag, 2), np.nanpercentile(mag, 98)
        if hi > lo:
            brightness[m] = np.clip((hi - mag) / (hi - lo), 0.05, 1.0)
        else:
            brightness[m] = 0.5

    n = len(all_df)
    data = np.zeros((n, FLOATS_PER_GALAXY), dtype=np.float32)
    for i, row in enumerate(all_df.itertuples(index=False)):
        r, g, b = redshift_color(row.z, z_max)
        bright = brightness[i]
        data[i, 0] = row.x
        data[i, 1] = row.y
        data[i, 2] = row.pos_z
        data[i, 3] = r * (0.5 + 0.5 * bright)
        data[i, 4] = g * (0.5 + 0.5 * bright)
        data[i, 5] = b * (0.5 + 0.5 * bright)
        data[i, 6] = row.size
        data[i, 7] = row.ra
        data[i, 8] = row.dec
        data[i, 9] = row.z
        data[i, 10] = row.morph
        data[i, 11] = row.survey
        data[i, 12] = bright
        data[i, 13] = row.b_a
        data[i, 14] = row.mag

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "wb") as fh:
        np.array([n], dtype=np.uint32).tofile(fh)
        data.flatten().tofile(fh)
    print(f"Exported {n} galaxies to {args.output} ({args.output.stat().st_size / 1e6:.2f} MB)")

    meta = {
        "count": int(n),
        "floats_per_galaxy": FLOATS_PER_GALAXY,
        "sources": ["SDSS DR16 (spec-z wedge)", "2MRS (Huchra+2012, full sky)"],
        "units": "Mpc, Earth at origin",
        "distance_range_mpc": [float(all_df["dist"].min()), float(all_df["dist"].max())],
        "redshift_range": [float(all_df["z"].min()), float(all_df["z"].max())],
        "morphology": ["elliptical", "S0", "spiral", "irregular"],
        "n_2mrs": int(len(mrs)),
        "n_sdss": int(len(sdss)),
    }
    meta_path = args.output.with_suffix(".json")
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"Saved metadata to {meta_path}")

    # Keep an intermediate parquet for inspection.
    parquet = Path("../data/galaxies_merged.parquet")
    all_df.to_parquet(parquet, index=False)
    print(f"Saved merged parquet to {parquet}")


if __name__ == "__main__":
    main()
