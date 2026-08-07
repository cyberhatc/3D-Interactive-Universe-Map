#!/usr/bin/env python3
"""
Run the complete data pipeline: fetch -> transform -> export.
"""

import argparse
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
    parser = argparse.ArgumentParser(description="Run the full data pipeline")
    parser.add_argument("--regenerate", action="store_true", help="Force regenerate existing data")
    args = parser.parse_args()
    
    pipeline_dir = Path(__file__).parent
    
    # Check if galaxy data already exists
    data_dir = pipeline_dir.parent / "data"
    raw_csv = data_dir / "raw_galaxies.csv"
    raw_2mrs = data_dir / "raw_2mrs.csv"
    binary = pipeline_dir.parent / "web" / "galaxies.bin"
    
    regenerate_galaxies = args.regenerate
    if binary.exists() and not args.regenerate:
        print(f"Binary data already exists at {binary}")
        response = input("Regenerate? (y/N): ").strip().lower()
        regenerate_galaxies = response == 'y'
    
    if not regenerate_galaxies and binary.exists():
        print("Galaxy data is up to date, skipping steps 1-3.")
    else:
        # Step 1: Fetch SDSS deep-wedge galaxies (if raw CSV doesn't exist)
        if not raw_csv.exists():
            run([sys.executable, "fetch_sdss.py", "--limit", "100000", "--output", str(raw_csv)], cwd=pipeline_dir)
        else:
            print(f"SDSS raw data exists at {raw_csv}, skipping fetch.")
        
        # Step 2: Fetch 2MRS full-sky galaxies (if raw CSV doesn't exist)
        if not raw_2mrs.exists():
            run([sys.executable, "fetch_2mrs.py", "--output", str(raw_2mrs)], cwd=pipeline_dir)
        else:
            print(f"2MRS raw data exists at {raw_2mrs}, skipping fetch.")
        
        # Step 3: Merge both real catalogs + export binary
        run([sys.executable, "merge_galaxies.py", "--sdss", str(raw_csv), "--mrs", str(raw_2mrs), "--output", str(binary)], cwd=pipeline_dir)
    
    # Step 4: Fetch & export HYG star data (Milky Way real stars)
    hyg_cache = data_dir / "hyg_v44.csv.gz"
    stars_binary = pipeline_dir.parent / "web" / "stars.bin"
    if stars_binary.exists() and not args.regenerate:
        print(f"Star data already exists at {stars_binary}, skipping. Use --regenerate to rebuild.")
    else:
        run([
            sys.executable, "fetch_hyg.py",
            "--cache", str(hyg_cache),
            "--output", str(stars_binary),
            "--max-dist", "1000",
            "--max-points", "60000",
        ], cwd=pipeline_dir)
    
    print("\n✅ Pipeline complete!")
    print(f"Binary data ready at: {binary}")
    print(f"Star data ready at: {stars_binary}")


if __name__ == "__main__":
    main()