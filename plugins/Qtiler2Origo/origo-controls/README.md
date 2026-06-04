# Lantmäteriet Info Control for Qtiler2Origo

> 🇸🇪 **ENDAST FÖR DEN SVENSKA MARKNADEN / SWEDISH MARKET ONLY**
>
> Denna modul är specifikt utvecklad för Sverige och integrerar mot
> Lantmäteriets API:er. All användargränssnittstext är på svenska.
> Användning kräver giltigt avtal/abonnemang med Lantmäteriet.

## Beskrivning (Svenska)

Lantmäteriet-kontrollen lägger till en knapp i Origo-verktygsfältet som låter
användaren klicka på kartan och hämta information från Lantmäteriet:

- **Fastighet** (fastighetsbeteckning, areal, kommun, län)
- **Befolkning** (statistik per område)
- **Adress** (adressuppslag)
- **Ort** (närmaste tätort)
- **Ägare** (kräver särskild behörighet)
- **Taxering**, **Byggnader**, **Markdata**

Resultatet visas i ett modalt fönster med GDPR-meddelande och kan exporteras
till PDF.

### GDPR och användarvillkor

Information från Lantmäteriet kan innehålla personuppgifter. Använd endast i
tjänsteutövning enligt gällande regler. Modalen visar två länkar (konfigurerbara
från admin UI):

