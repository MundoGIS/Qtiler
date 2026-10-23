export function projectSurfaceRings(rings) {
  const points = rings.flat();
  if (points.length < 3) return { vertices: [], holes: [] };
  const normal = [0, 0, 0];
  const outer = rings[0];
  for (let index = 0; index < outer.length; index++) {
    const current = outer[index];
    const next = outer[(index + 1) % outer.length];
    normal[0] += (current.y - next.y) * (current.z + next.z);
    normal[1] += (current.z - next.z) * (current.x + next.x);
    normal[2] += (current.x - next.x) * (current.y + next.y);
  }
  const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const dimensions = ['x', 'y', 'z'].filter((_, index) => index !== axis);
  const origin = points[0];
  let count = outer.length;
  const holes = rings.slice(1).map(ring => { const offset = count; count += ring.length; return offset; });
  return {
    vertices: points.flatMap(point => dimensions.map(dimension => point[dimension] - origin[dimension])),
    holes
  };
}

export function geographicCartesian(coordinate) {
  const longitude = coordinate[0] * Math.PI / 180;
  const latitude = coordinate[1] * Math.PI / 180;
  const height = coordinate[2] || 0;
  const radius = 6378137 / Math.sqrt(1 - 6.69437999014e-3 * Math.sin(latitude) ** 2);
  return {
    x: (radius + height) * Math.cos(latitude) * Math.cos(longitude),
    y: (radius + height) * Math.cos(latitude) * Math.sin(longitude),
    z: (radius * (1 - 6.69437999014e-3) + height) * Math.sin(latitude)
  };
}

export function polygonParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygonParts);
  return [];
}

export function cleanSurfaceRing(ring) {
  const points = (ring || []).filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && (point.length < 3 || Number.isFinite(point[2])));
  const same = (left, right) => left[0] === right[0] && left[1] === right[1] && (left[2] || 0) === (right[2] || 0);
  const cleaned = points.filter((point, index) => !index || !same(point, points[index - 1]));
  if (cleaned.length > 1 && same(cleaned[0], cleaned.at(-1))) cleaned.pop();
  return cleaned;
}