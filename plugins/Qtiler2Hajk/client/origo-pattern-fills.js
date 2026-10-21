(function () {
  'use strict';

  const patternCache = new Map();
  const styleCache = new Map();
  const categoryLayers = new Map();
  const categoryControlStates = new WeakMap();
  const runtimeLabelStyles = new WeakMap();
  const rasterCancellationMaps = new WeakMap();
  const wfsCellStates = new WeakMap();
  const wfsCellQueue = [];
  const wfsCellCache = new Map();
  const wfsCellMetrics = { requests: 0, reusedCells: 0, cancelled: 0, evictions: 0 };
  let wfsCellRunning = 0;
  let wfsCellBytes = 0;
  let wfsCellPreviousOwner = null;

  function normalizeColorSignature(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function normalizeDashSignature(value) {
    return JSON.stringify(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);
  }

  function getOrigoApi() {
    return window.Origo && window.Origo.ol && window.Origo.ol.style ? window.Origo : null;
  }

  function getOlStyleApi() {
    const origo = getOrigoApi();
    if (origo) return origo.ol.style;
    return window.ol && window.ol.style ? window.ol.style : null;
  }

  function renderRuleLabels(feature, resolution, geometryStyles, rules) {
    const styleApi = getOlStyleApi();
    const selected = (rules || []).find(function (rule) {
      if (!rule.property) return false;
      return evaluateFilterExpression('[' + rule.property + '] ' + (rule.operator || '==') + " '" + String(rule.value ?? '').replace(/'/g, "\\'") + "'", feature);
    }) || (rules || []).find(function (rule) { return !rule.property; });
    if (!selected) return [];
    const zoomResolutions = selected.resolutions || [];
    function visible(options) {
      if (options.minResolution != null && resolution < options.minResolution) return false;
      if (options.maxResolution != null && resolution > options.maxResolution) return false;
      if (options.minZoom != null && zoomResolutions[options.minZoom] != null && resolution > zoomResolutions[options.minZoom]) return false;
      if (options.maxZoom != null && zoomResolutions[options.maxZoom] != null && resolution < zoomResolutions[options.maxZoom]) return false;
      return true;
    }
    const sourceStyles = Array.isArray(geometryStyles) ? geometryStyles : (geometryStyles ? [geometryStyles] : []);
    let result = visible(selected) ? sourceStyles.filter(function (style) { return !(style.getText && style.getText()); }) : [];
    if (!styleApi || !styleApi.Text) return result;
    if (visible(selected)) {
      const geometry = typeof feature.getGeometry === 'function' ? feature.getGeometry() : null;
      const pointGeometry = geometry && /Point$/.test(geometry.getType());
      const pointStyle = createPointStyle({ icon: selected.iconOptions, circle: selected.circle, regularShape: selected.regularShape }, styleApi);
      if (pointStyle) result = [pointStyle];
      else if (!pointGeometry && (selected.hasFill || selected.hasStroke || selected.pattern)) {
        result = [createPolygonStyle(Object.assign({}, selected, { meta: selected.pattern ? normalizePatternMeta(selected) : null }), styleApi)];
      }
    }
    for (let index = 0; index < result.length; index += 1) {
      const style = result[index];
      const image = style.getImage && style.getImage();
      if (!image || !style.clone || !style.setImage) continue;
      if (image.getDeclutterMode && image.getDeclutterMode() === 'none') continue;
      const options = {
        declutterMode: 'none',
        scale: image.getScale(),
        rotation: image.getRotation(),
        rotateWithView: image.getRotateWithView()
      };
      let replacement;
      if (image.getPoints && image.getPoints() !== Infinity && styleApi.RegularShape) {
        replacement = new styleApi.RegularShape(Object.assign(options, {
          points: image.getPoints(), radius: image.getRadius(), radius2: image.getRadius2(),
          angle: image.getAngle(), fill: image.getFill(), stroke: image.getStroke()
        }));
      } else if (image.getRadius && styleApi.Circle) {
        replacement = new styleApi.Circle(Object.assign(options, { radius: image.getRadius(), fill: image.getFill(), stroke: image.getStroke() }));
      } else if (image.getSrc && image.getSrc() && styleApi.Icon) {
        replacement = new styleApi.Icon(Object.assign(options, {
          src: image.getSrc(), opacity: image.getOpacity(), color: image.getColor() || undefined,
          anchor: image.getAnchor() || [0.5, 0.5], anchorXUnits: image.getAnchor() ? 'pixels' : 'fraction', anchorYUnits: image.getAnchor() ? 'pixels' : 'fraction',
          size: image.getSize() || undefined, offset: image.getOrigin() || undefined, crossOrigin: 'anonymous'
        }));
      }
      if (replacement) {
        const copy = style.clone();
        copy.setImage(replacement);
        result[index] = copy;
      }
    }
    if (visible(selected) && selected.circle && !result.length && styleApi.Circle) {
      result.push(new styleApi.Style({ image: new styleApi.Circle({
        declutterMode: 'none',
        radius: selected.circle.radius,
        fill: selected.circle.fill ? new styleApi.Fill(selected.circle.fill) : undefined,
        stroke: selected.circle.stroke ? new styleApi.Stroke(selected.circle.stroke) : undefined
      }) }));
    }
    (selected.labels || []).forEach(function (label) {
      if (!visible(label)) return;
      const text = String(label.text || '').replace(/\{\{([^}]+)\}\}|\[([^\]]+)\]/g, function (token, mustache, bracket) {
        const value = feature.get(mustache || bracket);
        return value == null ? '' : String(value);
      });
      if (!text.trim()) return;
      const options = Object.assign({}, label, {
        text: text,
        fill: label.fill ? new styleApi.Fill(label.fill) : undefined,
        stroke: label.stroke ? new styleApi.Stroke(label.stroke) : undefined,
        backgroundFill: label.backgroundFill ? new styleApi.Fill(label.backgroundFill) : undefined,
        backgroundStroke: label.backgroundStroke ? new styleApi.Stroke(label.backgroundStroke) : undefined,
        padding: Array.isArray(label.padding) ? label.padding : [6, 6, 6, 6]
      });
      result.push(new styleApi.Style({ text: new styleApi.Text(options) }));
    });
    return result;
  }

  window.qtilerHajkRuleLabels = renderRuleLabels;

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
    const styleApi = getOlStyleApi();
    if (!styleApi) return null;
    const normalized = normalizePatternMeta(meta);
    const cacheKey = `${styleName}::${makePatternKey(normalized)}`;
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);

    const Style = styleApi.Style;
    const Fill = styleApi.Fill;
    const Stroke = styleApi.Stroke;
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

  function extractPolygonStyleRulesFromStyleDef(styleDef) {
    if (!Array.isArray(styleDef)) return [];
    const out = [];
    styleDef.forEach(function (ruleArr, index) {
      const entries = Array.isArray(ruleArr) ? ruleArr : [ruleArr];
      const geomEntry = entries.find(function (entry) {
        return entry && typeof entry === 'object' && (entry.fill || entry.stroke) && !entry.text;
      });
      if (!geomEntry) return;
      const patternMeta = geomEntry.qtilerPatternStyle && typeof geomEntry.qtilerPatternStyle === 'object'
        ? geomEntry.qtilerPatternStyle
        : null;
      const rawPattern = String(patternMeta && patternMeta.fillPattern || '').trim().toLowerCase();
      const hasPattern = ['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(rawPattern);
      out.push({
        index: index,
        filter: String(geomEntry.filter || '').trim(),
        hasFill: !!geomEntry.fill,
        label: String(geomEntry.legendLabel || geomEntry.label || geomEntry.filter || ''),
        hasStroke: !!geomEntry.stroke,
        fillColor: geomEntry.fill && geomEntry.fill.color ? geomEntry.fill.color : null,
        strokeColor: geomEntry.stroke && geomEntry.stroke.color ? geomEntry.stroke.color : null,
        strokeWidth: Number(geomEntry.stroke && geomEntry.stroke.width),
        lineDash: Array.isArray(geomEntry.stroke && geomEntry.stroke.lineDash) ? geomEntry.stroke.lineDash.map(Number).filter(Number.isFinite) : [],
        meta: hasPattern ? normalizePatternMeta({
          pattern: rawPattern,
          angle: patternMeta.fillPatternAngle,
          spacing: patternMeta.fillPatternSpacing,
          size: patternMeta.fillPatternSize,
          transparentBackground: patternMeta.fillPatternTransparent === true,
          fillColor: geomEntry.fill && geomEntry.fill.color,
          strokeColor: geomEntry.stroke && geomEntry.stroke.color,
          strokeWidth: geomEntry.stroke && geomEntry.stroke.width,
          lineDash: geomEntry.stroke && geomEntry.stroke.lineDash
        }) : null
      });
    });
    return out;
  }

  function extractPointStyleRulesFromStyleDef(styleDef) {
    if (!Array.isArray(styleDef)) return [];
    const out = [];
    styleDef.forEach(function (ruleArr, index) {
      const entries = Array.isArray(ruleArr) ? ruleArr : [ruleArr];
      const geomEntry = entries.find(function (entry) {
        return entry && typeof entry === 'object' && (entry.icon || entry.circle || entry.regularShape) && !entry.text;
      });
      if (!geomEntry) return;
      out.push({
        index: index,
        filter: String(geomEntry.filter || '').trim(),
        icon: geomEntry.icon && typeof geomEntry.icon === 'object' ? geomEntry.icon : null,
        label: String(geomEntry.legendLabel || geomEntry.label || geomEntry.filter || ''),
        regularShape: geomEntry.regularShape && typeof geomEntry.regularShape === 'object' ? geomEntry.regularShape : null,
        circle: geomEntry.circle && typeof geomEntry.circle === 'object' ? geomEntry.circle : null
      });
    });
    return out;
  }

  function selectStyleRule(styleRules, feature, geomStyle) {
    if (!Array.isArray(styleRules) || !styleRules.length) return null;
    const stroke = geomStyle && typeof geomStyle.getStroke === 'function' ? geomStyle.getStroke() : null;
    const fill = geomStyle && typeof geomStyle.getFill === 'function' ? geomStyle.getFill() : null;
    const styleFill = normalizeColorSignature(fill && typeof fill.getColor === 'function' ? fill.getColor() : '');
    const styleStroke = normalizeColorSignature(stroke && typeof stroke.getColor === 'function' ? stroke.getColor() : '');
    const styleWidth = Number(stroke && typeof stroke.getWidth === 'function' ? stroke.getWidth() : NaN);
    const styleDash = normalizeDashSignature(stroke && typeof stroke.getLineDash === 'function' ? stroke.getLineDash() : []);
    const filtered = styleRules.filter(function (entry) {
      return evaluateFilterExpression(entry.filter, feature);
    });
    const candidates = filtered;
    const exact = candidates.find(function (entry) {
      return (!entry.fillColor || normalizeColorSignature(entry.fillColor) === styleFill)
        && (!entry.strokeColor || normalizeColorSignature(entry.strokeColor) === styleStroke)
        && (!Number.isFinite(entry.strokeWidth) || entry.strokeWidth === styleWidth)
        && (!entry.lineDash || normalizeDashSignature(entry.lineDash) === styleDash);
    });
    return exact || candidates[0] || null;
  }

  function createPolygonStyle(rule, styleApi) {
    if (!rule || !styleApi) return null;
    const Style = styleApi.Style;
    const Fill = styleApi.Fill;
    const Stroke = styleApi.Stroke;
    const fillColor = rule.hasFill ? (rule.meta ? createCanvasPattern(rule.meta) : (rule.fillColor || 'rgba(0,0,0,0)')) : 'rgba(0,0,0,0)';
    const strokeColor = rule.hasStroke ? (rule.strokeColor || 'rgba(37, 99, 235, 1)') : 'rgba(0,0,0,0)';
    const strokeWidth = Number.isFinite(Number(rule.strokeWidth)) ? Number(rule.strokeWidth) : 1;
    return new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({
        color: strokeColor,
        width: strokeWidth,
        lineDash: Array.isArray(rule.lineDash) && rule.lineDash.length ? rule.lineDash.map(Number) : undefined
      })
    });
  }

  function buildPolygonWrappingStyleFunction(styleName, originalStyle, styleRules, styleApi) {
    if (!styleApi || !Array.isArray(styleRules) || !styleRules.length) return null;
    const Fill = styleApi.Fill;
    const Stroke = styleApi.Stroke;
    const cacheKey = styleName + '::polygon-wrapper::' + JSON.stringify(styleRules.map(function (entry) {
      return { index: entry.index, filter: entry.filter, hasFill: entry.hasFill, hasStroke: entry.hasStroke, fillColor: entry.fillColor, strokeColor: entry.strokeColor, strokeWidth: entry.strokeWidth, lineDash: entry.lineDash, meta: entry.meta };
    }));
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    const fn = function polygonWrappingStyle(feature, resolution) {
      const sourceStyles = getStyleArray(originalStyle, feature, resolution);
      const styleArray = Array.isArray(sourceStyles) ? sourceStyles : (sourceStyles ? [sourceStyles] : []);
      const geomIndex = styleArray.findIndex(function (style) {
        return style
          && typeof style.getFill === 'function'
          && !(style.getImage && style.getImage())
          && !(style.getText && style.getText());
      });
      const geomStyle = geomIndex >= 0 ? styleArray[geomIndex] : null;
      const selected = selectStyleRule(styleRules, feature, geomStyle);
      if (!selected) return [];
      if (!styleArray.length || geomIndex < 0) return [createPolygonStyle(selected, styleApi)].filter(Boolean);
      const cloned = styleArray.map(function (style, index) {
        if (index !== geomIndex || !style || typeof style.clone !== 'function') return style;
        const copy = style.clone();
        const fillColor = selected.hasFill ? (selected.meta ? createCanvasPattern(selected.meta) : (selected.fillColor || 'rgba(0,0,0,0)')) : 'rgba(0,0,0,0)';
        copy.setFill(new Fill({ color: fillColor }));
        copy.setStroke(new Stroke({
          color: selected.hasStroke ? (selected.strokeColor || 'rgba(37, 99, 235, 1)') : 'rgba(0,0,0,0)',
          width: Number.isFinite(Number(selected.strokeWidth)) ? Number(selected.strokeWidth) : 1,
          lineDash: Array.isArray(selected.lineDash) && selected.lineDash.length ? selected.lineDash.map(Number) : undefined
        }));
        return copy;
      });
      return Array.isArray(sourceStyles) ? cloned : cloned[0];
    };
    styleCache.set(cacheKey, fn);
    return fn;
  }

  function createPointStyle(rule, styleApi) {
    if (!rule || !styleApi) return null;
    const Style = styleApi.Style;
    const Fill = styleApi.Fill;
    const Stroke = styleApi.Stroke;
    if (!rule.icon && !rule.circle && !rule.regularShape) return null;
    const cacheKey = 'point-symbol::' + JSON.stringify(rule);
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    if (rule.icon && rule.icon.src && styleApi.Icon) {
      const rawScale = rule.icon.scale == null ? NaN : Number(rule.icon.scale);
      const pixelSize = Number(rule.icon.pixelSize);
      const targetSize = Math.max(4, Math.min(120, Number.isFinite(pixelSize) && pixelSize > 0 ? pixelSize : (Number.isFinite(rawScale) && rawScale >= 0 ? rawScale * 480 : 24)));
      const options = {
        src: String(rule.icon.src),
        scale: rawScale === 0 && !pixelSize ? 0 : targetSize / 480,
        declutterMode: 'none',
        opacity: rule.icon.opacity != null && Number.isFinite(Number(rule.icon.opacity)) ? Math.max(0, Math.min(1, Number(rule.icon.opacity))) : 1,
        anchor: Array.isArray(rule.icon.anchor) ? rule.icon.anchor.map(Number) : [0.5, 0.5],
        anchorXUnits: rule.icon.anchorXUnits || (Math.abs(Number(rule.icon.anchor?.[0] ?? 0.5)) <= 1 ? 'fraction' : 'pixels'),
        anchorYUnits: rule.icon.anchorYUnits || (Math.abs(Number(rule.icon.anchor?.[1] ?? 0.5)) <= 1 ? 'fraction' : 'pixels'),
        rotation: Number(rule.icon.rotation) || 0,
        rotateWithView: rule.icon.rotateWithView === true,
        crossOrigin: 'anonymous'
      };
      if (rule.icon.color && !/\/(?:qgis-svg-colored|qtiler-symbology-svg-colored)\//i.test(options.src)) options.color = rule.icon.color;
      const image = new styleApi.Icon(options);
      const fitImage = function () {
        const size = image.getSize && image.getSize();
        if (size && Math.max(size[0], size[1]) > 0 && !(rawScale === 0 && !pixelSize)) image.setScale(targetSize / Math.max(size[0], size[1]));
      };
      fitImage();
      if (image.listenImageChange) image.listenImageChange(fitImage);
      const style = new Style({ image: image });
      styleCache.set(cacheKey, style);
      return style;
    }
    const shape = rule.regularShape || rule.circle;
    const Shape = rule.regularShape ? styleApi.RegularShape : styleApi.Circle;
    if (shape && Shape) {
      const fillColor = shape.fill && shape.fill.color ? shape.fill.color : 'rgba(0,0,0,0)';
      const strokeColor = shape.stroke && shape.stroke.color ? shape.stroke.color : 'rgba(0,0,0,0)';
      const style = new Style({
        image: new Shape({
          declutterMode: 'none',
          points: shape.points,
          radius2: shape.radius2,
          angle: shape.angle,
          rotation: shape.rotation,
          radius: Number.isFinite(Number(shape.radius)) ? Math.max(0, Math.min(120, Number(shape.radius))) : 6,
          fill: new Fill({ color: fillColor }),
          stroke: new Stroke({ color: strokeColor, width: Number.isFinite(Number(shape.stroke && shape.stroke.width)) ? Number(shape.stroke.width) : 1 })
        })
      });
      styleCache.set(cacheKey, style);
      return style;
    }
    return null;
  }

  function selectPointStyleRule(pointRules, feature) {
    return pointRules.find(function (entry) {
      return entry.filter && evaluateFilterExpression(entry.filter, feature);
    }) || pointRules.find(function (entry) {
      return !entry.filter;
    }) || null;
  }

  function buildPointWrappingStyleFunction(styleName, originalStyle, pointRules, styleApi) {
    if (!styleApi || !Array.isArray(pointRules) || !pointRules.length) return null;
    const cacheKey = styleName + '::point-wrapper::' + JSON.stringify(pointRules);
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    const fn = function pointWrappingStyle(feature, resolution) {
      const sourceStyles = getStyleArray(originalStyle, feature, resolution);
      const styleArray = Array.isArray(sourceStyles) ? sourceStyles : (sourceStyles ? [sourceStyles] : []);
      const selected = selectPointStyleRule(pointRules, feature);
      if (!selected) return [];
      const geometryStyle = createPointStyle(selected, styleApi);
      if (!geometryStyle) return sourceStyles;
      const textStyles = styleArray.filter(function (style) {
        return style && typeof style.getText === 'function' && style.getText();
      });
      const result = [geometryStyle].concat(textStyles);
      return Array.isArray(sourceStyles) ? result : result[0];
    };
    styleCache.set(cacheKey, fn);
    return fn;
  }

  function buildPatternWrappingStyleFunction(styleName, originalStyle, patternRules, styleApi) {
    const Fill = styleApi.Fill;
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
    cfg = cfg || window.__QTILER2HAJK_CONFIG || null;
    const patternStyles = cfg && cfg.qtilerPatternStyles && typeof cfg.qtilerPatternStyles === 'object'
      ? cfg.qtilerPatternStyles
      : null;
    const styleDefs = cfg && cfg.styles && typeof cfg.styles === 'object' ? cfg.styles : null;
    const hasLegacyPatterns = !!(patternStyles && Object.keys(patternStyles).length);
    const hasEmbeddedPatterns = !!(styleDefs && Object.keys(styleDefs).some(function (styleName) {
      return extractPatternRulesFromStyleDef(styleDefs[styleName]).length > 0;
    }));
    const hasEmbeddedPolygonStyles = !!(styleDefs && Object.keys(styleDefs).some(function (styleName) {
      return extractPolygonStyleRulesFromStyleDef(styleDefs[styleName]).length > 0;
    }));
    const hasEmbeddedPointStyles = !!(styleDefs && Object.keys(styleDefs).some(function (styleName) {
      return extractPointStyleRulesFromStyleDef(styleDefs[styleName]).length > 0;
    }));
    if (!hasLegacyPatterns && !hasEmbeddedPatterns && !hasEmbeddedPolygonStyles && !hasEmbeddedPointStyles) return;

    const viewer = origoApp && typeof origoApp.api === 'function' ? origoApp.api() : null;
    const publicApi = window.hajkPublicApi || null;
    const publicMap = publicApi && (publicApi.olMap || (typeof publicApi.getMap === 'function' ? publicApi.getMap() : null));
    const legacyApp = window.hajkApp || window.origoApp || origoApp || null;
    const legacyViewer = legacyApp && typeof legacyApp.api === 'function' ? legacyApp.api() : null;
    const map = publicMap
      || (viewer && typeof viewer.getMap === 'function' ? viewer.getMap() : null)
      || (legacyViewer && typeof legacyViewer.getMap === 'function' ? legacyViewer.getMap() : null);
    const styleApi = getOlStyleApi();
    if (!map || typeof map.getLayers !== 'function') return;

    const vectorStyleByLayerKey = new Map();
    const vectorLayers = cfg && cfg.layersConfig && Array.isArray(cfg.layersConfig.vectorlayers)
      ? cfg.layersConfig.vectorlayers
      : [];
    vectorLayers.forEach(function (layerDef) {
      const styleName = String(layerDef && layerDef.style || '').trim();
      if (!styleName) return;
      ['id', 'caption', 'layer', 'name'].forEach(function (key) {
        const value = String(layerDef && layerDef[key] || '').trim();
        if (value) vectorStyleByLayerKey.set(value, styleName);
      });
    });

    function getLayerStyleName(layer) {
      const props = layer && typeof layer.getProperties === 'function' ? layer.getProperties() : {};
      const candidates = [
        layer.get('styleName'), layer.get('style'), layer.get('id'), layer.get('name'), layer.get('title'), layer.get('caption'),
        props && props.styleName, props && props.style, props && props.id, props && props.name, props && props.title, props && props.caption, props && props.layer
      ].map(function (value) { return String(value || '').trim(); }).filter(Boolean);
      for (const candidate of candidates) {
        if ((styleDefs && styleDefs[candidate]) || (patternStyles && patternStyles[candidate])) return candidate;
        if (vectorStyleByLayerKey.has(candidate)) return vectorStyleByLayerKey.get(candidate);
      }
      if (vectorLayers.length === 1) return String(vectorLayers[0].style || '').trim();
      return '';
    }

    eachLayer(map.getLayers(), function (layer) {
      if (!layer || typeof layer.get !== 'function' || typeof layer.setStyle !== 'function') return;
      const styleName = getLayerStyleName(layer);
      if (!styleName) return;
      const currentCategories = categoryLayers.get(layer);
      if (currentCategories && layer.getStyle() === currentCategories.styleFn) return;
      if (runtimeLabelStyles.get(layer) === layer.getStyle()) return;
      const runtimeLayerDef = vectorLayers.find(function (entry) { return entry.style === styleName; });
      const runtimeRules = runtimeLayerDef && runtimeLayerDef.qtilerStyleRules;
      if (runtimeRules && typeof layer.setDeclutter === 'function') layer.setDeclutter('qtiler-labels');
      const embeddedRules = styleDefs ? extractPatternRulesFromStyleDef(styleDefs[styleName]) : [];
      const polygonRules = styleDefs ? extractPolygonStyleRulesFromStyleDef(styleDefs[styleName]) : [];
      const pointRules = styleDefs ? extractPointStyleRulesFromStyleDef(styleDefs[styleName]) : [];
      const categoryRules = pointRules.length ? pointRules : polygonRules;
      if (!styleApi && !categoryRules.some(function (rule) { return !!rule.filter; })) return;
      const legacyMeta = patternStyles && patternStyles[styleName] && !Array.isArray(patternStyles[styleName])
        ? patternStyles[styleName]
        : null;
      const nativeStyle = layer.getStyle();
      let styleFn = !styleApi
        ? function (feature, resolution) { return getStyleArray(nativeStyle, feature, resolution); }
        : pointRules.length
        ? buildPointWrappingStyleFunction(styleName, layer.getStyle(), pointRules, styleApi)
        : polygonRules.length
        ? buildPolygonWrappingStyleFunction(styleName, layer.getStyle(), polygonRules, styleApi)
        : embeddedRules.length
        ? buildPatternWrappingStyleFunction(styleName, layer.getStyle(), embeddedRules, styleApi)
        : (legacyMeta ? buildPatternStyleFunction(styleName, legacyMeta) : null);
      if (!styleFn) return;
      if (runtimeRules) {
        const geometryStyleFn = styleFn;
        styleFn = function (feature, resolution) {
          return renderRuleLabels(feature, resolution, getStyleArray(geometryStyleFn, feature, resolution), runtimeRules);
        };
      }
      try {
        const rules = pointRules.length ? pointRules : polygonRules;
        if (rules.some(function (rule) { return !!rule.filter; })) {
          const layerDef = vectorLayers.find(function (entry) {
            return entry.style === styleName && [entry.id, entry.layer, entry.name, entry.caption].some(function (value) {
              return value && [layer.get('id'), layer.get('name'), layer.get('caption')].includes(value);
            });
          });
          const state = {
            rules: rules,
            disabled: currentCategories ? currentCategories.disabled : new Set(),
            layerDef: layerDef || {},
            styleFn: null
          };
          state.styleFn = buildCategoryStyleFunction(styleFn, state);
          categoryLayers.set(layer, state);
          layer.setStyle(state.styleFn);
        } else {
          layer.setStyle(styleFn);
          runtimeLabelStyles.set(layer, styleFn);
        }
      } catch (err) {
        console.warn('[Qtiler2Hajk] Failed to apply runtime pattern style for', styleName, err);
      }
    });
    mountCategoryControls();
  }

  function buildCategoryStyleFunction(styleFn, state) {
    return function categoryStyle(feature, resolution) {
      const selected = selectStyleRule(state.rules, feature, null);
      if (!selected || state.disabled.has(selected.index)) return [];
      return styleFn(feature, resolution);
    };
  }

  function createCategorySwatch(rule) {
    const styleApi = getOlStyleApi();
    const style = styleApi ? createPointStyle(rule, styleApi) : null;
    if (style && style.getImage()) {
      const image = style.getImage();
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 56;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'display:inline-block;width:32px;height:28px;flex:0 0 32px;';
      const paint = function () {
        if (image.getImageState && image.getImageState() !== 2) return;
        const surface = image.getImage(1);
        const width = surface.naturalWidth || surface.width;
        const height = surface.naturalHeight || surface.height;
        if (!width || !height) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const size = Math.min(48 / width, 40 / height);
        context.clearRect(0, 0, 64, 56);
        context.save();
        context.translate(32, 28);
        context.rotate(image.getRotation ? image.getRotation() : 0);
        context.globalAlpha = image.getOpacity ? image.getOpacity() : 1;
        context.drawImage(surface, -width * size / 2, -height * size / 2, width * size, height * size);
        context.restore();
        if (image.unlistenImageChange) image.unlistenImageChange(paint);
      };
      if (image.listenImageChange) image.listenImageChange(paint);
      if (image.load) image.load();
      paint();
      return canvas;
    }
    const swatch = document.createElement(rule.icon && rule.icon.src ? 'img' : 'span');
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.cssText = 'display:inline-block;width:26px;height:16px;flex-shrink:0;box-sizing:border-box;';
    if (rule.icon && rule.icon.src) {
      swatch.src = rule.icon.src;
      swatch.alt = '';
      swatch.style.objectFit = 'contain';
    } else {
      swatch.style.backgroundColor = rule.fillColor || (rule.circle && rule.circle.fill && rule.circle.fill.color) || 'transparent';
      swatch.style.border = '2px solid ' + (rule.strokeColor || (rule.circle && rule.circle.stroke && rule.circle.stroke.color) || 'transparent');
      swatch.style.borderRadius = rule.circle ? '50%' : '2px';
      if (rule.meta) swatch.style.backgroundImage = 'repeating-linear-gradient(135deg,transparent,transparent 4px,' + (rule.strokeColor || '#333') + ' 4px,' + (rule.strokeColor || '#333') + ' 5px)';
    }
    return swatch;
  }

  function mountCategoryControls() {
    if (!document.body || !categoryLayers.size) return;
    const backButton = document.getElementById('layer-item-details-back-button');
    if (!backButton) return;
    let panel = backButton.parentElement;
    const heading = panel.cloneNode(true);
    heading.querySelectorAll('button').forEach(function (button) { button.remove(); });
    const layerCaption = heading.textContent.trim();
    while (panel && !panel.querySelector('#toggle-legend-icon')) panel = panel.parentElement;
    if (!panel) return;
    categoryLayers.forEach(function (state, layer) {
      if (state.layerDef.caption && state.layerDef.caption !== layerCaption) return;
      const legend = state.layerDef.legendIcon || state.layerDef.legend;
      if (!legend) return;
      const images = Array.from(panel.querySelectorAll('img')).filter(function (image) {
        return image.getAttribute('src') === legend && !image.closest('.qtiler-category-controls');
      });
      images.forEach(function (image) {
        const parent = image.parentElement;
        if (!parent) return;
        const existing = parent.querySelector('.qtiler-category-controls');
        if (existing && categoryControlStates.get(existing) === state) return;
        if (existing) existing.remove();
        const controls = document.createElement('div');
        controls.className = 'qtiler-category-controls';
        categoryControlStates.set(controls, state);
        const language = String(document.documentElement.lang || 'sv').slice(0, 2);
        const captions = { en: ['Categories', 'Default'], es: ['Categorías', 'Por defecto'], sv: ['Kategorier', 'Standard'], no: ['Kategorier', 'Standard'], da: ['Kategorier', 'Standard'], fi: ['Luokat', 'Oletus'] };
        const caption = captions[language] || captions.en;
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', caption[0]);
        state.rules.forEach(function (rule) {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer;font:inherit;';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !state.disabled.has(rule.index);
          checkbox.style.cssText = 'width:16px;height:16px;margin:0;accent-color:#1976d2;flex-shrink:0;';
          checkbox.addEventListener('change', function () {
            if (checkbox.checked) state.disabled.delete(rule.index);
            else state.disabled.add(rule.index);
            layer.changed();
          });
          const swatch = createCategorySwatch(rule);
          const label = document.createElement('span');
          label.textContent = rule.label || caption[1];
          label.style.cssText = 'overflow-wrap:anywhere;min-width:0;';
          row.append(checkbox, swatch, label);
          controls.appendChild(row);
        });
        image.hidden = true;
        image.style.display = 'none';
        parent.appendChild(controls);
      });
    });
  }

  function getRealHajkMap() {
    var publicApi = window.hajkPublicApi || null;
    if (!publicApi) return null;
    if (publicApi.olMap) return publicApi.olMap;
    if (typeof publicApi.getMap === 'function') {
      try {
        var map = publicApi.getMap();
        if (map) return map;
      } catch (err) { /* not ready yet */ }
    }
    return null;
  }

  function wfsCellEnabled(model) {
    if (window.QTILER_WFS_CELLS_DISABLED === true || model.config?.loadingStrategy === 'all') return false;
    try {
      const url = new URL(model.config.url, window.location.href);
      return url.origin === window.location.origin && /^\/wfs\/?$/i.test(url.pathname) && url.searchParams.has('project');
    } catch { return false; }
  }

  function pumpWfsCells() {
    while (wfsCellRunning < 2) {
      let index = wfsCellQueue.findIndex(function (job) { return !job.owner.moving && job.owner !== wfsCellPreviousOwner; });
      if (index < 0) index = wfsCellQueue.findIndex(function (job) { return !job.owner.moving; });
      if (index < 0) return;
      const job = wfsCellQueue.splice(index, 1)[0];
      job.signal.removeEventListener('abort', job.abort);
      if (job.signal.aborted) { job.reject(job.signal.reason); continue; }
      wfsCellPreviousOwner = job.owner;
      wfsCellRunning++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(function () { wfsCellRunning--; pumpWfsCells(); });
    }
  }

  function queueWfsCell(owner, signal, run) {
    return new Promise(function (resolve, reject) {
      if (signal.aborted) { reject(signal.reason); return; }
      if (wfsCellQueue.length >= 128) { reject(Object.assign(new Error('WFS client queue full'), { status: 503 })); return; }
      const job = { owner, signal, run, resolve, reject };
      job.abort = function () {
        const index = wfsCellQueue.indexOf(job);
        if (index >= 0) wfsCellQueue.splice(index, 1);
        signal.removeEventListener('abort', job.abort);
        reject(signal.reason);
      };
      signal.addEventListener('abort', job.abort, { once: true });
      wfsCellQueue.push(job);
      pumpWfsCells();
    });
  }

  function discardWfsCell(state, key, clearSource) {
    const cell = state.cells.get(key);
    if (!cell) return;
    state.cells.delete(key);
    wfsCellCache.delete(cell);
    wfsCellBytes -= cell.bytes;
    state.model.vectorSource.removeLoadedExtent(cell.extent);
    cell.features.forEach(function (feature) {
      const id = feature.getId();
      const reference = state.features.get(id);
      if (!reference) return;
      reference.count--;
      if (reference.count <= 0) {
        state.features.delete(id);
        if (clearSource) {
          const existing = state.model.vectorSource.getFeatureById(id);
          if (existing) state.model.vectorSource.removeFeature(existing);
        }
      }
    });
    state.model.allFeatures = Array.from(state.features.values(), function (entry) { return entry.feature; });
  }

  function getWfsCellState(model) {
    let state = wfsCellStates.get(model);
    if (state) return state;
    state = { model, moving: false, cells: new Map(), features: new Map(), pending: new Map(), needed: new Set(), bound: false };
    wfsCellStates.set(model, state);
    const prune = function () {
      const map = model.map;
      const size = map.getSize?.();
      if (!size) return;
      const view = map.getView();
      const extent = view.calculateExtent(size);
      const visible = !model.layer || typeof model.layer.isVisible !== 'function' || model.layer.isVisible(view);
      if (!visible) state.needed.clear();
      state.pending.forEach(function (entry) {
        const cell = entry.extent;
        if (!visible || cell[2] <= extent[0] || cell[0] >= extent[2] || cell[3] <= extent[1] || cell[1] >= extent[3]) entry.controller.abort();
      });
    };
    state.prune = prune;
    model.map?.on?.('movestart', function () { state.moving = true; });
    model.map?.on?.('moveend', function () { state.moving = false; prune(); pumpWfsCells(); });
    const view = model.map?.getView?.();
    view?.on?.('change:center', prune);
    view?.on?.('change:resolution', prune);
    return state;
  }

  function subtractWfsCoverage(extent, covered) {
    const left = Math.max(extent[0], covered[0]), right = Math.min(extent[2], covered[2]);
    const bottom = Math.max(extent[1], covered[1]), top = Math.min(extent[3], covered[3]);
    if (left >= right || bottom >= top) return [extent];
    const remaining = [];
    if (extent[0] < left) remaining.push([extent[0], extent[1], left, extent[3]]);
    if (right < extent[2]) remaining.push([right, extent[1], extent[2], extent[3]]);
    if (extent[1] < bottom) remaining.push([left, extent[1], right, bottom]);
    if (top < extent[3]) remaining.push([left, top, right, extent[3]]);
    return remaining;
  }

  function wfsCellStrategy(model) {
    return function (extent, resolution) {
      if (!wfsCellEnabled(model) || !extent.every(Number.isFinite) || !(resolution > 0)) return [extent];
      const state = getWfsCellState(model);
      state.cells.forEach(function (cell, key) {
        if (Date.now() - cell.at > 120000) discardWfsCell(state, key, true);
      });
      if (!state.cells.size && !state.pending.size) {
        state.needed = new Set([extent.join(',')]);
        return [extent];
      }
      const size = model.map.getSize?.();
      const visible = size ? model.map.getView().calculateExtent(size) : extent;
      const target = [Math.max(extent[0], visible[0]), Math.max(extent[1], visible[1]), Math.min(extent[2], visible[2]), Math.min(extent[3], visible[3])];
      if (target[0] >= target[2] || target[1] >= target[3]) return [];
      const intersects = function (cell) { return cell[2] > target[0] && cell[0] < target[2] && cell[3] > target[1] && cell[1] < target[3]; };
      state.needed = new Set();
      state.pending.forEach(function (entry, key) {
        if (!intersects(entry.extent)) entry.controller.abort();
        else state.needed.add(key);
      });
      state.cells.forEach(function (cell, key) {
        if (intersects(cell.extent)) {
          state.needed.add(key);
          wfsCellMetrics.reusedCells++;
          wfsCellCache.delete(cell); wfsCellCache.set(cell, state);
        }
      });
      let span = 512 * Math.pow(2, Math.ceil(Math.log2(resolution)));
      let left, right, bottom, top;
      for (;;) {
        left = Math.floor(target[0] / span); right = Math.ceil(target[2] / span);
        bottom = Math.floor(target[1] / span); top = Math.ceil(target[3] / span);
        if ((right - left) * (top - bottom) <= 9) break;
        span *= 2;
      }
      const cells = [];
      for (let column = left; column < right; column++) {
        for (let row = bottom; row < top; row++) {
          const cell = [Math.max(column * span, target[0]), Math.max(row * span, target[1]), Math.min((column + 1) * span, target[2]), Math.min((row + 1) * span, target[3])];
          let missing = [cell];
          const covered = [...Array.from(state.cells.values(), function (entry) { return entry.extent; }), ...Array.from(state.pending.values()).filter(function (entry) { return !entry.controller.signal.aborted; }).map(function (entry) { return entry.extent; })];
          for (const area of covered) {
            missing = missing.flatMap(function (part) { return subtractWfsCoverage(part, area); });
            if (missing.length > 32) { missing = [cell]; break; }
            if (!missing.length) break;
          }
          cells.push(...missing);
        }
      }
      cells.forEach(function (cell) { state.needed.add(cell.join(',')); });
      const center = [(target[0] + target[2]) / 2, (target[1] + target[3]) / 2];
      cells.sort(function (first, second) {
        const distance = function (cell) { return Math.hypot((cell[0] + cell[2]) / 2 - center[0], (cell[1] + cell[3]) / 2 - center[1]); };
        return distance(first) - distance(second);
      });
      return cells;
    };
  }

  function loadWfsCell(model, url, extent, success, failure, nativeFetch) {
    const state = getWfsCellState(model);
    const source = model.vectorSource;
    const key = extent.join(',');
    const controller = new AbortController();
    const signal = controller.signal;
    if (!state.bound) {
      state.bound = true;
      source.on('clear', function () {
        const previousFeatures = model.allFeatures;
        state.pending.forEach(function (entry) { entry.controller.abort(); });
        Array.from(state.cells.keys()).forEach(function (cellKey) { discardWfsCell(state, cellKey, false); });
        model.allFeatures = previousFeatures;
      });
      model.layer?.on?.('change:visible', state.prune);
    }
    const entry = { extent: extent.slice(), controller };
    state.pending.set(key, entry);
    const pause = function (delay) {
      return new Promise(function (resolve, reject) {
        if (signal.aborted) { reject(signal.reason); return; }
        const abort = function () { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = setTimeout(function () { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
      });
    };
    const run = async function () {
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        const result = await queueWfsCell(state, signal, async function () {
          signal.throwIfAborted();
          wfsCellMetrics.requests++;
          const response = await nativeFetch(model.proxyUrl + url, { signal });
          if (response.ok) return { response, text: await response.text() };
          try { await response.body?.cancel(); } catch {}
          return { response };
        });
        signal.throwIfAborted();
        if (result.response.status === 503 && attempt < 3) {
          const header = result.response.headers.get('Retry-After');
          const seconds = header && header.trim() ? Number(header) : NaN;
          const date = header ? Date.parse(header) : NaN;
          const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000 * Math.pow(2, attempt);
          if (delay <= 10000) { await pause(delay + Math.floor(Math.random() * 250)); continue; }
        }
        if (!result.response.ok) throw Object.assign(new Error('WFS HTTP ' + result.response.status), { status: result.response.status });
        if (/^\s*</.test(result.text) && model.config.params.outputFormat === 'application/json') throw new Error('WFS response is not GeoJSON');
        const features = model.getAllFeatures(result.text);
        signal.throwIfAborted();
        if (features.some(function (feature) { return feature.getId() == null; })) throw new Error('WFS cells require stable feature IDs');
        const unique = Array.from(new Map(features.map(function (feature) { return [feature.getId(), feature]; })).values());
        unique.forEach(function (feature) {
          const id = feature.getId();
          const reference = state.features.get(id);
          if (reference) reference.count++;
          else state.features.set(id, { feature, count: 1 });
        });
        const sharedFeatures = unique.map(function (feature) { return state.features.get(feature.getId()).feature; });
        const cell = { extent: extent.slice(), features: sharedFeatures, bytes: result.text.length * 2, at: Date.now(), key };
        state.cells.set(key, cell); wfsCellCache.set(cell, state); wfsCellBytes += cell.bytes;
        model.allFeatures = Array.from(state.features.values(), function (reference) { return reference.feature; });
        source.addFeatures(model.getFilteredFeatures(unique));
        for (const [cached, owner] of wfsCellCache) {
          if (wfsCellBytes <= 16 * 1024 * 1024 && wfsCellCache.size <= 64) break;
          if (!owner.needed.has(cached.key)) { discardWfsCell(owner, cached.key, true); wfsCellMetrics.evictions++; }
        }
        model.layer?.set?.('qtilerWfsLoadStatus', 'loaded', true);
        success?.(unique);
        return;
      }
    };
    return run().catch(function (error) {
      if (state.pending.get(key) === entry) source.removeLoadedExtent(extent);
      if (signal.aborted) wfsCellMetrics.cancelled++;
      else {
        model.layer?.set?.('qtilerWfsLoadStatus', 'error', true);
        model.layer?.set?.('qtilerWfsHttpStatus', error.status || null, true);
        console.warn('Hajk WFS cell could not be loaded', { layer: model.config.name, status: error.status || null });
      }
      failure?.();
    }).finally(function () { if (state.pending.get(key) === entry) state.pending.delete(key); });
  }

  window.qtilerHajkWfsCellStrategy = wfsCellStrategy;
  window.qtilerHajkWfsCellLoad = loadWfsCell;
  window.qtilerHajkWfsCellEnabled = wfsCellEnabled;
  window.qtilerHajkWfsCellStats = function () {
    return Object.assign({}, wfsCellMetrics, { queued: wfsCellQueue.length, running: wfsCellRunning, cachedCells: wfsCellCache.size, estimatedBytes: wfsCellBytes });
  };

  function installVectorScaleLimits() {
    const map = getRealHajkMap();
    const config = window.__QTILER2HAJK_CONFIG;
    const definitions = config && config.layersConfig && config.layersConfig.vectorlayers;
    if (!map || !Array.isArray(definitions)) return;
    const projection = map.getView().getProjection();
    const metersPerUnit = typeof projection.getMetersPerUnit === 'function' ? projection.getMetersPerUnit() : 1;
    if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) return;
    eachLayer(map.getLayers(), function (layer) {
      if (!layer || typeof layer.get !== 'function' || typeof layer.setMaxResolution !== 'function') return;
      const definition = definitions.find(function (entry) { return String(entry.id) === String(layer.get('name')); });
      if (!definition) return;
      const styles = definition.styles;
      const entries = Array.isArray(styles) && styles.length === 1 ? (Array.isArray(styles[0]) ? styles[0] : [styles[0]]) : [];
      const rule = entries.length === 1 && !entries[0]?.text ? entries[0] : null;
      const farScale = Number(rule?.maxScale) > 0 ? Number(rule.maxScale) : (Number(rule?.minZoom) > 40 ? Number(rule.minZoom) : null);
      const nearScale = Number(rule?.minScale) > 0 ? Number(rule.minScale) : (Number(rule?.maxZoom) > 40 ? Number(rule.maxZoom) : null);
      const maximum = Number(definition.maxResolution) > 0 ? Number(definition.maxResolution) : (farScale ? farScale * 0.00028 / metersPerUnit : null);
      const minimum = Number(definition.minResolution) > 0 ? Number(definition.minResolution) : (nearScale ? nearScale * 0.00028 / metersPerUnit : null);
      if (maximum !== null) {
        const inclusiveMaximum = maximum * (1 + 1e-10);
        if (layer.getMaxResolution() !== inclusiveMaximum) layer.setMaxResolution(inclusiveMaximum);
        if (rule && !(Number(rule.minZoom) >= 0 && Number(rule.minZoom) <= 40 && rule.minZoom !== null && rule.minZoom !== '')) {
          if (layer.getMinZoom() !== -Infinity) layer.setMinZoom(-Infinity);
        }
      }
      if (minimum !== null) {
        if (layer.getMinResolution() !== minimum) layer.setMinResolution(minimum);
        if (rule && !(Number(rule.maxZoom) >= 0 && Number(rule.maxZoom) <= 40 && rule.maxZoom !== null && rule.maxZoom !== '')) {
          if (layer.getMaxZoom() !== Infinity) layer.setMaxZoom(Infinity);
        }
      }
    });
  }

  function installWmsCancellation() {
    const map = getRealHajkMap();
    if (!map || typeof map.on !== 'function' || typeof map.getLayers !== 'function') return;
    let state = rasterCancellationMaps.get(map);
    if (!state) {
      state = { moving: false, sources: new WeakSet(), pending: new Set(), cancelled: new Map() };
      rasterCancellationMaps.set(map, state);
      map.on('movestart', function () {
        state.moving = true;
        state.pending.forEach(function (request) { request.controller.abort(); });
      });
      map.on('moveend', function () {
        state.moving = false;
        const sources = new Set();
        state.cancelled.forEach(function (source, tile) {
          if (tile.getState() === 3) tile.setState(0);
          sources.add(source);
        });
        state.cancelled.clear();
        sources.forEach(function (source) { source.changed(); });
      });
    }
    eachLayer(map.getLayers(), function (layer) {
      const source = layer && typeof layer.getSource === 'function' ? layer.getSource() : null;
      if (!source || state.sources.has(source) || typeof source.setTileLoadFunction !== 'function' || typeof source.getParams !== 'function') return;
      const urls = typeof source.getUrls === 'function' ? source.getUrls() : [];
      if (!urls || !urls.length || !urls.every(function (value) {
        try {
          const url = new URL(value, window.location.href);
          return url.origin === window.location.origin && /\/wms\/?$/i.test(url.pathname);
        } catch { return false; }
      })) return;
      state.sources.add(source);
      source.setTileLoadFunction(function (tile, url) {
        function markCancelled() {
          tile.setState(3);
          if (state.moving) state.cancelled.set(tile, source);
          else {
            tile.setState(0);
            source.changed();
          }
        }
        if (state.moving) { markCancelled(); return; }
        const controller = new AbortController();
        const request = { controller };
        state.pending.add(request);
        fetch(url, { credentials: 'same-origin', signal: controller.signal }).then(function (response) {
          if (!response.ok) throw new Error('WMS HTTP ' + response.status);
          return response.blob();
        }).then(function (blob) {
          controller.signal.throwIfAborted();
          return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            function abort() { reader.abort(); }
            function cleanup() {
              controller.signal.removeEventListener('abort', abort);
              reader.onload = reader.onerror = reader.onabort = null;
            }
            reader.onload = function () {
              cleanup();
              try {
                controller.signal.throwIfAborted();
                tile.getImage().src = reader.result;
                resolve();
              } catch (error) { reject(error); }
            };
            reader.onerror = function () {
              cleanup();
              reject(reader.error || new Error('WMS image could not be read'));
            };
            reader.onabort = function () {
              cleanup();
              reject(controller.signal.reason || new Error('WMS image was cancelled'));
            };
            controller.signal.addEventListener('abort', abort, { once: true });
            try { reader.readAsDataURL(blob); }
            catch (error) { cleanup(); reject(error); }
          });
        }).catch(function () {
          if (controller.signal.aborted) markCancelled();
          else tile.setState(3);
        }).finally(function () { state.pending.delete(request); });
      });
    });
  }

  // The Lantmäteriet search control was built against Origo's control
  // registry (window.Origo.controls) and is only ever activated inside
  // bootOrigo(), which real Hajk never calls (Hajk boots its own React app).
  // Without this, the control script loads but its button is never created,
  // so the "click on map for info" tool silently does nothing in real Hajk.
  // Mount it directly against the real Hajk map instead, bypassing Origo's
  // toolbar/control system entirely.
  function mountLantmateriForRealHajk() {
    if (window.Origo) return; // Origo path (preview) handles registration itself
    if (window.__qtilerLantmateriMounted) return;
    if (window.LANTMATERI_ENABLED !== true || typeof window.LantmateriSearch !== 'function') return;
    var map = getRealHajkMap();
    if (!map || typeof map.getTargetElement !== 'function') return;
    var container = map.getTargetElement();
    if (!container) return;
    try {
      var control = window.LantmateriSearch(window.LANTMATERI_CONFIG || {});
      var fakeViewer = {
        getMap: function () { return map; },
        getId: function () { return 'map'; }
      };
      var buttonEl = control && typeof control.onAdd === 'function' ? control.onAdd(fakeViewer) : null;
      if (!buttonEl) return;
      buttonEl.style.position = 'absolute';
      buttonEl.style.top = '80px';
      buttonEl.style.right = '8px';
      buttonEl.style.zIndex = '20';
      container.appendChild(buttonEl);
      window.__qtilerLantmateriMounted = true;
      console.log('[Qtiler2Hajk] Lantmäteriet search control mounted on the Hajk map');
    } catch (err) {
      console.warn('[Qtiler2Hajk] Failed to mount Lantmäteriet control for Hajk:', err);
    }
  }

  function scheduleAutoApply() {
    let attempts = 0;
    const tick = function () {
      attempts += 1;
      try {
        applyRuntimePatternStyles(window.hajkApp || window.origoApp || null, window.__QTILER2HAJK_CONFIG || null);
      } catch (err) {}
      try {
        mountLantmateriForRealHajk();
      } catch (err) {}
      try {
        installWmsCancellation();
      } catch (err) {}
      try {
        installVectorScaleLimits();
      } catch (err) {}
      if (attempts < 80) window.setTimeout(tick, 250);
    };
    tick();
  }

  // Real Hajk's layer details panel always starts with the legend collapsed
  // (local `legendIsActive` state, hardcoded to `useState(false)` in
  // LayerItemDetails.jsx, no config option exists for this). Auto-click the
  // "toggle-legend-icon" button the moment it appears so the legend shows
  // expanded by default when a layer's details are opened, without
  // overriding the user if they choose to collapse it again afterwards.
  var autoExpandedLegendButtons = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
  function autoExpandLayerLegend() {
    var btn = document.getElementById('toggle-legend-icon');
    if (!btn) return;
    if (autoExpandedLegendButtons) {
      if (autoExpandedLegendButtons.has(btn)) return;
      autoExpandedLegendButtons.add(btn);
    } else if (btn.__qtilerLegendAutoExpanded) {
      return;
    } else {
      btn.__qtilerLegendAutoExpanded = true;
    }
    try { btn.click(); } catch (err) { /* ignore */ }
  }

  function setupLegendAutoExpandObserver() {
    if (window.__qtilerLegendObserverStarted) return;
    if (typeof MutationObserver === 'undefined') return;
    if (!document.body) {
      // document.body isn't parsed yet when this script runs eagerly in
      // <head> - retry shortly instead of calling observe() on null, which
      // throws and (since __qtilerLegendObserverStarted was set first) used
      // to permanently disable the whole feature.
      window.setTimeout(setupLegendAutoExpandObserver, 50);
      return;
    }
    window.__qtilerLegendObserverStarted = true;
    autoExpandLayerLegend();
    var observer = new MutationObserver(function () {
      autoExpandLayerLegend();
      mountCategoryControls();
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
  window.addEventListener('qtiler2hajk-config-loaded', scheduleAutoApply);
  window.addEventListener('load', scheduleAutoApply);
  window.addEventListener('load', setupLegendAutoExpandObserver);
  setupLegendAutoExpandObserver();
})();
