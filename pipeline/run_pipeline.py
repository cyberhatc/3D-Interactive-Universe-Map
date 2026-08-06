#!/usr/bin/env python3
"""
Run the complete data pipeline: fetch -> transform -> export.
"""

import subprocess
import sys
from pathlib import Path


def run(cmd: list, cwd: Path = None):
    print(f"\n{'='*60}")
    print(f"Running: {' '.join(cmd)}")
    print(f"{'='*60}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(f"Command failed with exit code {result.returncode}")
        sys.exit(result.returncode)


def main():
    pipeline_dir = Path(__file__).parent
    
    # Check if data already exists
    data_dir = pipeline_dir / "data"
    raw_csv = data_dir / "raw_galaxies.csv"
    parquet = data_dir / "galaxies.parquet"
    binary = pipeline_dir.parent / "web" / "galaxies.bin"
    
    if binary.exists():
        print(f"Binary data already exists at {binary}")
        response = input("Regenerate? (y/N): ").strip().lower()
        if response != 'y':
            print("Skipping pipeline.")
            return
    
    # Step 1: Fetch data (if raw CSV doesn't exist)
    if not raw_csv.exists():
        run([sys.executable, "fetch_sdss.py", "--limit", "100000", "--output", str(raw_csv)], cwd=pipeline_dir)
    else:
        print(f"Raw data exists at {raw_csv}, skipping fetch.")
    
    # Step 2: Transform
    if not parquet.exists():
        run([sys.executable, "transform.py", "--input", str(raw_csv), "--output", str(parquet)], cwd=pipeline_dir)
    else:
        print(f"Transformed data exists at {parquet}, skipping transform.")
    
    # Step 3: Export binary
    run([sys.executable, "export_binary.py", "--input", str(parquet), "--output", str(binary), "--max-points", "50000"], cwd=pipeline_dir)
    
    print("\n✅ Pipeline complete!")
    print(f"Binary data ready at: {binary}")


if __name__ == "__main__":
    main()