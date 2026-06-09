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
 * 
 * Configuration example:
 * {
 *   name: 'lantmaterisearch',
 *   options: {
 *     proxyUrl: '/plugins/Qtiler2Hajk/api/lantmateri-proxy',
 *     infoTypes: ['fastighet', 'befolkning', 'adress', 'ort'],
 *     buttonIcon: '#fa-building',
 *     buttonTitle: 'Lantmäteriet Info'
 *   }
 * }
 */

const LantmateriSearch = function LantmateriSearch(options = {}) {
  const {
    proxyUrl = '/plugins/Qtiler2Hajk/api/lantmateri-proxy',
    infoTypes = ['fastighet', 'befolkning', 'adress', 'ort'],
    buttonIcon = '#fa-building',
    buttonTitle = 'Lantmäteriet Info',
    pdfTitle = 'Lantmäteriet Information Report'
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

  const infoTypeLabels = {
    fastighet: 'Fastighet (Property)',
    befolkning: 'Befolkning (Population)',
    adress: 'Adress (Address)',
    ort: 'Ort (Locality)',
    agare: 'Ägare (Owner)',
    taxering: 'Taxering (Assessment)',
    byggnader: 'Byggnader (Buildings)',
    markdata: 'Markdata (Land Data)'
  };

  /**
   * Create toolbar button
   */
  function createButton() {
    const buttonEl = document.createElement('button');
    buttonEl.className = 'o-control o-control-button lantmateri-tool-button';
    buttonEl.setAttribute('type', 'button');
    buttonEl.setAttribute('title', buttonTitle);
    buttonEl.innerHTML = `<svg class="o-icon-fa-18px"><use href="${buttonIcon}"></use></svg>`;
    
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
    
    // Add click listener to map
    clickListener = map.on('singleclick', handleMapClick);
    
    // Dispatch event to notify other tools
    viewer.dispatch('toggleClickInteraction', { interaction: 'lantmateri', active: true });
  }

  /**
   * Deactivate the tool
   */
  function deactivate() {
    if (!map) return;
    
    toolButton.classList.remove('active');
    map.getViewport().style.cursor = '';
    
    if (clickListener) {
      map.un('singleclick', clickListener);
      clickListener = null;
    }
    
    viewer.dispatch('toggleClickInteraction', { interaction: 'lantmateri', active: false });
  }
      
      const subtitle = document.createElement('div');
      subtitle.className = 'lantmateri-result-subtitle';
      subtitle.textContent = result.description || result.type || '';
      
      item.appendChild(title);
      item.appendChild(subtitle);
      
      item.addEventListener('click', () => {
        selectResult(result);
      });
      
      list.appendChild(item);
    });

    resultsContainer.appendChild(list);
    resultsContainer.style.display = 'block';
  }

  /**
   * Handle result selection
   */
  function selectResult(result) {
    if (!result.geometry && !result.coordinates) {
      console.warn('[LantmateriSearch] Result has no geometry:', result);
      return;
    }

    // Close results
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
    }

    // Parse coordinates
    let coords;
    if (result.coordinates) {
      coords = Array.isArray(result.coordinates) ? result.coordinates : [result.coordinates.x, result.coordinates.y];
    } else if (result.geometry && result.geometry.coordinates) {
      coords = result.geometry.coordinates;
    }

    if (!coords || coords.length < 2) {
      console.warn('[LantmateriSearch] Invalid coordinates:', result);
      return;
    }

    // Zoom to location
    const view = map.getView();
    view.animate({
      center: coords,
      zoom: zoomLevel,
      duration: 500
    });

    // Highlight feature
    highlightFeature(result);

    // Show popup with details
    showResultDetails(result, coords);
  }

  /**
   * Highlight feature on map
   */
  function highlightFeature(result) {
    // Clear previous highlight
    if (currentHighlight) {
      searchLayer.getSource().removeFeature(currentHighlight);
      currentHighlight = null;
    }

    if (!result.geometry && !result.coordinates) return;

    const ol = viewer.getMapUtils().ol;
    let geometry;

    if (result.geometry) {
      // GeoJSON geometry
      const format = new ol.format.GeoJSON();
      const feature = format.readFeature(result.geometry, {
        dataProjection: 'EPSG:4326',
        featureProjection: map.getView().getProjection()
      });
      geometry = feature.getGeometry();
    } else {
      // Point from coordinates
      geometry = new ol.geom.Point(result.coordinates);
    }

    const feature = new ol.Feature({ geometry });
    
    // Style
    const style = new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'rgba(255, 0, 0, 0.8)',
        width: 3
      }),
      fill: new ol.style.Fill({
        color: 'rgba(255, 0, 0, 0.2)'
      }),
      image: new ol.style.Circle({
        radius: 8,
        fill: new ol.style.Fill({ color: 'rgba(255, 0, 0, 0.8)' }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
      })
    });
    
    feature.setStyle(style);
    searchLayer.getSource().addFeature(feature);
    currentHighlight = feature;

    // Auto-remove after duration
    if (highlightDuration > 0) {
      setTimeout(() => {
        if (currentHighlight === feature) {
          searchLayer.getSource().removeFeature(feature);
          currentHighlight = null;
        }
      }, highlightDuration);
    }
  }

  /**
   * Show result details in popup
   */
  function showResultDetails(result, coords) {
    const popup = viewer.getControlByName('popup');
    if (!popup) return;

    const content = buildResultPopup(result);
    popup.setContent({ content, coordinates: coords, title: result.name || 'Resultat' });
  }

  /**
   * Build popup HTML for result
   */
  function buildResultPopup(result) {
    const fields = [];
    
    if (result.type) fields.push({ label: 'Typ', value: result.type });
    if (result.beskrivning) fields.push({ label: 'Beskrivning', value: result.beskrivning });
    if (result.kommun) fields.push({ label: 'Kommun', value: result.kommun });
    if (result.lan) fields.push({ label: 'Län', value: result.lan });
    if (result.fastighet) fields.push({ label: 'Fastighet', value: result.fastighet });
    if (result.beteckning) fields.push({ label: 'Beteckning', value: result.beteckning });
    if (result.areal) fields.push({ label: 'Areal', value: `${result.areal} m²` });
    if (result.taxeringsvarde) fields.push({ label: 'Taxeringsvärde', value: result.taxeringsvarde });

    let html = '<div class="lantmateri-popup">';
    fields.forEach(field => {
      html += `<div class="lantmateri-popup-row">
        <strong>${field.label}:</strong> ${field.value}
      </div>`;
    });
    html += '</div>';

    return html;
  }

  /**
   * Show error message
   */
  function showError(message) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div class="lantmateri-error">${message}</div>`;
      resultsContainer.style.display = 'block';
    }
  }

  /**
   * Handle search input
   */
  function handleSearchInput() {
    const query = searchInput.value.trim();
    
    clearTimeout(searchTimeout);
    
    if (query.length < minSearchLength) {
      if (resultsContainer) {
        resultsContainer.style.display = 'none';
      }
      return;
    }

    searchTimeout = setTimeout(async () => {
      // Determine search type (auto-detect or use first enabled type)
      const searchType = searchTypes[0] || 'fastighet';
      
      const results = await performSearch(query, searchType);
      displayResults(results);
    }, 300); // Debounce
  }

  /**
   * Initialize control
   */
  function init(viewerInstance) {
    viewer = viewerInstance;
    map = viewer.getMap();

    // Create vector layer for highlights
    const ol = viewer.getMapUtils().ol;
    searchLayer = new ol.layer.Vector({
      source: new ol.source.Vector(),
      name: 'lantmateri-search-layer',
      zIndex: 9999
    });
    map.addLayer(searchLayer);
  }

  /**
   * Render control UI
   */
  function render() {
    const container = document.createElement('div');
    container.className = 'lantmateri-search-control';

    // Search input
    const searchBox = document.createElement('div');
    searchBox.className = 'lantmateri-search-box';

    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'lantmateri-search-input';
    searchInput.placeholder = placeholder;
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSearchInput();
      }
    });

    searchButton = document.createElement('button');
    searchButton.className = 'lantmateri-search-button';
    searchButton.innerHTML = '🔍';
    searchButton.title = 'Sök';
    searchButton.addEventListener('click', handleSearchInput);

    searchBox.appendChild(searchInput);
    searchBox.appendChild(searchButton);

    // Results container
    resultsContainer = document.createElement('div');
    resultsContainer.className = 'lantmateri-results-container';
    resultsContainer.style.display = 'none';

    container.appendChild(searchBox);
    container.appendChild(resultsContainer);

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        if (resultsContainer) {
          resultsContainer.style.display = 'none';
        }
      }
    });

    return container;
  }

  return {
    name: 'lantmaterisearch',
    onInit: init,
    render
  };
};

export default LantmateriSearch;
