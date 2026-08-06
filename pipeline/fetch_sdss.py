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
    batch_size = 50000
    all_frames = []
    fetched = 0
    offset = 0
    
    while fetched < limit:
        batch = min(batch_size, limit - fetched)
        query = f"""
        SELECT ra, dec, z, petroMag_r, class FROM (
            SELECT p.ra AS ra, p.dec AS dec, s.z AS z,
                   p.petroMag_r AS petroMag_r, s.class AS class,
                   ROW_NUMBER() OVER (ORDER BY s.specObjID) AS rn
            FROM SpecObj s
            JOIN PhotoObj p ON s.bestObjID = p.objID
            WHERE s.class = 'GALAXY'
              AND s.zWarning = 0
              AND s.z > 0
              AND s.z < 0.5
              AND p.petroMag_r > 0
        ) t
        WHERE t.rn > {offset} AND t.rn <= {offset + batch}
        """
        
        print(f"Querying SDSS for {batch} galaxies (offset {offset})...")
        result = SDSS.query_sql(query)
        
        if result is None or len(result) == 0:
            print("No more results available.")
            break
        
        df = result.to_pandas()
        all_frames.append(df)
        fetched += len(df)
        offset += len(df)
        print(f"Fetched {len(df)} galaxies (total {fetched})")
    
    df = pd.concat(all_frames, ignore_index=True)
    print(f"Fetched {len(df)} galaxies total")
    
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