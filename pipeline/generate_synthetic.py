#!/usr/bin/env python3
"""
Generate synthetic galaxy data for testing without SDSS access.
Creates a realistic distribution of galaxies with SDSS-like properties.
"""

import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from astropy.cosmology import Planck18 as cosmo
from astropy import units as u
from astropy.coordinates import SkyCoord


def generate_synthetic_galaxies(n: int = 50000, output_path: Path = None) -> pd.DataFrame:
    """
    Generate synthetic galaxy data mimicking SDSS distribution.
    
    SDSS surveys specific sky regions (stripes), not full sky.
    We'll simulate that with a few "survey regions" on the sky.
    """
    print(f"Generating {n} synthetic galaxies...")
    
    np.random.seed(42)
    
    # SDSS-like survey geometry: stripes at specific Dec ranges
    # Main survey: Dec ~ -1.25 to +1.25 degrees (equatorial stripe)
    # Plus some additional stripes
    n_stripes = 3
    galaxies_per_stripe = n // n_stripes
    
    all_ra = []
    all_dec = []
    all_z = []
    all_mag = []
    
    for stripe_idx in range(n_stripes):
        # Each stripe covers a range of RA and narrow Dec
        if stripe_idx == 0:
            # Main equatorial stripe
            ra_min, ra_max = 100, 260  # degrees
            dec_center = 0.0
            dec_width = 2.5
        elif stripe_idx == 1:
            # Southern stripe
            ra_min, ra_max = 300, 60  # wraps around
            dec_center = -30.0
            dec_width = 2.5
        else:
            # Northern stripe
            ra_min, ra_max = 120, 240
            dec_center = 45.0
            dec_width = 2.5
        
        # Handle RA wrap-around
        if ra_min > ra_max:
            ra_vals = np.concatenate([
                np.random.uniform(ra_min, 360, galaxies_per_stripe // 2),
                np.random.uniform(0, ra_max, galaxies_per_stripe // 2)
            ])
        else:
            ra_vals = np.random.uniform(ra_min, ra_max, galaxies_per_stripe)
        
        dec_vals = np.random.normal(dec_center, dec_width / 3, galaxies_per_stripe)
        dec_vals = np.clip(dec_vals, dec_center - dec_width, dec_center + dec_width)
        
        # Redshift distribution: more galaxies at low z, falling off
        # Use inverse transform sampling for realistic z distribution
        # dN/dz ~ z^2 * exp(-(z/z0)^2) roughly
        z_max = 0.4
        u_vals = np.random.random(galaxies_per_stripe)
        # Approximate: z ~ z_max * u^(1/3) for volume-limited
        z_vals = z_max * (u_vals ** 0.5)
        # Add some clustering
        z_vals *= (1 + 0.3 * np.random.random(galaxies_per_stripe))
        z_vals = np.clip(z_vals, 0.001, z_max)
        
        # Apparent magnitude: roughly 15-22 for SDSS spectroscopic sample
        mag_vals = np.random.normal(19.5, 1.5, galaxies_per_stripe)
        mag_vals = np.clip(mag_vals, 14, 22.5)
        
        all_ra.append(ra_vals)
        all_dec.append(dec_vals)
        all_z.append(z_vals)
        all_mag.append(mag_vals)
    
    ra = np.concatenate(all_ra)
    dec = np.concatenate(all_dec)
    z = np.concatenate(all_z)
    mag = np.concatenate(all_mag)
    
    # Shuffle
    idx = np.random.permutation(len(ra))
    ra, dec, z, mag = ra[idx], dec[idx], z[idx], mag[idx]
    
    df = pd.DataFrame({
        'ra': ra,
        'dec': dec,
        'z': z,
        'petroMag_r': mag,
        'class': 'GALAXY'
    })
    
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(output_path, index=False)
        print(f"Saved synthetic data to {output_path}")
    
    return df


def transform_synthetic(input_path: Path, output_path: Path):
    """Transform synthetic data to Cartesian."""
    print(f"Loading synthetic data from {input_path}...")
    df = pd.read_csv(input_path)
    print(f"Loaded {len(df)} galaxies")
    
    coords = SkyCoord(
        ra=df['ra'].values * u.deg,
        dec=df['dec'].values * u.deg,
        distance=cosmo.comoving_distance(df['z'].values),
        frame='icrs'
    )
    
    cart = coords.cartesian
    df['x_mpc'] = cart.x.value
    df['y_mpc'] = cart.y.value
    df['z_mpc'] = cart.z.value
    df['distance_mpc'] = coords.distance.value
    df['redshift'] = df['z']  # preserve original redshift
    
    print(f"Distance range: {df['distance_mpc'].min():.1f} - {df['distance_mpc'].max():.1f} Mpc")
    
    scale = 1.0
    df['x'] = df['x_mpc'] * scale
    df['y'] = df['y_mpc'] * scale
    df['z'] = df['z_mpc'] * scale
    
    z_min, z_max = df['redshift'].min(), df['redshift'].max()
    df['color_r'] = (df['z'] - z_min) / (z_max - z_min)
    df['color_g'] = 0.3 * (1 - df['color_r'])
    df['color_b'] = 1 - df['color_r']
    
    mag_min, mag_max = df['petroMag_r'].min(), df['petroMag_r'].max()
    df['size'] = 1.0 + 2.0 * (1 - (df['petroMag_r'] - mag_min) / (mag_max - mag_min))
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)
    print(f"Saved transformed data to {output_path}")
    
    return df


def export_synthetic_binary(input_path: Path, output_path: Path):
    """Export synthetic data as binary."""
    print(f"Loading data from {input_path}...")
    df = pd.read_parquet(input_path)
    print(f"Loaded {len(df)} galaxies")
    
    n = len(df)
    data = np.zeros((n, 7), dtype=np.float32)
    data[:, 0] = df['x'].values.astype(np.float32)
    data[:, 1] = df['y'].values.astype(np.float32)
    data[:, 2] = df['z'].values.astype(np.float32)
    data[:, 3] = df['color_r'].values.astype(np.float32)
    data[:, 4] = df['color_g'].values.astype(np.float32)
    data[:, 5] = df['color_b'].values.astype(np.float32)
    data[:, 6] = df['size'].values.astype(np.float32)
    
    flat_data = data.flatten()
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        np.array([n], dtype=np.uint32).tofile(f)
        flat_data.tofile(f)
    
    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Exported {n} galaxies to {output_path} ({file_size_mb:.2f} MB)")
    
    import json
    meta = {
        'count': int(n),
        'bounds': {
            'x': [float(df['x'].min()), float(df['x'].max())],
            'y': [float(df['y'].min()), float(df['y'].max())],
            'z': [float(df['z'].min()), float(df['z'].max())],
        },
        'distance_range_mpc': [float(df['distance_mpc'].min()), float(df['distance_mpc'].max())],
        'redshift_range': [float(df['redshift'].min()), float(df['redshift'].max())] if 'redshift' in df.columns else [0, 0],
    }
    meta_path = output_path.with_suffix('.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"Saved metadata to {meta_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic galaxy data")
    parser.add_argument("--count", type=int, default=50000, help="Number of galaxies")
    parser.add_argument("--raw-output", type=Path, default=Path("../data/synthetic_raw.csv"))
    parser.add_argument("--parquet-output", type=Path, default=Path("../data/synthetic.parquet"))
    parser.add_argument("--binary-output", type=Path, default=Path("../web/galaxies.bin"))
    args = parser.parse_args()
    
    # Generate raw CSV
    generate_synthetic_galaxies(args.count, args.raw_output)
    
    # Transform
    transform_synthetic(args.raw_output, args.parquet_output)
    
    # Export binary
    export_synthetic_binary(args.parquet_output, args.binary_output)
    
    print("\n✅ Synthetic data generation complete!")


if __name__ == "__main__":
    main()