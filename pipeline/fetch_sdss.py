#!/usr/bin/env python3
"""
Fetch galaxy data from SDSS using astroquery.
Queries the SpecObj table for galaxies with good redshifts.
"""

import argparse
from pathlib import Path
from astroquery.sdss import SDSS
import pandas as pd
from tqdm import tqdm


def fetch_sdss_galaxies(limit: int = 100000, output_path: Path = None) -> pd.DataFrame:
    """
    Query SDSS for galaxies with valid redshifts.
    
    Args:
        limit: Maximum number of galaxies to fetch
        output_path: Path to save raw CSV
    
    Returns:
        DataFrame with ra, dec, z, petroMag_r, class columns
    """
    query = f"""
    SELECT TOP {limit}
        ra, dec, z, petroMag_r, class
    FROM SpecObj
    WHERE class = 'GALAXY' 
      AND zWarning = 0 
      AND z > 0
      AND z < 0.5
    """
    
    print(f"Querying SDSS for {limit} galaxies...")
    result = SDSS.query_sql(query)
    
    if result is None or len(result) == 0:
        raise ValueError("No results returned from SDSS")
    
    df = result.to_pandas()
    print(f"Fetched {len(df)} galaxies")
    
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(output_path, index=False)
        print(f"Saved raw data to {output_path}")
    
    return df


def main():
    parser = argparse.ArgumentParser(description="Fetch SDSS galaxy data")
    parser.add_argument("--limit", type=int, default=100000, help="Number of galaxies to fetch")
    parser.add_argument("--output", type=Path, default=Path("../data/raw_galaxies.csv"), help="Output CSV path")
    args = parser.parse_args()
    
    fetch_sdss_galaxies(limit=args.limit, output_path=args.output)


if __name__ == "__main__":
    main()