- [Integritetspolicy](https://www.lantmateriet.se/sv/om-lantmateriet/Om-webbplatsen/integritetspolicy/)
- [Användarvillkor](https://www.lantmateriet.se/sv/Om-Lantmateriet/villkor/)

Text och länkar kan anpassas i kontrollens `options` (`gdprNotice`, `gdprLinks`).

---

## Description

Custom Origo control that provides click-to-query integration with Lantmäteriet's cadastral and population APIs. Similar to functionality found in commercial systems like Sokigo FB.

**User Experience:**
1. Click the toolbar button to activate the tool
2. Click anywhere on the map
3. A link appears in the info popup
4. Click the link to open an information selection modal
5. Select desired information types (property, population, address, etc.)
6. Generate a professional PDF report

## Features

- **Toolbar integration**: Button-based activation like other Origo tools
- **Click-to-query**: Click on map to get location-based information
- **Info popup injection**: Seamlessly integrates with Origo's info/identify system
- **Multiple info types**: 
  - Fastighet (Property/Cadastral)
  - Befolkning (Population/Demographics)
  - Adress (Address)
  - Ort (Locality)
  - Ägare (Owner - requires special permissions)
  - Taxering (Tax Assessment)
  - Byggnader (Buildings)
  - Markdata (Land/Terrain Data)
- **Professional PDF reports**: Multi-section reports with all selected information
- **Origo-styled UI**: Modal and components match Origo's design language

## How to Enable

1. In the Qtiler2Origo Admin UI, open a map editor
2. Go to the "3. Controls & search" tab
3. In the "Custom Qtiler2Origo Controls" section, enable **Lantmäteriet Search (Property & Address)**
4. Save and publish the map
5. The toolbar button will appear in the published map

## Usage

1. **Activate**: Click the Lantmäteriet button in the toolbar (looks like a building icon)
2. **Click on map**: The cursor changes to crosshair - click anywhere
3. **Info popup**: When the info popup appears, look for "Hämta information från Lantmäteriet"
4. **Select info**: Check the types of information you want
5. **Generate report**: Click "Generera Rapport" to create a PDF

## Configuring Real Lantmäteriet APIs

### Demo vs Production

By default, the control uses mock demonstration data. To use real Lantmäteriet APIs:

### 1. Obtain API Credentials

Visit [Lantmäteriet API Portal](https://www.lantmateriet.se/sv/Kartor-och-geografisk-information/oppna-data/API-oppna-data/) and register your application.

Available APIs:
- **Fastighetsinfo API**: Detailed cadastral information
- **Befolkningsinformation API**: Population and demographic data
- **Adressinformation API**: Address geocoding and reverse geocoding

### 2. Configure Environment Variables

Edit your `.env` file in the Qtiler root (see `.env.example` for full list):

```env
# Lantmäteriet API Configuration — SWEDISH MARKET ONLY
LANTMATERI_API_URL=https://api.lantmateriet.se
LANTMATERI_API_KEY=your-api-key-here
# Optional per-product keys (override the general key)
LANTMATERI_FASTIGHET_API_KEY=
LANTMATERI_BEFOLKNING_API_KEY=
LANTMATERI_ADRESS_API_KEY=
# OAuth2 alternative
LANTMATERI_CLIENT_ID=
LANTMATERI_CLIENT_SECRET=
LANTMATERI_TOKEN_URL=https://api.lantmateriet.se/token
```

### 3. Implement Real API Functions

Edit `plugins/Qtiler2Origo/index.js` and replace the mock functions with real API calls. The control sends coordinates (lon, lat) and info type to the backend.

Example for `fetchFastighet`:

```javascript
const fetchFastighet = async (lon, lat) => {
  const url = `${process.env.LANTMATERI_API_URL}/fastighet/v1/point`;
  const response = await fetch(`${url}?lon=${lon}&lat=${lat}`, {
    headers: {
      'Authorization': `Bearer ${process.env.LANTMATERI_API_KEY}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Transform to expected format
  return [{
    name: data.fastighetsbeteckning,
    type: 'Fastighet',
    description: `${data.kommun}, ${data.lan}`,
    kommun: data.kommun,
    lan: data.lan,
    areal: data.areal,
    fastighetsbeteckning: data.fastighetsbeteckning,
    objektidentitet: data.objektidentitet
  }];
};
```

Repeat for other fetch functions: `fetchBefolkning`, `fetchAdress`, `fetchOrt`, `fetchAgare`, `fetchTaxering`, `fetchByggnader`, `fetchMarkdata`.

### 4. Control Configuration Options

You can customize the control's behavior by editing the options in `admin-ui/app.js`:

```javascript
{ 
  id: 'ctrl-lantmaterisearch', 
  name: 'lantmaterisearch', 
  options: { 
    proxyUrl: '/plugins/Qtiler2Origo/api/lantmateri-proxy',
    infoTypes: ['fastighet', 'befolkning', 'adress', 'ort', 'agare', 'taxering'],
    buttonIcon: '#fa-building',
    buttonTitle: 'Lantmäteriet Info',
    pdfTitle: 'Lantmäteriet Information Report'
  }
}
```

## File Structure

```
plugins/Qtiler2Origo/
├── origo-controls/
│   ├── lantmateri-search.js      # Origo control (frontend button/modal/PDF)
│   ├── lantmateri-search.css     # Minimal control styles (animations)
│   ├── lantmateri-search.old.js  # Backup of previous version
│   └── README.md                 # This documentation
├── client/
│   └── origo-pattern-fills.js    # Control registration in Origo boot
├── admin-ui/
│   ├── app.js                    # Control definition & checkbox
│   └── index.html                # Admin UI with control checkbox
└── index.js                      # Backend proxy + fetch functions
```

## Architecture

```
┌─────────────────────────────────────────┐
│ User clicks toolbar button              │
│ → Tool activates (crosshair cursor)     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ User clicks on map                      │
│ → Capture coordinates (lon, lat)        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Inject link into info popup             │
│ → "Hämta information från Lantmäteriet" │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ User clicks link                        │
│ → Open modal with info type checkboxes  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ User selects info types & clicks        │
│ "Generera Rapport"                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Frontend fetches each selected type     │
│ GET /api/lantmateri-proxy               │
│   ?type=fastighet&lon=X&lat=Y           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Backend Proxy                           │
│ - Validates authentication              │
│ - Validates coordinates                 │
│ - Calls appropriate fetch function      │
│ - Returns JSON results                  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Real Lantmäteriet API                   │
│ (or mock data for demo)                 │
│ - Processes coordinate query            │
│ - Returns property/population info      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│ Frontend collects all results           │
│ - Loads jsPDF library dynamically       │
│ - Generates multi-section PDF           │
│ - Downloads to user's device            │
└─────────────────────────────────────────┘
```

## Technical Details

### Frontend Control

- **Type**: Origo toolbar button control
- **Integration**: Hooks into map click events when active
- **Popup injection**: Waits for Origo identify popup, then injects link
- **Modal**: Custom modal with inline styles for portability
- **PDF generation**: Uses jsPDF loaded from CDN (no build step required)

### Backend Proxy

- **Endpoint**: `GET /plugins/Qtiler2Origo/api/lantmateri-proxy`
- **Parameters**: `type`, `lon`, `lat`
- **Authentication**: Respects QtilerAuth if enabled
- **Rate limiting**: Consider implementing for production use

### Data Flow

1. Coordinates are captured in the map's projection
2. Transformed to EPSG:4326 (WGS84) for API calls
3. Backend receives decimal degrees (lon, lat)
4. Each info type may call a different Lantmäteriet endpoint
5. Results are normalized to a common format
6. Frontend assembles PDF from all responses

## Security

- ✅ API keys **never** exposed to the client
- ✅ Backend proxy validates authentication
- ✅ Respects QtilerAuth user permissions
- ✅ Coordinate validation (prevents invalid queries)
- ✅ Backend input validation

## Style Customization

Most styles are inline for portability, but you can customize:

**Button active state** - Edit `origo-controls/lantmateri-search.css`:

```css
.lantmateri-tool-button.active {
  background-color: #your-color !important;
}
```

**Modal animations** - Modify fadeIn/slideUp keyframes

**Info link hover** - Change hover color/underline

## PDF Report Customization

Edit `origo-controls/lantmateri-search.js` function `createPDF`:

```javascript
// Change PDF title
doc.setFontSize(20);
doc.text('Your Custom Title', 105, 30, { align: 'center' });

// Change section colors
doc.setTextColor(74, 144, 226); // Blue - change RGB values

// Add custom sections
doc.text('Custom Section', 20, yPos);

// Add images/logos
// doc.addImage(imageData, 'PNG', x, y, width, height);
```

## Troubleshooting

### Control button doesn't appear

1. Check browser console for JavaScript errors
2. Verify control is registered in `origo-pattern-fills.js`
3. Check that checkbox is checked in Admin UI
4. Clear browser cache and reload

### Link doesn't appear in info popup

1. Verify tool is activated (button highlighted)
2. Check that you clicked on the map (not on UI elements)
3. Look for `[LantmateriSearch]` logs in browser console
4. May need to adjust `setTimeout` delay (currently 100ms)

### Modal doesn't open

1. Check browser console for errors
2. Verify `pendingQuery` is set (coordinates captured)
3. Check for conflicting CSS that might hide modal

### PDF generation fails

1. Check network tab - jsPDF should load from CDN
2. Verify no AdBlockers are blocking CDN requests
3. Check browser supports Blob/download
4. Try disabling browser extensions

### API returns errors

1. Verify environment variables are set correctly
2. Check API key validity at Lantmäteriet portal
3. Verify coordinates are within Sweden bounds
4. Check API quota/rate limits

## Support

For more information about Lantmäteriet APIs:
- [Open Data API Portal](https://www.lantmateriet.se/sv/Kartor-och-geografisk-information/oppna-data/API-oppna-data/)
- [Technical Documentation](https://www.lantmateriet.se/globalassets/geodata/geodatatjanster/tb_geodatatjanster_2_1.pdf)
- [Code Examples](https://github.com/lantmateriet)

## License

This custom control is part of Qtiler2Origo and is subject to the MPL 2.0 license.
