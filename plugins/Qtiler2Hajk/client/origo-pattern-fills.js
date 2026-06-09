(function () {
  'use strict';

  const patternCache = new Map();
  const styleCache = new Map();

  function normalizeColorSignature(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function normalizeDashSignature(value) {
    return JSON.stringify(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);
  }

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

  function extractPatternRulesFromStyleDef(styleDef) {
    if (!Array.isArray(styleDef)) return [];
    const out = [];
    styleDef.forEach(function (ruleArr, index) {
      const entries = Array.isArray(ruleArr) ? ruleArr : [ruleArr];
      const geomEntry = entries.find(function (entry) {
        return entry && typeof entry === 'object' && (entry.fill || entry.stroke || entry.circle || entry.icon || entry.regularShape);
      });
      const patternMeta = geomEntry && geomEntry.qtilerPatternStyle && typeof geomEntry.qtilerPatternStyle === 'object'
        ? geomEntry.qtilerPatternStyle
        : null;
      const rawPattern = String(patternMeta && patternMeta.fillPattern || '').trim().toLowerCase();
      if (!geomEntry || !['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(rawPattern)) return;
      out.push({
        index: index,
        filter: String(geomEntry.filter || '').trim(),
        fillColor: normalizeColorSignature(geomEntry.fill && geomEntry.fill.color),
        strokeColor: normalizeColorSignature(geomEntry.stroke && geomEntry.stroke.color),
        strokeWidth: Number(geomEntry.stroke && geomEntry.stroke.width),
        lineDash: normalizeDashSignature(geomEntry.stroke && geomEntry.stroke.lineDash),
        meta: normalizePatternMeta({
          pattern: rawPattern,
          angle: patternMeta.fillPatternAngle,
          spacing: patternMeta.fillPatternSpacing,
          size: patternMeta.fillPatternSize,
          transparentBackground: patternMeta.fillPatternTransparent === true,
          fillColor: geomEntry.fill && geomEntry.fill.color,
          strokeColor: geomEntry.stroke && geomEntry.stroke.color,
          strokeWidth: geomEntry.stroke && geomEntry.stroke.width,
          lineDash: geomEntry.stroke && geomEntry.stroke.lineDash
        })
      });
    });
    return out;
  }

  function evaluateFilterExpression(filter, feature) {
    const expr = String(filter || '').trim();
    if (!expr) return true;
    if (!feature || typeof feature.get !== 'function') return false;
    const match = expr.match(/^\[([^\]]+)\]\s*(==|!=|>=|<=|>|<|LIKE)\s*(.+)$/i);
    if (!match) return false;
    const field = match[1];
    const op = match[2].toUpperCase();
    let rawValue = String(match[3] || '').trim();
    const featureValue = feature.get(field);
    if (op === 'LIKE') {
      rawValue = rawValue.replace(/^'/, '').replace(/'$/, '').replace(/^%/, '').replace(/%$/, '');
      return String(featureValue == null ? '' : featureValue).toLowerCase().includes(rawValue.toLowerCase());
    }
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      rawValue = rawValue.slice(1, -1).replace(/\\'/g, "'");
    }
    const leftNumber = Number(featureValue);
    const rightNumber = Number(rawValue);
    const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && rawValue !== '';
    const left = numeric ? leftNumber : String(featureValue == null ? '' : featureValue);
    const right = numeric ? rightNumber : rawValue;
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return numeric ? left > right : left > right;
      case '>=': return numeric ? left >= right : left >= right;
      case '<': return numeric ? left < right : left < right;
      case '<=': return numeric ? left <= right : left <= right;
      default: return false;
    }
  }

  function getStyleArray(styleLike, feature, resolution) {
    if (typeof styleLike === 'function') return styleLike(feature, resolution);
    return styleLike;
  }

  function selectPatternRule(patternRules, feature, geomStyle) {
    if (!Array.isArray(patternRules) || !patternRules.length) return null;
    if (patternRules.length === 1) return patternRules[0];
    const stroke = geomStyle && typeof geomStyle.getStroke === 'function' ? geomStyle.getStroke() : null;
    const fill = geomStyle && typeof geomStyle.getFill === 'function' ? geomStyle.getFill() : null;
    const styleFill = normalizeColorSignature(fill && typeof fill.getColor === 'function' ? fill.getColor() : '');
    const styleStroke = normalizeColorSignature(stroke && typeof stroke.getColor === 'function' ? stroke.getColor() : '');
    const styleWidth = Number(stroke && typeof stroke.getWidth === 'function' ? stroke.getWidth() : NaN);
    const styleDash = normalizeDashSignature(stroke && typeof stroke.getLineDash === 'function' ? stroke.getLineDash() : []);
    const filtered = patternRules.filter(function (entry) {
      return evaluateFilterExpression(entry.filter, feature);
    });
    const candidates = filtered.length ? filtered : patternRules;
    const exact = candidates.find(function (entry) {
      return (!entry.fillColor || entry.fillColor === styleFill)
        && (!entry.strokeColor || entry.strokeColor === styleStroke)
        && (!Number.isFinite(entry.strokeWidth) || entry.strokeWidth === styleWidth)
        && (!entry.lineDash || entry.lineDash === styleDash);
    });
    return exact || candidates[0] || null;
  }

  function buildPatternWrappingStyleFunction(styleName, originalStyle, patternRules, origo) {
    const Style = origo.ol.style.Style;
    const Fill = origo.ol.style.Fill;
    const cacheKey = styleName + '::wrapper::' + JSON.stringify(patternRules.map(function (entry) {
      return { index: entry.index, filter: entry.filter, meta: entry.meta };
    }));
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    const fn = function patternWrappingStyle(feature, resolution) {
      const sourceStyles = getStyleArray(originalStyle, feature, resolution);
      const styleArray = Array.isArray(sourceStyles) ? sourceStyles : (sourceStyles ? [sourceStyles] : []);
      if (!styleArray.length) return sourceStyles;
      const geomIndex = styleArray.findIndex(function (style) {
        return style
          && typeof style.getFill === 'function'
          && style.getFill()
          && !(style.getImage && style.getImage())
          && !(style.getText && style.getText());
      });
      if (geomIndex < 0) return sourceStyles;
      const geomStyle = styleArray[geomIndex];
      const selected = selectPatternRule(patternRules, feature, geomStyle);
      if (!selected) return sourceStyles;
      const patternFill = createCanvasPattern(selected.meta);
      const cloned = styleArray.map(function (style, index) {
        if (index !== geomIndex || !style || typeof style.clone !== 'function') return style;
        const copy = style.clone();
        copy.setFill(new Fill({ color: patternFill }));
        return copy;
      });
      return Array.isArray(sourceStyles) ? cloned : cloned[0];
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
    const styleDefs = cfg && cfg.styles && typeof cfg.styles === 'object' ? cfg.styles : null;
    const hasLegacyPatterns = !!(patternStyles && Object.keys(patternStyles).length);
    const hasEmbeddedPatterns = !!(styleDefs && Object.keys(styleDefs).some(function (styleName) {
      return extractPatternRulesFromStyleDef(styleDefs[styleName]).length > 0;
    }));
    if (!hasLegacyPatterns && !hasEmbeddedPatterns) return;

    const viewer = origoApp && typeof origoApp.api === 'function' ? origoApp.api() : null;
    const map = viewer && typeof viewer.getMap === 'function' ? viewer.getMap() : null;
    const origo = getOrigoApi();
    if (!map || typeof map.getLayers !== 'function') return;
    if (!origo) return;

    eachLayer(map.getLayers(), function (layer) {
      if (!layer || typeof layer.get !== 'function' || typeof layer.setStyle !== 'function') return;
      const styleName = String(layer.get('styleName') || '').trim();
      if (!styleName) return;
      const embeddedRules = styleDefs ? extractPatternRulesFromStyleDef(styleDefs[styleName]) : [];
      const legacyMeta = patternStyles && patternStyles[styleName] && !Array.isArray(patternStyles[styleName])
        ? patternStyles[styleName]
        : null;
      const styleFn = embeddedRules.length
        ? buildPatternWrappingStyleFunction(styleName, layer.getStyle(), embeddedRules, origo)
        : (legacyMeta ? buildPatternStyleFunction(styleName, legacyMeta) : null);
      if (!styleFn) return;
      try {
        layer.setStyle(styleFn);
      } catch (err) {
        console.warn('[Qtiler2Hajk] Failed to apply runtime pattern style for', styleName, err);
      }
    });
  }

  function bootOrigo(configOrUrl) {
    const loadConfig = typeof configOrUrl === 'string'
      ? fetch(configOrUrl, { credentials: 'same-origin' }).then(function (response) { return response.json(); })
      : Promise.resolve(configOrUrl);

    return loadConfig.then(function (cfg) {
      // Register custom Qtiler2Hajk controls before initializing Origo
      if (window.LantmateriSearch) {
        try {
          // Register control in Origo's global controls object
          if (!window.Origo) {
            console.error('[Qtiler2Hajk] window.Origo not available yet!');
          } else {
            // Try multiple registration methods
            if (!window.Origo.controls) {
              window.Origo.controls = {};
            }
            window.Origo.controls.lantmaterisearch = window.LantmateriSearch;
            
            // Also try registering with capital L (in case Origo normalizes names)
            window.Origo.controls.Lantmaterisearch = window.LantmateriSearch;
            window.Origo.controls.LantmateriSearch = window.LantmateriSearch;
            
            console.log('[Qtiler2Hajk] Registered LantmateriSearch control', {
              hasOrigo: !!window.Origo,
              hasControls: !!window.Origo.controls,
              registered: window.Origo.controls.lantmaterisearch === window.LantmateriSearch,
              controlKeys: Object.keys(window.Origo.controls || {})
            });
            
            // Log what controls will be in the config
            if (cfg && cfg.controls) {
              console.log('[Qtiler2Hajk] Controls in config:', cfg.controls.map(c => c.name || c));
            }
          }
        } catch (err) {
          console.warn('[Qtiler2Hajk] Failed to register Lantmäteriet search control:', err);
        }
      } else {
        console.warn('[Qtiler2Hajk] LantmateriSearch not loaded - control will not be available');
      }

      // Safety net: strip Qtiler2Hajk custom controls from cfg.controls when
      // their implementation failed to load. Otherwise Origo.initControls
      // crashes with "Cannot read properties of undefined" and the whole map
      // fails to render. We only check OUR custom controls — built-in Origo
      // controls (zoom, splash, mouseposition, ...) are imported internally by
      // Origo and are NOT present on window.Origo.controls.
      try {
        const CUSTOM_CONTROLS = {
          lantmaterisearch: 'LantmateriSearch'
        };
        if (cfg && Array.isArray(cfg.controls)) {
          const dropped = [];
          cfg.controls = cfg.controls.filter(function (c) {
            if (!c) return false;
            const name = typeof c === 'string' ? c : c.name;
            if (!name) return true;
            const key = String(name).toLowerCase();
            const globalName = CUSTOM_CONTROLS[key];
            if (!globalName) return true; // not a custom control, leave alone
            const available = window[globalName]
              || (window.Origo && window.Origo.controls && (window.Origo.controls[key] || window.Origo.controls[globalName]));
            if (available) return true;
            dropped.push(name);
            return false;
          });
          if (dropped.length) {
            console.warn('[Qtiler2Hajk] Dropping unregistered custom controls to prevent crash:', dropped);
          }
        }
      } catch (err) {
        console.warn('[Qtiler2Hajk] Could not sanitise controls list:', err);
      }

      const app = Origo(cfg);
      window.origoApp = app;
      
      try {
        applyRuntimePatternStyles(app, cfg);
      } catch (err) {
        console.warn('[Qtiler2Hajk] Runtime pattern setup failed before load event:', err);
      }
      
      if (app && typeof app.on === 'function') {
        app.on('load', function () {
          try {
            applyRuntimePatternStyles(app, cfg);
          } catch (err) {
            console.warn('[Qtiler2Hajk] Runtime pattern setup failed on load event:', err);
          }
        });
      }
      
      return app;
    });
  }

  window.Qtiler2HajkOrigoBoot = {
    bootOrigo: bootOrigo,
    applyRuntimePatternStyles: applyRuntimePatternStyles
  };
})();
