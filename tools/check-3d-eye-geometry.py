import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'plugins/Qtiler-3D-eye/python/build_qgis3d_tiles.py'
SPEC = importlib.util.spec_from_file_location('qtiler_tiles', SCRIPT)
TILES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TILES)


class FlatTerrain:
    def height(self, longitude, latitude):
        return 100


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)

    def build(self, geometry, style=None, triangles=None):
        feature = {'type': 'Feature', 'properties': {}, 'geometry': geometry}
        if triangles is not None:
            feature['_qtilerTriangles'] = triangles
        target = self.folder / 'fixture.b3dm'
        result = TILES.build_chunk([feature], 0, [1, 1, 1, 1], str(target), FlatTerrain(), style or {'heightMode': 'absolute'})
        self.assertEqual(target.read_bytes()[:4], b'b3dm')
        return result, target.read_bytes()

    def test_negative_zero_and_relative_heights(self):
        self.assertEqual(TILES.feature_extrusion_height({'properties': {}}, {'extrusionHeight': 10, 'styleRules': [{'extrusionHeight': 0}]}, 10), 0)
        self.assertEqual(TILES.coordinate_height([10, 60, 0], FlatTerrain(), {'heightMode': 'auto'}), 0)
        self.assertEqual(TILES.coordinate_height([10, 60, -8], FlatTerrain(), {'heightMode': 'relative'}), 92)
        self.assertEqual(TILES.coordinate_height([10, 60, -8], FlatTerrain(), {'heightMode': 'absolute'}), -8)
        self.assertEqual(TILES.coordinate_height([10, 60, 50], FlatTerrain(), {'heightMode': 'ground', 'heightOffset': -5}), 95)

    def test_vertical_polygon_and_sloping_roof_are_not_flattened(self):
        wall = [[10, 60, 0], [10, 60, 5], [10.001, 60, 5], [10.001, 60, 0], [10, 60, 0]]
        self.assertEqual(len(TILES.clean_ring(wall)), 4)
        result, _ = self.build({'type': 'Polygon', 'coordinates': [wall]}, triangles=[[0, 1, 2, 0, 2, 3]])
        self.assertEqual(result['triangles'], 2)
        self.assertEqual(result['region'][4:], [0, 5])
        roof = [[10, 60, 12], [10.001, 60, 12], [10.001, 60.001, 17], [10, 60.001, 17], [10, 60, 12]]
        result, _ = self.build({'type': 'MultiPolygon', 'coordinates': [[roof]]}, triangles=[[0, 1, 2, 0, 2, 3]])
        self.assertEqual(result['region'][4:], [12, 17])

    def test_pipeline_radius_bounds_do_not_accumulate_per_segment(self):
        line = [[10 + index * 0.0001, 60, -8] for index in range(20)]
        result, _ = self.build({'type': 'MultiLineString', 'coordinates': [line]}, {'heightMode': 'absolute', 'tubeRadius': 0.25})
        self.assertEqual(result['region'][4:], [-8.25, -7.75])
        self.assertEqual(result['triangles'], 19 * 64)

    def test_model_instances_and_tileset(self):
        feature = {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'MultiPoint', 'coordinates': [[10, 60, -3], [10.001, 60, 0]]}}
        source = self.folder / 'source.json'
        source.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature]}))
        output = self.folder / 'tiles'
        result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps({'geojsonPath': str(source), 'outputDir': str(output), 'style': {'heightMode': 'absolute', 'symbolType': 'gltf', 'modelUrl': 'https://example.org/model.glb', 'modelScale': 2}}), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        status = json.loads(result.stdout)
        self.assertFalse(status['usesTerrain'])
        self.assertIsNone(status['terrainReference'])
        tileset = json.loads((output / 'tileset.json').read_text())
        self.assertEqual(tileset['asset']['gltfUpAxis'], 'Y')
        tile = output / tileset['root']['children'][0]['content']['uri']
        raw = tile.read_bytes()
        header = struct.unpack('<4sIIIIIII', raw[:32])
        self.assertEqual(header[0], b'i3dm')
        self.assertEqual(header[2], len(raw))
        self.assertEqual(json.loads(raw[32:32 + header[3]])['INSTANCES_LENGTH'], 2)

    def test_icon_texture_is_embedded(self):
        result, raw = self.build({'type': 'Point', 'coordinates': [10, 60, 0]}, {'heightMode': 'absolute', 'symbolType': 'svg', 'iconUrl': 'data:image/png;base64,fixture', 'iconWorldSize': 2})
        header = struct.unpack('<4sIIIIII', raw[:28])
        glb = raw[28 + sum(header[3:]):]
        length = struct.unpack('<I', glb[12:16])[0]
        document = json.loads(glb[20:20 + length])
        self.assertIn('TEXCOORD_0', document['meshes'][0]['primitives'][0]['attributes'])
        self.assertTrue(document['images'][0]['uri'].startswith('data:image/png'))
        self.assertEqual(result['triangles'], 2)


if __name__ == '__main__':
    unittest.main()