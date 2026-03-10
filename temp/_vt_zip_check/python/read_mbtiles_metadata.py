import json
import os
import sqlite3
import sys


def out(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False))
    return code


def main():
    if len(sys.argv) < 2:
        return out({"error": "mbtiles_path_required"}, 1)

    mbtiles_path = sys.argv[1]
    if not os.path.exists(mbtiles_path):
        return out({"error": "mbtiles_not_found", "path": mbtiles_path}, 1)

    try:
        conn = sqlite3.connect(mbtiles_path)
        cur = conn.cursor()
        rows = cur.execute("SELECT name, value FROM metadata").fetchall()
        conn.close()

        metadata = {str(name): value for name, value in rows}
        vector_layers = []
        raw_json = metadata.get("json")
        if raw_json:
            try:
                parsed = json.loads(raw_json)
                if isinstance(parsed, dict) and isinstance(parsed.get("vector_layers"), list):
                    vector_layers = parsed.get("vector_layers")
            except Exception:
                vector_layers = []

        return out({
            "ok": True,
            "metadata": metadata,
            "vectorLayers": vector_layers
        }, 0)
    except Exception as err:
        return out({"error": "metadata_read_failed", "details": str(err)}, 1)


if __name__ == "__main__":
    sys.exit(main())
