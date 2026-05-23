(function () {
  'use strict';

  const patternCache = new Map();
  const styleCache = new Map();

  function getOrigoApi() {
    return window.Origo && window.Origo.ol && window.Origo.ol.style ? window.Origo : null;
  }

  function makePatternKey(meta) {
    return JSON.stringify({
      pattern: meta.pattern,
      angle: meta.angle,
      spacing: meta.spacing,
      size: meta.size,
      transparentBackground: meta.transparentBackground,
      fillColor: meta.fillColor,
      strokeColor: meta.strokeColor,
      strokeWidth: meta.strokeWidth,
      lineDash: Array.isArray(meta.lineDash) ? meta.lineDash : []
    });
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function normalizePatternMeta(meta) {
    const rawPattern = String(meta && meta.pattern || '').trim().toLowerCase();
    const pattern = rawPattern === 'diagonal' ? 'slash' : rawPattern;
    const defaultAngle = pattern === 'backslash'
      ? 135
      : pattern === 'horizontal'
        ? 0
        : pattern === 'vertical'
          ? 90
          : 45;
    return {
      pattern: pattern || 'solid',
      angle: clampNumber(meta && meta.angle, 0, 180, defaultAngle),
      spacing: clampNumber(meta && meta.spacing, 4, 32, 10),
      size: clampNumber(meta && meta.size, 1, 12, 2.5),
      transparentBackground: meta && meta.transparentBackground === true,
      fillColor: meta && meta.fillColor || 'rgba(59, 130, 246, 0.25)',
      strokeColor: meta && meta.strokeColor || 'rgba(37, 99, 235, 1)',
      strokeWidth: clampNumber(meta && meta.strokeWidth, 0.6, 12, 1.2),
      lineDash: Array.isArray(meta && meta.lineDash) ? meta.lineDash.map(Number).filter(Number.isFinite) : []
    };
  }

  function createCanvasPattern(meta) {
    const normalized = normalizePatternMeta(meta);
    const cacheKey = makePatternKey(normalized);
    if (patternCache.has(cacheKey)) return patternCache.get(cacheKey);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(4, Math.round(normalized.spacing));
    canvas.height = Math.max(4, Math.round(normalized.spacing));
    const ctx = canvas.getContext('2d');
    if (!ctx) return normalized.fillColor || 'rgba(59, 130, 246, 0.25)';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!normalized.transparentBackground) {
      ctx.fillStyle = normalized.fillColor || 'rgba(59, 130, 246, 0.25)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.strokeStyle = normalized.strokeColor || 'rgba(37, 99, 235, 1)';
    ctx.lineWidth = normalized.strokeWidth;
    if (normalized.lineDash.length && typeof ctx.setLineDash === 'function') ctx.setLineDash(normalized.lineDash);

    if (normalized.pattern === 'dots') {
      const radius = Math.max(0.8, normalized.size);
      ctx.fillStyle = normalized.strokeColor || 'rgba(37, 99, 235, 1)';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const drawLine = function (lineAngle) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((lineAngle * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -canvas.height * 1.5);
        ctx.lineTo(0, canvas.height * 1.5);
        ctx.stroke();
        ctx.restore();
      };
      if (normalized.pattern === 'cross') {
        drawLine(normalized.angle);
        drawLine((normalized.angle + 90) % 180);
      } else {
        const effectiveAngle = normalized.pattern === 'slash'
          ? normalized.angle
          : normalized.pattern === 'backslash'
            ? 180 - normalized.angle
            : normalized.pattern === 'horizontal'
              ? 90
              : normalized.pattern === 'vertical'
                ? 0
                : normalized.angle;
        drawLine(effectiveAngle);
      }
    }

    const pattern = ctx.createPattern(canvas, 'repeat') || (normalized.transparentBackground ? 'rgba(0,0,0,0)' : (normalized.fillColor || 'rgba(59, 130, 246, 0.25)'));
    patternCache.set(cacheKey, pattern);
    return pattern;
  }

  function buildPatternStyleFunction(styleName, meta) {
    const origo = getOrigoApi();
    if (!origo) return null;
    const normalized = normalizePatternMeta(meta);
    const cacheKey = `${styleName}::${makePatternKey(normalized)}`;
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);

    const Style = origo.ol.style.Style;
    const Fill = origo.ol.style.Fill;
    const Stroke = origo.ol.style.Stroke;
    const fillPattern = createCanvasPattern(normalized);
    const style = new Style({
      fill: new Fill({ color: fillPattern }),
      stroke: new Stroke({
        color: normalized.strokeColor || 'rgba(37, 99, 235, 1)',
        width: Number.isFinite(Number(normalized.strokeWidth)) ? Number(normalized.strokeWidth) : 1,
        lineDash: Array.isArray(normalized.lineDash) && normalized.lineDash.length ? normalized.lineDash.map(Number) : undefined
      })
    });

    const fn = function patternStyleFunction() {
      return [style];
    };
    styleCache.set(cacheKey, fn);
    return fn;
  }

  function eachLayer(collection, callback) {
    if (!collection || typeof collection.forEach !== 'function') return;
    collection.forEach(function (layer) {
      callback(layer);
      const nested = layer && typeof layer.getLayers === 'function' ? layer.getLayers() : null;
      if (nested && nested !== collection) eachLayer(nested, callback);
    });
  }

  function applyRuntimePatternStyles(origoApp, cfg) {
    const patternStyles = cfg && cfg.qtilerPatternStyles && typeof cfg.qtilerPatternStyles === 'object'
      ? cfg.qtilerPatternStyles
      : null;
    if (!patternStyles || !Object.keys(patternStyles).length) return;

    const viewer = origoApp && typeof origoApp.api === 'function' ? origoApp.api() : null;
    const map = viewer && typeof viewer.getMap === 'function' ? viewer.getMap() : null;
    if (!map || typeof map.getLayers !== 'function') return;

    eachLayer(map.getLayers(), function (layer) {
      if (!layer || typeof layer.get !== 'function' || typeof layer.setStyle !== 'function') return;
      const styleName = String(layer.get('styleName') || '').trim();
      if (!styleName || !patternStyles[styleName]) return;
      const meta = patternStyles[styleName];
      const styleFn = buildPatternStyleFunction(styleName, meta);
      if (!styleFn) return;
      try {
        layer.setStyle(styleFn);
      } catch (err) {
        console.warn('[Qtiler2Origo] Failed to apply runtime pattern style for', styleName, err);
      }
    });
  }

  function bootOrigo(configOrUrl) {
    const loadConfig = typeof configOrUrl === 'string'
      ? fetch(configOrUrl, { credentials: 'same-origin' }).then(function (response) { return response.json(); })
      : Promise.resolve(configOrUrl);

    return loadConfig.then(function (cfg) {
      const app = Origo(cfg);
      window.origoApp = app;
      try {
        applyRuntimePatternStyles(app, cfg);
      } catch (err) {
        console.warn('[Qtiler2Origo] Runtime pattern setup failed before load event:', err);
      }
      if (app && typeof app.on === 'function') {
        app.on('load', function () {
          try {
            applyRuntimePatternStyles(app, cfg);
          } catch (err) {
            console.warn('[Qtiler2Origo] Runtime pattern setup failed on load event:', err);
          }
        });
      }
      return app;
    });
  }

  window.Qtiler2OrigoOrigoBoot = {
    bootOrigo: bootOrigo,
    applyRuntimePatternStyles: applyRuntimePatternStyles
  };
})();
