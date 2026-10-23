export function normalizeSimulation(input = {}) {
  const numeric = (value, fallback, min, max) => {
    const number = value == null || value === '' ? fallback : Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error('Invalid simulation parameter');
    return number;
  };
  const coordinate = (point) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error('Invalid route coordinate');
    return [numeric(point[0], NaN, -180, 180), numeric(point[1], NaN, -90, 90), numeric(point[2], 0, -10000, 100000)];
  };
  if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 500) throw new Error('A route needs 2 to 500 vertices');
  const points = input.points.map(coordinate).filter((point, index, values) => index === 0 || point[0] !== values[index - 1][0] || point[1] !== values[index - 1][1]);
  if (points.length < 2) throw new Error('Route vertices must be distinct');
  const direction = input.direction || 'route';
  const heightMode = input.heightMode || 'relative';
  if (!['route', 'focus'].includes(direction) || !['relative', 'absolute'].includes(heightMode)) throw new Error('Invalid simulation mode');
  const focus = input.focus ? coordinate(input.focus) : null;
  if (direction === 'focus' && !focus) throw new Error('Select a focus point');
  return {
    id: String(input.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100),
    name: String(input.name || 'Camera route').trim().slice(0, 100), points, focus, direction, heightMode,
    speed: numeric(input.speed, 5, 0.1, 250), height: numeric(input.height, 15, 1, 100000),
    pitch: numeric(input.pitch, -10, -85, 45), loop: input.loop === true
  };
}

export function distanceTable(points, distance) {
  const values = [0];
  for (let index = 1; index < points.length; index += 1) {
    const length = distance(points[index - 1], points[index]);
    if (!Number.isFinite(length) || length < 0) throw new Error('Invalid route distance');
    values.push(values[index - 1] + length);
  }
  if (!(values.at(-1) > 0)) throw new Error('Route has no length');
  return values;
}

export function segmentAtDistance(table, distance) {
  const value = Math.max(0, Math.min(table.at(-1), distance));
  let index = 0;
  while (index < table.length - 2 && table[index + 1] <= value) index += 1;
  const length = table[index + 1] - table[index];
  return { index, fraction: length > 0 ? (value - table[index]) / length : 0 };
}

export function createRoutePlayback(length, speed, loop = false) {
  if (!(length > 0) || !(speed > 0) || !Number.isFinite(length) || !Number.isFinite(speed)) throw new Error('Invalid playback');
  let travelled = 0;
  let running = false;
  return {
    play() { if (travelled >= length) travelled = 0; running = true; },
    pause() { running = false; },
    stop() { running = false; travelled = 0; },
    seek(fraction) { if (!Number.isFinite(fraction)) throw new Error('Invalid progress'); travelled = Math.max(0, Math.min(1, fraction)) * length; },
    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
      if (running) {
        travelled += seconds * speed;
        if (travelled >= length) {
          if (loop) travelled %= length;
          else { travelled = length; running = false; }
        }
      }
      return travelled;
    },
    get distance() { return travelled; },
    get running() { return running; },
    get progress() { return travelled / length; }
  };
}