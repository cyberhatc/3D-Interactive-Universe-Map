#!/usr/bin/env python3
"""
Fetch the 2MASS Redshift Survey (2MRS) galaxy catalog (Huchra+ 2012).

Full-sky, Ks<=11.75, |b|>=5 deg, z<0.09 (~410 Mpc). 44,599 galaxies with
spectroscopic redshifts and morphological types (ZCAT T-type).

Primary source: HEASARC Xamin TAP (twomassrsc table) -> VOTable.
Fallback:      fixed-width VizieR table3.dat parser.
"""

import argparse
import gzip
import io
import urllib.request
import urllib.parse
from pathlib import Path

import pandas as pd
from astropy.io import votable

TAP_URL = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync"
TAP_QUERY = (
    "SELECT name, ra, dec, ks_mag_0, ks_mag_0_tot, hmag_0, jmag_0, "
    "log_k20_semimajor_axis, axis_ratio, morph_type, radial_velocity "
    "FROM twomassrsc"
)
VIZIER_URL = "https://cdsarc.cds.unistra.fr/ftp/J/ApJS/199/26/table3.dat"

FALLBACK_COLUMNS = {
    "name": None,
    "ra": None,
    "dec": None,
    "ks_mag_0": "Kcmag",
    "ks_mag_0_tot": None,
    "hmag_0": "Hcmag",
    "jmag_0": "Jcmag",
    "log_k20_semimajor_axis": "Riso_log",
    "axis_ratio": "b/a",
    "morph_type": "type",
    "radial_velocity": "cz",
}


def fetch_tap() -> pd.DataFrame:
    """Query HEASARC Xamin TAP and parse the VOTable into a DataFrame."""
    data = urllib.parse.urlencode({
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "votable",
        "QUERY": TAP_QUERY,
    })
    req = urllib.request.Request(TAP_URL, data=data.encode(),
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)

    text = raw.decode("utf-8", "replace")
    if "QUERY_STATUS" in text and 'value="ERROR"' in text:
        raise RuntimeError("HEASARC TAP query error")

    vt = votable.parse(io.BytesIO(raw))
    table = vt.get_first_table()
    df = table.to_table().to_pandas()
    return df


def _f(rec: str, a: int, b: int):
    s = rec[a - 1:b].strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fetch_vizier() -> pd.DataFrame:
    """Fallback: parse the fixed-width VizieR table3.dat (233 bytes/row)."""
    req = urllib.request.Request(VIZIER_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    text = raw.decode("latin-1")

    rows = []
    for line in text.splitlines():
        rec = line.rstrip("\n")
        if len(rec) < 40:
            continue
        ra = _f(rec, 18, 26)
        de = _f(rec, 28, 36)
        cz = _f(rec, 174, 178)
        kcmag = _f(rec, 58, 63)
        hcmag = _f(rec, 65, 70)
        jcmag = _f(rec, 72, 77)
        riso = _f(rec, 142, 146)
        ba = _f(rec, 154, 158)
        if ra is None or de is None or cz is None:
            continue
        rows.append({
            "name": rec[15:31].strip(),
            "ra": ra, "dec": de,
            "ks_mag_0": kcmag, "ks_mag_0_tot": None,
            "hmag_0": hcmag, "jmag_0": jcmag,
            "log_k20_semimajor_axis": riso,
            "axis_ratio": ba if ba is not None else 0.5,
            "morph_type": rec[165:169].strip(),
            "radial_velocity": cz,
        })
    return pd.DataFrame(rows)


def postprocess(df: pd.DataFrame) -> pd.DataFrame:
    """Convert HEASARC fields to a clean common schema."""
    df = df.rename(columns={
        "radial_velocity": "cz",
        "ks_mag_0": "Kcmag",
        "hmag_0": "Hcmag",
        "jmag_0": "Jcmag",
        "log_k20_semimajor_axis": "Riso_log",
        "axis_ratio": "b/a",
        "morph_type": "type",
    })
    for col in ("cz", "Kcmag", "Hcmag", "Jcmag", "Riso_log", "b/a"):
        if col not in df.columns:
            df[col] = float("nan")
    df = df[df["cz"].notna()]
    df["cz"] = df["cz"].astype(float)
    df = df[df["cz"] > 0]
    # z from barycentric radial velocity (km/s -> dimensionless)
    df["z"] = df["cz"] / 299792.458
    # log10(arcsec) -> arcsec
    df["Riso_arcsec"] = df["Riso_log"].apply(
        lambda x: 10.0 ** float(x) if pd.notna(x) else float("nan"))
    df["b/a"] = df["b/a"].fillna(0.5).clip(0.05, 1.0)
    return df


def main():
    parser = argparse.ArgumentParser(description="Fetch 2MRS galaxy catalog")
    parser.add_argument("--output", type=Path, default=Path("../data/raw_2mrs.csv"))
    args = parser.parse_args()

    df = None
    try:
        print("Querying HEASARC Xamin TAP ...")
        df = postprocess(fetch_tap())
        print(f"HEASARC: {len(df)} galaxies")
    except Exception as e:
        print(f"  HEASARC failed ({e}); falling back to VizieR")
        try:
            df = postprocess(fetch_vizier())
            print(f"VizieR: {len(df)} galaxies")
        except Exception as e2:
            raise SystemExit(f"All 2MRS sources failed: {e2}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)
    print(f"Saved to {args.output}")
    print(f"z range: {df['z'].min():.5f} - {df['z'].max():.5f}")
    cols = ["ra", "dec", "z", "Kcmag", "type", "Riso_arcsec", "b/a"]
    print(df[[c for c in cols if c in df.columns]].head().to_string())
    return df


if __name__ == "__main__":
    main()
