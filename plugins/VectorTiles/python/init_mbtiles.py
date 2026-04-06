"""
Create an empty MBTiles database with the required schema (tiles + metadata tables).
Usage: python init_mbtiles.py <output_path>
Exit code 0 on success, 1 on failure.
"""
import sys
import sqlite3

def main():
    if len(sys.argv) < 2:
        print("Usage: init_mbtiles.py <output_path>", file=sys.stderr)
        return 1
    output_path = sys.argv[1]
    try:
        conn = sqlite3.connect(output_path)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tiles (
                zoom_level integer,
                tile_column integer,
                tile_row integer,
                tile_data blob,
                UNIQUE (zoom_level, tile_column, tile_row)
            );
            CREATE TABLE IF NOT EXISTS metadata (
                name text,
                value text,
                UNIQUE (name)
            );
        """)
        conn.close()
        return 0
    except Exception as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
