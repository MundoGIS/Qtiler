import os
import sys
import sqlite3


def main():
    if len(sys.argv) < 5:
        print("missing_args", file=sys.stderr)
        return 2

    mbtiles = sys.argv[1]
    z = int(sys.argv[2])
    x = int(sys.argv[3])
    y_xyz = int(sys.argv[4])

    if not os.path.exists(mbtiles):
        print("mbtiles_not_found", file=sys.stderr)
        return 3

    y_tms = (2 ** z - 1) - y_xyz

    try:
        conn = sqlite3.connect(mbtiles)
        cur = conn.cursor()
        cur.execute(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1",
            (z, x, y_tms)
        )
        row = cur.fetchone()
        conn.close()
        if not row or row[0] is None:
            return 4
        blob = row[0]
        if isinstance(blob, memoryview):
            blob = blob.tobytes()
        sys.stdout.buffer.write(blob)
        return 0
    except Exception as err:
        print(str(err), file=sys.stderr)
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
