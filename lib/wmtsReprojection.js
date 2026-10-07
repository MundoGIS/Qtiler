import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function buildReprojectedMatrixSet(layer, targetCrs, transform, metersPerUnit = 1) {
  const bbox = layer.extent;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const points = [];
  for (let step = 0; step <= 16; step += 1) {
    const fraction = step / 16;
    const horizontal = bbox[0] + (bbox[2] - bbox[0]) * fraction;
    const vertical = bbox[1] + (bbox[3] - bbox[1]) * fraction;
    points.push(...[[horizontal, bbox[1]], [horizontal, bbox[3]], [bbox[0], vertical], [bbox[2], vertical]].map(transform));
  }
  if (points.some((point) => !point.every(Number.isFinite))) return null;
  const extent = [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))];
  const matrices = (layer.tileMatrixSet?.matrices || []).map((matrix) => {
    const resolution = Number(matrix.scaleDenominator) * 0.00028 / metersPerUnit;
    if (!(resolution > 0)) throw new Error('Invalid WMTS scale');
    return {
      ...matrix, resolution, topLeftCorner: [extent[0], extent[3]],
      matrixWidth: Math.max(1, Math.ceil((extent[2] - extent[0]) / (resolution * matrix.tileWidth))),
      matrixHeight: Math.max(1, Math.ceil((extent[3] - extent[1]) / (resolution * matrix.tileHeight)))
    };
  });
  if (!matrices.length) return null;
  return {
    id: `REPROJECTED_${layer.identifier}_${targetCrs.replace(/[^A-Za-z0-9]/g, '_')}`,
    supportedCrs: targetCrs, extent, matrices, reprojected: true,
    axisOrder: ['EPSG:4326', 'EPSG:4258', 'EPSG:3006'].includes(targetCrs) ? 'yx' : 'xy'
  };
}

export async function renderReprojectedTile({ cacheDir, projectFile, layerId, layerName, isTheme, matrixSet, matrixId, row, col, renderer }) {
  const matrix = matrixSet.matrices.find((entry) => entry.identifier === String(matrixId));
  if (!matrix) throw Object.assign(new Error('TileMatrix not found'), { statusCode: 404 });
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= matrix.matrixHeight || col >= matrix.matrixWidth) {
    throw Object.assign(new Error('Tile outside matrix bounds'), { statusCode: 400 });
  }
  const modified = await fs.stat(projectFile).then((stat) => stat.mtimeMs).catch((err) => { if (err.code !== 'ENOENT') throw err; return 0; });
  const key = crypto.createHash('sha256').update(`${projectFile}|${modified}|${layerId}|${matrixSet.id}|${JSON.stringify(matrix)}`).digest('hex');
  const filePath = path.join(cacheDir, '_reprojected_wmts', key, String(matrixId), String(col), `${row}.png`);
  try {
    if ((await fs.stat(filePath)).size > 0) return filePath;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp.png`;
  const resolution = matrix.resolution;
  const minX = matrix.topLeftCorner[0] + col * matrix.tileWidth * resolution;
  const maxY = matrix.topLeftCorner[1] - row * matrix.tileHeight * resolution;
  try {
    const result = await renderer.renderTile({
      project_path: projectFile, output_file: temporary, crs: matrixSet.supportedCrs,
      bbox: [minX, maxY - matrix.tileHeight * resolution, minX + matrix.tileWidth * resolution, maxY],
      width: matrix.tileWidth, height: matrix.tileHeight, format: 'image/png', transparent: true,
      ...(isTheme ? { theme: layerName } : { layers: [layerName] })
    });
    if (result?.status !== 'success' || !(await fs.stat(temporary)).size) throw new Error('Reprojected tile render failed');
    await fs.rename(temporary, filePath);
    return filePath;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}