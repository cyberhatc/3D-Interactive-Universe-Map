#!/usr/bin/env python3
"""
Export transformed galaxy data as binary Float32Array for efficient Three.js loading.
Format: [x, y, z, r, g, b, size, ra, dec, z, petroMag_r] per galaxy (11 floats).
The trailing ra/dec/z/petroMag_r fields feed the click-to-inspect lookup in the frontend.
"""

import argparse
from pathlib import Path
import numpy as np
import pandas as pd


def export_binary(input_path: Path, output_path: Path, max_points: int = None):
    """
    Export galaxy data as binary Float32Array.
    
    Binary format:
    - Header: 4 bytes (uint32) = number of galaxies
    - Data: N * 11 * 4 bytes (float32) = [x, y, z, r, g, b, size, ra, dec, z, petroMag_r] per galaxy
    """
    print(f"Loading data from {input_path}...")
    df = pd.read_parquet(input_path)
    print(f"Loaded {len(df)} galaxies")
    
    if max_points and len(df) > max_points:
        # Random sample for performance
        df = df.sample(n=max_points, random_state=42)
        print(f"Sampled down to {len(df)} galaxies")
    
    # Prepare data array: x, y, z, r, g, b, size, ra, dec, z, petroMag_r
    n = len(df)
    data = np.zeros((n, 11), dtype=np.float32)
    data[:, 0] = df['x'].values.astype(np.float32)
    data[:, 1] = df['y'].values.astype(np.float32)
    data[:, 2] = df['z'].values.astype(np.float32)
    data[:, 3] = df['color_r'].values.astype(np.float32)
    data[:, 4] = df['color_g'].values.astype(np.float32)
    data[:, 5] = df['color_b'].values.astype(np.float32)
    data[:, 6] = df['size'].values.astype(np.float32)
    data[:, 7] = df['ra'].values.astype(np.float32)
    data[:, 8] = df['dec'].values.astype(np.float32)
    data[:, 9] = df['redshift'].values.astype(np.float32)
    data[:, 10] = df['petroMag_r'].values.astype(np.float32)
    
    # Flatten to 1D array
    flat_data = data.flatten()
    
    # Write binary file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        # Write header: number of points as uint32
        np.array([n], dtype=np.uint32).tofile(f)
        # Write data as float32
        flat_data.tofile(f)
    
    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Exported {n} galaxies to {output_path} ({file_size_mb:.2f} MB)")
    
    # Also export metadata JSON for the frontend
    import json
    meta = {
        'count': int(n),
        'floats_per_galaxy': 11,
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
    parser = argparse.ArgumentParser(description="Export galaxy data as binary Float32Array")
    parser.add_argument("--input", type=Path, default=Path("../data/galaxies.parquet"), help="Input Parquet path")
    parser.add_argument("--output", type=Path, default=Path("../web/galaxies.bin"), help="Output binary path")
    parser.add_argument("--max-points", type=int, default=None, help="Maximum points to export")
    args = parser.parse_args()
    
    export_binary(args.input, args.output, args.max_points)


if __name__ == "__main__":
    main()