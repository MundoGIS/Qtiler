from __future__ import annotations

import sys


def main() -> int:
    from qgis.core import QgsApplication, QgsProject

    qgs = QgsApplication([], False)
    qgs.initQgis()
    try:
        project_path = r"C:\Qtiler\qgisprojects\po.qgz"
        proj = QgsProject.instance()
        ok = proj.read(project_path)
        print("read", ok)
        if not ok:
            return 2

        layers = proj.mapLayersByName("PO_delar")
        print("layersByName", len(layers))
        if not layers:
            return 3

        lyr = layers[0]
        f = next(lyr.getFeatures())
        print("hasGeometry", f.hasGeometry())
        g = f.geometry()
        if g is None:
            print("geometry None")
            return 4

        # Discover what GML-related methods are actually available on this build
        try:
            gmlish = [m for m in dir(g) if "gml" in m.lower()]
            print("QgsGeometry gml-ish methods:", ", ".join(gmlish) if gmlish else "(none)")
        except Exception as e:
            print("dir(geometry) failed", type(e).__name__, str(e))

        # Try various exporters on QgsGeometry
        for name, args in [
            ("asGml3", (8,)),
            ("asGml3", ()),
            ("asGml2", ()),
            ("asGml", (8,)),
            ("asGml", ()),
        ]:
            fn = getattr(g, name, None)
            if fn is None:
                continue
            try:
                out = fn(*args)
                out_str = None if out is None else str(out)
                print("geom", name, args, "->", type(out).__name__, "len", (len(out_str) if out_str else 0))
                if out_str:
                    print(out_str[:200].replace("\n", " "))
            except Exception as e:
                print("geom", name, args, "EX", type(e).__name__, str(e))

        # Try QgsOgcUtils if available
        try:
            from qgis.core import QgsOgcUtils

            print("QgsOgcUtils available")

            for helper in ["geometryToGML"]:
                fn = getattr(QgsOgcUtils, helper, None)
                if fn is None:
                    continue
                try:
                    doc = getattr(fn, "__doc__", None)
                    if doc:
                        print(helper, "doc:", " ".join(doc.split()))
                except Exception as e:
                    print(helper, "doc read failed", type(e).__name__, str(e))

            for helper in [
                "geometryToGML",
                "geometryToGML2",
                "geometryToGML3",
                "geometryToGML32",
            ]:
                fn = getattr(QgsOgcUtils, helper, None)
                if fn is None:
                    continue
                try:
                    # Most of these are overloaded; we intentionally call with a single
                    # argument first to see what the binding complains about.
                    out = fn(g)
                    out_str = None if out is None else str(out)
                    print("ogc", helper, "->", type(out).__name__, "len", (len(out_str) if out_str else 0))
                    if out_str:
                        print(out_str[:200].replace("\n", " "))
                except Exception as e:
                    print("ogc", helper, "EX", type(e).__name__, str(e))
        except Exception as e:
            print("QgsOgcUtils unavailable", type(e).__name__, str(e))

        return 0
    finally:
        qgs.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
