// First log - absolutely first line
console.log('[FIRST-LOG] lantmateri-search.js file is being parsed');

/**
 * Lantmäteriet Info Control for Origo
 * 
 * Provides integration with Lantmäteriet's Fastighet och Befolkning API.
 * Adds a toolbar button that enables click-to-query mode on the map.
 * Similar to functionality found in Sokigo FB systems.
 * 
 * Usage:
 * - Click toolbar button to activate
 * - Click anywhere on map
 * - Link appears in info popup
 * - Click link to open modal with information options
 * - Select desired info and generate professional PDF report
 */

(function(window) {
  'use strict';
  
  console.log('[DEBUG] lantmateri-search.js script started loading');

const LantmateriSearch = function LantmateriSearch(options = {}) {
  console.log('[LantmateriSearch] Constructor called with options:', options);
  
  const {
    proxyUrl = '/plugins/Qtiler2Hajk/api/lantmateri-proxy',
    infoTypes = ['fastighet', 'befolkning', 'adress', 'ort', 'agare', 'taxering'],
    pointInfoTypes = ['markhojd', 'marktacke', 'hojd'],
    buttonIcon = '#fa-building',
    buttonTitle = 'Lantmäteriet Info',
    pdfTitle = 'Lantmäteriet — Informationsrapport'
  } = options;

  let viewer;
  let map;
  let target;
  let toolButton;
  let isActive = false;
  let clickListener;
  let lastClickCoords;
  let modal;
  let overlay;
  let pendingQuery = null;
  let queryMode = 'point';
  let modePanel = null;
  let areaSource = null;
  let areaLayer = null;
  let drawInteraction = null;

  const infoTypeLabels = {
    fastighet: 'Fastighet',
    befolkning: 'Befolkning',
    adress: 'Adress',
    ort: 'Ort',
    agare: 'Ägare',
    taxering: 'Taxering',
    byggnader: 'Byggnader',
    markdata: 'Markdata'
  };

  /**
   * Registry of LMV point-info products (one button per product, opens a small popup).
   * Adding a new API = one entry here + one env var on the backend.
   */
  const LMV_POINT_PRODUCTS = {
    markhojd: {
      label: 'Markhöjd',
      desc: 'Höjd över havet i punkten',
      icon: '⛰',
      format: function(d) {
        if (!d || d.error) return 'Ingen data tillgänglig';
        var h = (d.geometry && d.geometry.coordinates && d.geometry.coordinates[2]) != null
          ? d.geometry.coordinates[2]
          : (d.height != null ? d.height : (d.elevation != null ? d.elevation : null));
        return h != null ? ('Höjd: <strong>' + Number(h).toFixed(2) + ' m</strong>') : 'Ingen höjd hittades';
      }
    },
    marktacke: {
      label: 'Marktäcke',
      desc: 'Marktäcketyp i punkten',
      icon: '🌲',
      format: function(d) {
        if (!d || d.error) return 'Ingen data tillgänglig';
        // Multi-collection mode: { multi:true, collections:{ markytor:FC, sankmarksytor:FC } }
        if (d.multi && d.collections) {
          var collLabels = { markytor: 'Markyta', sankmarksytor: 'Sankmark' };
          var parts = [];
          Object.keys(d.collections).forEach(function(coll) {
            var fc = d.collections[coll];
            if (!fc || fc.error) return;
            var feats = (fc.features && fc.features.length) ? fc.features : [];
            if (!feats.length) return;
            var p = feats[0].properties || {};
            // Show the most descriptive available property
            var name = p.objekttyp || p.klass_sv || p.klassNamn || p.kategori
              || p.detaljtyp || p.markslag || p.typ || 'Okänd';
            var extra = [];
            if (p.objektidentitet) extra.push('id: ' + p.objektidentitet);
            if (p.skapad) extra.push('skapad: ' + String(p.skapad).slice(0, 10));
            parts.push('<div style="margin-bottom:6px;"><strong>' + (collLabels[coll] || coll) + ':</strong> '
              + name + (extra.length ? '<br/><span style="font-size:12px;color:#666;">' + extra.join(' · ') + '</span>' : '')
              + '</div>');
          });
          return parts.length ? parts.join('') : 'Inget marktäcke hittades i punkten';
        }
        var feats = (d.features && d.features.length) ? d.features : (Array.isArray(d) ? d : []);
        if (!feats.length) return 'Inget marktäcke hittades';
        var p = feats[0].properties || feats[0] || {};
        var name = p.klass_sv || p.klassNamn || p.name || p.kategori || p.objekttyp || 'Okänd';
        var code = p.klass_kod || p.kod || p.code || '';
        return 'Marktäcke: <strong>' + name + '</strong>' + (code ? ' (kod ' + code + ')' : '');
      }
    },
    hojd: {
      label: 'Höjd Direkt',
      desc: 'Höjddata från nationell höjdmodell (DEM)',
      icon: '📐',
      format: function(d) {
        if (!d || d.error) return 'Ingen data tillgänglig';
        var h = (d.geometry && d.geometry.coordinates && d.geometry.coordinates[2]) != null
          ? d.geometry.coordinates[2]
          : (d.hojd != null ? d.hojd : (d.elevation != null ? d.elevation : (d.height != null ? d.height : null)));
        var src = (d.properties && (d.properties.kalla || d.properties.source)) || '';
        return h != null
          ? 'Höjd: <strong>' + Number(h).toFixed(2) + ' m</strong>' + (src ? '<br/><span style="font-size:12px;color:#666;">Källa: ' + src + '</span>' : '')
          : 'Ingen höjd hittades';
      }
    }
  };
  let enabledPointProducts = [];

  function getProductsUrl() {
    return String(proxyUrl || '/plugins/Qtiler2Hajk/api/lantmateri-proxy')
      .replace(/\/api\/lantmateri-proxy.*$/, '/api/lantmateri-products');
  }

  function genericProductFormatter(data) {
    if (!data || data.error) return 'Ingen data tillgänglig';
    try {
      return '<pre style="white-space:pre-wrap;max-height:260px;overflow:auto;margin:0;">'
        + JSON.stringify(data, null, 2).replace(/[&<>]/g, function(ch) {
          return ch === '&' ? '&amp;' : (ch === '<' ? '&lt;' : '&gt;');
        })
        + '</pre>';
    } catch (_) {
      return String(data);
    }
  }

  async function refreshAvailablePointProducts() {
    try {
      var response = await fetch(getProductsUrl(), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      var items = Array.isArray(data.items) ? data.items : [];
      enabledPointProducts = items
        .filter(function(item) { return item && item.id && item.configured !== false && item.enabled !== false; })
        .map(function(item) {
          if (!LMV_POINT_PRODUCTS[item.id]) {
            LMV_POINT_PRODUCTS[item.id] = {
              label: item.label || item.id,
              desc: 'LMV Direkt',
              icon: 'ℹ',
              format: genericProductFormatter
            };
          } else if (item.label) {
            LMV_POINT_PRODUCTS[item.id].label = item.label;
          }
          return item.id;
        });
    } catch (err) {
      console.warn('[LantmateriSearch] LMV product availability failed:', err && err.message ? err.message : err);
      enabledPointProducts = [];
    }
  }
  refreshAvailablePointProducts();

  function getAreaReportUrl() {
    return String(proxyUrl || '/plugins/Qtiler2Hajk/api/lantmateri-proxy')
      .replace(/\/api\/lantmateri-proxy.*$/, '/api/lantmateri-area-report');
  }

  function getOl() {
    return window.ol || (window.Origo && window.Origo.ol);
  }

  function ensureAreaLayer() {
    if (!map || areaLayer) return;
    var ol = getOl();
    if (!ol || !ol.source || !ol.layer) return;
    areaSource = new ol.source.Vector();
    var style = null;
    if (ol.style && ol.style.Style) {
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({ color: 'rgba(74,144,226,0.95)', width: 3 }),
        fill: new ol.style.Fill({ color: 'rgba(74,144,226,0.18)' })
      });
    }
    areaLayer = new ol.layer.Vector({ source: areaSource, style: style });
    map.addLayer(areaLayer);
  }

  function stopAreaDraw() {
    if (map && drawInteraction) {
      map.removeInteraction(drawInteraction);
    }
    drawInteraction = null;
  }

  function setQueryMode(mode) {
    queryMode = mode === 'area' ? 'area' : 'point';
    if (modePanel) {
      modePanel.querySelectorAll('[data-lmv-mode]').forEach(function(btn) {
        var active = btn.getAttribute('data-lmv-mode') === queryMode;
        btn.style.background = active ? '#4a90e2' : '#fff';
        btn.style.color = active ? '#fff' : '#333';
      });
    }
    stopAreaDraw();
    if (clickListener) {
      map.un('singleclick', clickListener);
      clickListener = null;
    }
    if (queryMode === 'area') {
      startAreaDraw();
    } else if (map) {
      clickListener = map.on('singleclick', handleMapClick);
      map.getViewport().style.cursor = 'crosshair';
    }
  }

  function showModePanel() {
    if (modePanel || !map) return;
    modePanel = document.createElement('div');
    modePanel.className = 'lantmateri-mode-panel';
    modePanel.style.cssText = 'position:absolute;top:72px;left:12px;z-index:1000;background:#fff;border:1px solid #ccd4dd;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,0.18);padding:6px;display:flex;gap:6px;font-family:Arial,sans-serif;';
    modePanel.innerHTML = '<button type="button" data-lmv-mode="point" style="border:1px solid #ccd4dd;border-radius:4px;padding:7px 10px;cursor:pointer;">Punkt</button>'
      + '<button type="button" data-lmv-mode="area" style="border:1px solid #ccd4dd;border-radius:4px;padding:7px 10px;cursor:pointer;">Area</button>';
    modePanel.querySelectorAll('[data-lmv-mode]').forEach(function(btn) {
      btn.addEventListener('click', function() { setQueryMode(btn.getAttribute('data-lmv-mode')); });
    });
    map.getTargetElement().appendChild(modePanel);
    setQueryMode(queryMode);
  }

  function hideModePanel() {
    if (modePanel && modePanel.parentNode) modePanel.parentNode.removeChild(modePanel);
    modePanel = null;
  }

  function startAreaDraw() {
    if (!map) return;
    var ol = getOl();
    if (!ol || !ol.interaction || !ol.interaction.Draw || !ol.format || !ol.format.GeoJSON) {
      showToast('Area-ritning stöds inte i denna Origo/OpenLayers-version.', 'error');
      return;
    }
    ensureAreaLayer();
    if (!areaSource) return;
    areaSource.clear();
    map.getViewport().style.cursor = 'crosshair';
    drawInteraction = new ol.interaction.Draw({ source: areaSource, type: 'Polygon' });
    drawInteraction.on('drawend', function(event) {
      var srcProj = map.getView().getProjection();
      var nativeSrid = (srcProj && srcProj.getCode && srcProj.getCode()) || '';
      var format = new ol.format.GeoJSON();
      var geometry = event.feature.getGeometry();
      var wgs84Geometry = format.writeGeometryObject(geometry, { featureProjection: srcProj, dataProjection: 'EPSG:4326' });
      var nativeGeometry = format.writeGeometryObject(geometry, { featureProjection: srcProj, dataProjection: srcProj });
      pendingQuery = {
        type: 'area',
        geometry: wgs84Geometry,
        nativeGeometry: nativeGeometry,
        nativeSrid: nativeSrid
      };
      setTimeout(function() {
        stopAreaDraw();
        openInfoModal();
      }, 0);
    });
    map.addInteraction(drawInteraction);
  }

  /**
   * Handle map click when tool is active
   */
  function handleMapClick(event) {
    if (!isActive) return;

    const coords = event.coordinate;
    lastClickCoords = coords;

    // Native projection of the map (e.g. EPSG:3006 in Sweden)
    let nativeSrid = '';
    let lonLat = coords;
    try {
      const ol = window.ol || (window.Origo && window.Origo.ol);
      const srcProj = map.getView().getProjection();
      nativeSrid = (srcProj && srcProj.getCode && srcProj.getCode()) || '';
      if (ol && ol.proj && ol.proj.transform && nativeSrid && nativeSrid !== 'EPSG:4326') {
        lonLat = ol.proj.transform(coords, srcProj, 'EPSG:4326');
      }
    } catch (e) {
      console.warn('[LantmateriSearch] Transform failed:', e);
    }

    pendingQuery = {
      type: 'point',
      coords: coords,            // native projection (e.g. SWEREF99 TM easting/northing)
      lonLat: lonLat,            // WGS84 [lon, lat]
      nativeSrid: nativeSrid,    // e.g. 'EPSG:3006'
      pixel: event.pixel
    };

    console.log('[LantmateriSearch] Click coords:', coords, 'srid:', nativeSrid, 'wgs84:', lonLat);

    // TEST MODE: Open modal directly for complete flow test
    openInfoModal();
  }

  /**
   * Inject Lantmäteriet link into info popup
   */
  function injectLantmateriLink() {
    if (!pendingQuery) return;

    // Wait for info popup to be created
    setTimeout(() => {
      const infoWindow = document.querySelector('.o-identify');
      if (!infoWindow) return;

      // Check if link already exists
      if (infoWindow.querySelector('.lantmateri-info-link')) return;

      // Create link element
      const linkContainer = document.createElement('div');
      linkContainer.className = 'lantmateri-info-link-container';
      linkContainer.style.cssText = 'padding: 10px; border-top: 1px solid #ddd; margin-top: 10px;';

      const link = document.createElement('a');
      link.href = '#';
      link.className = 'lantmateri-info-link';
      link.innerHTML = `
        <svg class="o-icon-fa-14px" style="margin-right: 4px; vertical-align: middle;">
          <use href="${buttonIcon}"></use>
        </svg>
        <span>Hämta information från Lantmäteriet</span>
      `;
      link.style.cssText = 'color: #4a90e2; text-decoration: none; font-weight: 500; display: inline-flex; align-items: center;';
      
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openInfoModal();
      });

      linkContainer.appendChild(link);

      // Insert at the end of info content
      const contentArea = infoWindow.querySelector('.o-identify-content') || infoWindow;
      contentArea.appendChild(linkContainer);
    }, 100);
  }

  /**
   * Open modal for selecting information types
   */
  function openInfoModal() {
    if (!pendingQuery) {
      showToast('Ingen position vald. Klicka på kartan först.', 'warning');
      return;
    }

    closeModal(); // Close any existing modal

    // Create overlay
    overlay = document.createElement('div');
    overlay.className = 'lantmateri-modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Create modal
    modal = document.createElement('div');
    modal.className = 'lantmateri-modal';
    modal.style.cssText = `
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      padding: 0;
    `;

    const isAreaQuery = pendingQuery.type === 'area';
    const lonLat = pendingQuery.lonLat || [0, 0];
    const [lon, lat] = lonLat;

    // Build GDPR notice HTML (built outside template literal to avoid nested backticks)
    const gdprText = (window.LANTMATERI_CONFIG && window.LANTMATERI_CONFIG.gdprNotice)
      || 'Information från Lantmäteriet kan innehålla personuppgifter (t.ex. ägare, befolkning). Använd endast i tjänsteutövning enligt gällande regler.';
    const gdprLinks = (window.LANTMATERI_CONFIG && Array.isArray(window.LANTMATERI_CONFIG.gdprLinks))
      ? window.LANTMATERI_CONFIG.gdprLinks
      : [
          { label: 'Integritetspolicy', url: 'https://www.lantmateriet.se/sv/om-lantmateriet/Om-webbplatsen/integritetspolicy/' },
          { label: 'Villkor', url: 'https://www.lantmateriet.se/sv/Om-Lantmateriet/villkor/' }
        ];
    const gdprLinksHtml = gdprLinks.length
      ? '<br/>' + gdprLinks
          .filter(function(l) { return l && l.url && l.label; })
          .map(function(l) { return '<a href="' + l.url + '" target="_blank" rel="noopener" style="color:#4a90e2;">' + l.label + '</a>'; })
          .join(' · ')
      : '';

    // Build tab data: one tab for the PDF report + one tab per point-info product
    const pointTabs = isAreaQuery ? [] : (enabledPointProducts.length ? enabledPointProducts : [])
      .filter(function(id) { return (pointInfoTypes || []).indexOf(id) >= 0 || !pointInfoTypes || !pointInfoTypes.length; })
      .filter(function(id) { return LMV_POINT_PRODUCTS[id]; })
      .map(function(id) {
        var p = LMV_POINT_PRODUCTS[id];
        return { id: id, label: p.label, icon: p.icon, desc: p.desc };
      });
    const allTabs = [{ id: '__report__', label: 'Rapport (PDF)', icon: '📄' }].concat(pointTabs);

    const tabsBarHtml = allTabs.map(function(t, i) {
      var active = i === 0;
      return '<button type="button" class="lantmateri-tab" data-tab="' + t.id + '" style="'
        + 'flex:0 0 auto; padding:10px 14px; border:none; background:' + (active ? '#fff' : 'transparent')
        + '; border-bottom:3px solid ' + (active ? '#4a90e2' : 'transparent')
        + '; cursor:pointer; font-size:13px; color:' + (active ? '#4a90e2' : '#555')
        + '; font-weight:' + (active ? '600' : '400') + '; white-space:nowrap;">'
        + '<span style="margin-right:6px;">' + (t.icon || '') + '</span>' + t.label
        + '</button>';
    }).join('');

    const reportPanelHtml = `
      <div class="lantmateri-tab-panel" data-panel="__report__" style="display:block;">
        <p style="margin: 0 0 16px 0; font-size: 14px; color: #555;">
          ${isAreaQuery ? 'Välj vilken information du vill inkludera för det ritade området:' : 'Välj vilken information du vill inkludera i rapporten:'}
        </p>
        <div class="lantmateri-info-options" style="display: grid; gap: 10px;">
          ${infoTypes.map(type => `
            <label style="display: flex; align-items: center; padding: 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s;" class="info-option">
              <input type="checkbox" name="infoType" value="${type}" style="margin-right: 10px;" />
              <span style="font-size: 14px; color: #333;">${infoTypeLabels[type] || type}</span>
            </label>
          `).join('')}
        </div>
        <div class="lantmateri-modal-actions" style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="lantmateri-btn-cancel" style="padding: 10px 20px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">
            Stäng
          </button>
          <button class="lantmateri-btn-generate" style="padding: 10px 20px; border: none; background: #4a90e2; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">
            Generera Rapport
          </button>
        </div>
      </div>
    `;

    const pointPanelsHtml = pointTabs.map(function(t) {
      return '<div class="lantmateri-tab-panel" data-panel="' + t.id + '" style="display:none;">'
        + '<p style="margin:0 0 12px 0; font-size:14px; color:#555;">' + (t.desc || '') + '</p>'
        + '<button type="button" class="lantmateri-point-btn" data-product="' + t.id + '" style="display:inline-flex; align-items:center; gap:10px; padding:12px 18px; border:none; border-radius:4px; background:#4a90e2; color:#fff; cursor:pointer; font-size:14px; font-weight:500;">'
        +   '<span style="font-size:18px;">' + t.icon + '</span> Hämta ' + t.label
        + '</button>'
        + '<div class="lantmateri-point-result" data-result="' + t.id + '" style="display:none; margin-top:16px; padding:14px 16px; background:#e3f2fd; border:1px solid #64b5f6; border-radius:4px; font-size:14px; color:#0d47a1;"></div>'
        + '</div>';
    }).join('');

    modal.innerHTML = `
      <div class="lantmateri-modal-header" style="padding: 20px 20px 0 20px; border-bottom: 1px solid #e0e0e0; position: sticky; top: 0; background: white; z-index: 1;">
        <h3 style="margin: 0; font-size: 18px; color: #333;">Lantmäteriet Information</h3>
        <p style="margin: 8px 0 12px 0; font-size: 13px; color: #666;">
          ${isAreaQuery ? 'Urval: ritat område' : ('Koordinater: ' + lat.toFixed(6) + ', ' + lon.toFixed(6))}
        </p>
        <div class="lantmateri-tabs-bar" style="display:flex; gap:0; overflow-x:auto; margin:0 -20px; padding:0 20px; border-bottom:1px solid #e0e0e0;">
          ${tabsBarHtml}
        </div>
      </div>

      <div class="lantmateri-modal-body" style="padding: 20px;">
        ${reportPanelHtml}
        ${pointPanelsHtml}

        <div class="lantmateri-gdpr-notice" style="margin-top: 20px; padding: 12px; background: #fffbea; border: 1px solid #f0d870; border-radius: 4px; font-size: 12px; color: #6b5500; line-height: 1.5;">
          <strong>⚠ GDPR &amp; Användarvillkor</strong><br/>
          ${gdprText}
          ${gdprLinksHtml}
        </div>

        <div class="lantmateri-loading" style="display: none; margin-top: 20px; text-align: center; color: #4a90e2;">
          <svg style="animation: spin 1s linear infinite; width: 24px; height: 24px; display: inline-block;" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="50" stroke-dashoffset="25" />
          </svg>
          <p style="margin: 10px 0 0 0; font-size: 14px;">Genererar rapport…</p>
        </div>
      </div>
    `;

    // Add hover effects
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .info-option:hover {
        background-color: #f5f5f5 !important;
        border-color: #4a90e2 !important;
      }
      .info-option input:checked + span {
        color: #4a90e2 !important;
        font-weight: 500 !important;
      }
      .lantmateri-btn-cancel:hover {
        background-color: #f5f5f5 !important;
      }
      .lantmateri-btn-generate:hover {
        background-color: #3a7bc8 !important;
      }
      .lantmateri-btn-generate:disabled {
        background-color: #ccc !important;
        cursor: not-allowed !important;
      }
    `;
    document.head.appendChild(style);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Event listeners
    modal.querySelector('.lantmateri-btn-cancel').addEventListener('click', closeModal);
    modal.querySelector('.lantmateri-btn-generate').addEventListener('click', generateReport);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Tab switching
    modal.querySelectorAll('.lantmateri-tab').forEach(function(tabBtn) {
      tabBtn.addEventListener('click', function() {
        var targetId = tabBtn.getAttribute('data-tab');
        modal.querySelectorAll('.lantmateri-tab').forEach(function(b) {
          var isActive = b === tabBtn;
          b.style.background = isActive ? '#fff' : 'transparent';
          b.style.borderBottomColor = isActive ? '#4a90e2' : 'transparent';
          b.style.color = isActive ? '#4a90e2' : '#555';
          b.style.fontWeight = isActive ? '600' : '400';
        });
        modal.querySelectorAll('.lantmateri-tab-panel').forEach(function(panel) {
          panel.style.display = (panel.getAttribute('data-panel') === targetId) ? 'block' : 'none';
        });
      });
    });

    // Point-info product buttons (Markhöjd, Marktäcke, ...)
    modal.querySelectorAll('.lantmateri-point-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var productId = btn.getAttribute('data-product');
        fetchAndShowPointInfo(productId, btn);
      });
    });
  }

  /**
   * Fetch a point-info product (Markhöjd / Marktäcke / ...) and display
   * the result inline inside the modal.
   */
  async function fetchAndShowPointInfo(productId, btn) {
    var product = LMV_POINT_PRODUCTS[productId];
    if (!product || !pendingQuery) return;

    var resultEl = modal && modal.querySelector('.lantmateri-point-result[data-result="' + productId + '"]');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<em>Hämtar ' + product.label + '…</em>';
    }
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    try {
      var url = new URL(proxyUrl + '/' + productId, window.location.origin);
      var lon = pendingQuery.lonLat[0];
      var lat = pendingQuery.lonLat[1];
      url.searchParams.set('lon', lon);
      url.searchParams.set('lat', lat);
      // Also send native projection coords (preferred by most LMV endpoints)
      if (pendingQuery.coords && pendingQuery.nativeSrid) {
        url.searchParams.set('e', pendingQuery.coords[0]); // easting
        url.searchParams.set('n', pendingQuery.coords[1]); // northing
        url.searchParams.set('srid', pendingQuery.nativeSrid.replace(/^EPSG:/, ''));
      }

      var response = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();

      if (resultEl) {
        resultEl.innerHTML = '<strong>' + product.icon + ' ' + product.label + '</strong><br/>'
          + product.format(data);
      }
    } catch (err) {
      console.error('[LantmateriSearch] Point-info fetch failed for', productId, err);
      if (resultEl) {
        resultEl.style.background = '#fdecea';
        resultEl.style.borderColor = '#e57373';
        resultEl.style.color = '#7a1f1f';
        resultEl.innerHTML = 'Fel: ' + (err.message || 'kunde inte hämta data');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
  }

  /**
   * Close modal
   */
  function closeModal() {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    overlay = null;
    modal = null;
  }

  /**
   * Show a styled toast notification (replaces ugly alert())
   */
  function showToast(message, type = 'warning') {
    const colors = {
      warning: { bg: '#fff8e1', border: '#f0c040', icon: '⚠', color: '#7a5400' },
      error:   { bg: '#fdecea', border: '#e57373', icon: '✖', color: '#7a1f1f' },
      info:    { bg: '#e3f2fd', border: '#64b5f6', icon: 'ℹ', color: '#0d47a1' },
      success: { bg: '#e8f5e9', border: '#81c784', icon: '✓', color: '#1b5e20' }
    };
    const c = colors[type] || colors.warning;
    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed', 'top:24px', 'left:50%', 'transform:translateX(-50%) translateY(-20px)',
      'background:' + c.bg, 'border:1px solid ' + c.border, 'color:' + c.color,
      'padding:14px 22px', 'border-radius:8px', 'box-shadow:0 6px 24px rgba(0,0,0,0.18)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:14px', 'font-weight:500', 'z-index:1000000',
      'display:flex', 'align-items:center', 'gap:10px',
      'opacity:0', 'transition:opacity 0.25s ease, transform 0.25s ease',
      'max-width:90vw'
    ].join(';');
    toast.innerHTML = `<span style="font-size:18px;">${c.icon}</span><span>${message}</span>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  /**
   * Generate PDF report
   */
  async function generateReport() {
    if (!modal) return;

    const selectedTypes = Array.from(modal.querySelectorAll('input[name="infoType"]:checked'))
      .map(input => input.value);

    if (selectedTypes.length === 0) {
      showToast('Välj minst en informationstyp.', 'warning');
      return;
    }

    const generateBtn = modal.querySelector('.lantmateri-btn-generate');
    const loadingEl = modal.querySelector('.lantmateri-loading');
    const optionsEl = modal.querySelector('.lantmateri-info-options');
    const actionsEl = modal.querySelector('.lantmateri-modal-actions');

    // Show loading state
    generateBtn.disabled = true;
    loadingEl.style.display = 'block';
    optionsEl.style.opacity = '0.5';
    actionsEl.style.opacity = '0.5';

    try {
      let reportData = {};
      if (pendingQuery && pendingQuery.type === 'area') {
        const areaReport = await fetchAreaReport(selectedTypes);
        reportData = areaReport.results || {};
        pendingQuery.areaSummary = areaReport.area || null;
        pendingQuery.areaNote = areaReport.note || '';
      } else {
        const dataPromises = selectedTypes.map(type => fetchLantmateriData(type, pendingQuery.lonLat));
        const results = await Promise.all(dataPromises);
        selectedTypes.forEach((type, index) => {
          reportData[type] = results[index];
        });
      }

      // Generate PDF
      await createPDF(reportData, selectedTypes);

      closeModal();
    } catch (error) {
      console.error('[LantmateriSearch] Report generation failed:', error);
      showToast('Fel vid generering av rapporten. Försök igen.', 'error');
      
      // Reset UI
      generateBtn.disabled = false;
      loadingEl.style.display = 'none';
      optionsEl.style.opacity = '1';
      actionsEl.style.opacity = '1';
    }
  }

  /**
   * Fetch data from Lantmäteriet API
   */
  async function fetchLantmateriData(type, lonLat) {
    const [lon, lat] = lonLat;
    
    try {
      const url = new URL(proxyUrl, window.location.origin);
      url.searchParams.set('type', type);
      url.searchParams.set('lon', lon);
      url.searchParams.set('lat', lat);

      const response = await fetch(url.toString(), {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[LantmateriSearch] Failed to fetch ${type}:`, error);
      return { error: error.message, type: type };
    }
  }

  async function fetchAreaReport(selectedTypes) {
    if (!pendingQuery || !pendingQuery.geometry) throw new Error('Missing area geometry');
    const response = await fetch(getAreaReportUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: pendingQuery.geometry,
        nativeGeometry: pendingQuery.nativeGeometry,
        nativeSrid: pendingQuery.nativeSrid,
        include: selectedTypes
      })
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    return response.json();
  }

  /**
   * Create PDF report using jsPDF
   */
  async function createPDF(reportData, selectedTypes) {
    // Dynamically load jsPDF if not already loaded
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title page
    doc.setFontSize(20);
    doc.text(pdfTitle, 105, 30, { align: 'center' });
    
    doc.setFontSize(12);
    const now = new Date().toLocaleString('sv-SE');
    doc.text(`Genererat: ${now}`, 105, 40, { align: 'center' });
    let yPos = 65;

    if (pendingQuery && pendingQuery.type === 'area') {
      const area = pendingQuery.areaSummary;
      doc.text('Urval: ritat område', 105, 48, { align: 'center' });
      if (area && area.bbox) {
        doc.setFontSize(9);
        doc.text(`BBOX: ${area.bbox.map(v => Number(v).toFixed(6)).join(', ')}`, 105, 56, { align: 'center' });
        yPos = 72;
      }
    } else if (pendingQuery) {
      const [lon, lat] = pendingQuery.lonLat;
      doc.text(`Koordinater: ${lat.toFixed(6)}, ${lon.toFixed(6)}`, 105, 48, { align: 'center' });
    }

    // Add each section
    for (const type of selectedTypes) {
      const data = reportData[type];
      
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      // Section title
      doc.setFontSize(16);
      doc.setTextColor(74, 144, 226); // Blue
      doc.text(infoTypeLabels[type] || type, 20, yPos);
      yPos += 10;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0); // Black

      if (data.error) {
        doc.text(`Error: ${data.error}`, 20, yPos);
        yPos += 10;
      } else if (data.results && Array.isArray(data.results)) {
        // Display results
        data.results.forEach((item, idx) => {
          if (yPos > 270) {
            doc.addPage();
            yPos = 20;
          }

          doc.setFontSize(12);
          doc.text(`${idx + 1}. ${item.name || 'N/A'}`, 20, yPos);
          yPos += 6;

          doc.setFontSize(9);
          if (item.description) {
            doc.text(`   ${item.description}`, 20, yPos);
            yPos += 5;
          }

          // Add specific fields based on type
          if (type === 'fastighet') {
            if (item.kommun) doc.text(`   Kommun: ${item.kommun}`, 20, yPos), yPos += 5;
            if (item.lan) doc.text(`   Län: ${item.lan}`, 20, yPos), yPos += 5;
            if (item.areal) doc.text(`   Areal: ${item.areal} m²`, 20, yPos), yPos += 5;
          } else if (type === 'befolkning') {
            if (item.population) doc.text(`   Befolkning: ${item.population}`, 20, yPos), yPos += 5;
          }

          yPos += 3;
        });
      } else {
        doc.text('Ingen data tillgänglig', 20, yPos);
        yPos += 10;
      }

      yPos += 10;
    }

    // Save PDF
    const filename = `Lantmateri_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  }

  /**
   * Dynamically load external script
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Create toolbar button
   */
  function createButton() {
    // Use the EXACT same DOM/classes as native Origo buttons (zoom, fullscreen,
    // etc.) so it inherits identical size, spacing, and responsive behavior.
    // Native structure:
    //   <button class="padding-small icon-smaller round light box-shadow">
    //     <span class="icon"><svg|img/></span>
    //   </button>
    const buttonEl = document.createElement('button');
    buttonEl.className = 'o-lantmateri padding-small icon-smaller round light box-shadow lantmateri-tool-button';
    buttonEl.setAttribute('type', 'button');
    buttonEl.setAttribute('title', buttonTitle);
    buttonEl.style.cssText = 'margin-top:0.5rem;align-self:flex-start;';
    buttonEl.innerHTML = '<span class="icon"><img src="/css/images/Qtiler2HajkLMV.svg" alt="LMV" style="width:100%;height:100%;display:block;pointer-events:none;" /></span>';

    buttonEl.addEventListener('click', toggleTool);
    return buttonEl;
  }

  /**
   * Toggle tool activation
   */
  function toggleTool() {
    isActive = !isActive;
    
    if (isActive) {
      activate();
    } else {
      deactivate();
    }
  }

  /**
   * Activate the tool
   */
  function activate() {
    if (!map) return;
    
    toolButton.classList.add('active');
    map.getViewport().style.cursor = 'crosshair';
    showModePanel();
    setQueryMode(queryMode);
  }

  /**
   * Deactivate the tool
   */
  function deactivate() {
    if (!map) return;
    
    toolButton.classList.remove('active');
    map.getViewport().style.cursor = '';
    hideModePanel();
    stopAreaDraw();
    
    if (clickListener) {
      map.un('singleclick', clickListener);
      clickListener = null;
    }
  }

  return {
    /**
     * Called when control is added to the map
     */
    onAdd: function(viewerInstance) {
      console.log('[LantmateriSearch] onAdd called with viewer:', viewerInstance);
      viewer = viewerInstance;
      
      // Try different ways to get the map
      if (typeof viewer.getMap === 'function') {
        map = viewer.getMap();
      } else if (viewer.map) {
        map = viewer.map;
      } else {
        console.error('[LantmateriSearch] Could not get map from viewer');
      }
      
      // Get target ID
      if (typeof viewer.getId === 'function') {
        target = viewer.getId();
      } else if (viewer.id) {
        target = viewer.id;
      } else {
        target = 'map';
      }
      
      console.log('[LantmateriSearch] map:', map, 'target:', target);
      
      // Create button first
      toolButton = createButton();
      console.log('[LantmateriSearch] Button created:', toolButton);
      
      // Return element immediately - Origo will add it to toolbar
      return toolButton;
    },

    /**
     * Dispatch method required by Origo
     */
    dispatch: function(evt) {
      console.log('[LantmateriSearch] dispatch() called with event:', evt);
      
      // Origo v2 calls dispatch('add') instead of onAdd()
      if (evt === 'add') {
        console.log('[LantmateriSearch] Handling add event in dispatch');
        
        // Create button if not exists
        if (!toolButton) {
          toolButton = createButton();
          console.log('[LantmateriSearch] Button created:', toolButton);
        }
        
        // Wait for Origo's UI to be fully rendered
        const tryAddButton = (attempt = 0) => {
          // Append directly to #o-tools-left (where native zoom/fullscreen
          // buttons live) so spacing/sizing matches the other screen controls.
          const candidates = [
            '#o-tools-left',
            '.o-tools-left'
          ];
          
          let foundEl = null;
          let foundSelector = null;
          for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) {
              foundEl = el;
              foundSelector = sel;
              break;
            }
          }
          
          // Also log all elements with 'tool' in class name for debugging
          if (attempt === 0) {
            const allElements = document.querySelectorAll('[class*="tool"], [id*="tool"]');
            console.log('[LantmateriSearch] All tool-related elements:', allElements);
            allElements.forEach((el, i) => {
              if (i < 10) console.log(`  [${i}] ${el.tagName}.${el.className} #${el.id}`);
            });
          }
          
          if (foundEl) {
            foundEl.appendChild(toolButton);
            console.log(`[LantmateriSearch] Button appended to ${foundSelector}:`, foundEl);
            
            // Get viewer from global
            if (window.origoApp) {
              const app = window.origoApp;
              
              // Origo v2: api is the viewer
              if (app.api) {
                viewer = typeof app.api === 'function' ? app.api() : app.api;
                console.log('[LantmateriSearch] viewer from api:', viewer);
                if (viewer) {
                  console.log('[LantmateriSearch] viewer methods:', Object.keys(viewer).slice(0, 50));
                }
              }
              
              try {
                if (viewer && typeof viewer.getMap === 'function') {
                  map = viewer.getMap();
                  target = viewer.getTarget ? viewer.getTarget() : (viewer.getId ? viewer.getId() : 'o-map');
                  console.log('[LantmateriSearch] ✓ map obtained:', map, 'target:', target);
                } else {
                  console.warn('[LantmateriSearch] viewer.getMap not a function. viewer:', viewer);
                }
              } catch (e) {
                console.warn('[LantmateriSearch] Could not get map:', e);
              }
            }
          } else if (attempt < 20) {
            // Retry up to 20 times (2 seconds)
            setTimeout(() => tryAddButton(attempt + 1), 100);
          } else {
            console.error('[LantmateriSearch] No toolbar found after 20 attempts');
          }
        };
        
        setTimeout(() => tryAddButton(0), 100);
      }
      
      return this;
    },

    /**
     * Render method - returns the control element
     */
    render: function() {
      console.log('[LantmateriSearch] render() called');
      if (!toolButton) {
        console.log('[LantmateriSearch] render() creating button');
        toolButton = createButton();
      }
      return toolButton;
    }
  };
};

// Make available globally for Origo to find
window.LantmateriSearch = LantmateriSearch;
console.log('[Qtiler2Hajk] LantmateriSearch control loaded and registered to window');

})(window);
