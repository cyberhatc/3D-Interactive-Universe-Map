#!/usr/bin/env python3
"""
Transform SDSS galaxy data from spherical (RA, Dec, redshift) to Cartesian (x, y, z) coordinates.
Uses Astropy's cosmology for accurate comoving distance calculation.
"""

import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from astropy.cosmology import Planck18 as cosmo
from astropy import units as u
from astropy.coordinates import SkyCoord


def transform_galaxies(input_path: Path, output_path: Path, max_distance_mpc: float = None):
    """
    Transform galaxy data to Cartesian coordinates.
    
    Args:
        input_path: Path to raw CSV from fetch_sdss.py
        output_path: Path to save transformed data (Parquet)
        max_distance_mpc: Optional max distance filter in Mpc
    """
    print(f"Loading data from {input_path}...")
    df = pd.read_csv(input_path)
    print(f"Loaded {len(df)} galaxies")
    
    # Convert RA/Dec to radians for SkyCoord
    # SDSS gives RA in degrees (0-360), Dec in degrees (-90 to 90)
    coords = SkyCoord(
        ra=df['ra'].values * u.deg,
        dec=df['dec'].values * u.deg,
        distance=cosmo.comoving_distance(df['z'].values),
        frame='icrs'
    )
    
    # Convert to Cartesian (x, y, z) in Mpc
    # Earth is at origin (0, 0, 0)
    cart = coords.cartesian
    
    df['x_mpc'] = cart.x.value
    df['y_mpc'] = cart.y.value
    df['z_mpc'] = cart.z.value
    df['distance_mpc'] = coords.distance.value
    df['redshift'] = df['z']  # preserve original redshift
    
    print(f"Distance range: {df['distance_mpc'].min():.1f} - {df['distance_mpc'].max():.1f} Mpc")
    
    if max_distance_mpc:
        initial_len = len(df)
        df = df[df['distance_mpc'] <= max_distance_mpc]
        print(f"Filtered to {len(df)} galaxies within {max_distance_mpc} Mpc (removed {initial_len - len(df)})")
    
    # Normalize coordinates for rendering (convert to reasonable scale for Three.js)
    # Scale: 1 unit = 1 Mpc, but we'll scale down for visualization
    scale = 1.0  # Can adjust later
    
    df['x'] = df['x_mpc'] * scale
    df['y'] = df['y_mpc'] * scale
    df['z'] = df['z_mpc'] * scale
    
    # Color by redshift (distance) - blue (near) to red (far)
    z_min, z_max = df['redshift'].min(), df['redshift'].max()
    df['color_r'] = (df['redshift'] - z_min) / (z_max - z_min)
    df['color_g'] = 0.3 * (1 - df['color_r'])  # Some green in middle
    df['color_b'] = 1 - df['color_r']
    
    # Size by apparent magnitude (brighter = larger)
    if 'petroMag_r' in df.columns:
        mag_min, mag_max = df['petroMag_r'].min(), df['petroMag_r'].max()
        df['size'] = 1.0 + 2.0 * (1 - (df['petroMag_r'] - mag_min) / (mag_max - mag_min))
    else:
        df['size'] = 1.0
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)
    print(f"Saved transformed data to {output_path}")
    print(f"Columns: {list(df.columns)}")
    
    return df


def main():
    parser = argparse.ArgumentParser(description="Transform SDSS data to Cartesian coordinates")
    parser.add_argument("--input", type=Path, default=Path("../data/raw_galaxies.csv"), help="Input CSV path")
    parser.add_argument("--output", type=Path, default=Path("../data/galaxies.parquet"), help="Output Parquet path")
    parser.add_argument("--max-distance", type=float, default=None, help="Max distance in Mpc")
    args = parser.parse_args()
    
    transform_galaxies(args.input, args.output, args.max_distance)


if __name__ == "__main__":
    main()