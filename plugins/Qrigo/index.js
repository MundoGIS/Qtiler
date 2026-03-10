import express from 'express';
import path from 'path';

export const register = async ({ app, baseDir }) => {
  const clientDir = path.join(baseDir, 'client');
  app.use('/plugins/Qrigo/client', express.static(clientDir, { index: false }));
  app.get('/plugins/Qrigo/admin', (_req, res) => {
    const adminHtml = `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Qrigo</title>
          <style>
            :root { color-scheme: light; }
            body { font-family: "Segoe UI", system-ui, sans-serif; padding: 20px; background: #f8fafc; color: #0f172a; }
            .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
            h2 { margin: 0 0 8px; font-size: 1.4rem; }
            h3 { margin: 18px 0 8px; font-size: 1.05rem; }
            p { margin: 0 0 12px; color: #475569; }
            ul, ol { margin: 0 0 12px 18px; color: #334155; }
            li { margin-bottom: 6px; }
            .note { margin-top: 14px; padding: 12px 14px; background: #f1f5f9; border-radius: 12px; color: #475569; font-size: 0.95rem; }
          </style>
        </head>
        <body>
          <main class="card">
            <h2 data-i18n="qrigo.title">Qrigo plugin</h2>
            <p data-i18n="qrigo.subtitle">Adds Origo-ready layer snippets and WMS/WMTS/WFS connection helpers directly inside the Qtiler layer modal.</p>

            <section>
              <h3 data-i18n="qrigo.what.title">What Qrigo does</h3>
              <ul>
                <li data-i18n="qrigo.what.1">Creates Origo JSON snippets for WMS, WMTS and WFS layers based on your project configuration.</li>
                <li data-i18n="qrigo.what.2">Includes editable WFS details (attributes/workspace) when the layer is marked editable in the dashboard.</li>
                <li data-i18n="qrigo.what.3">Keeps the snippets synced with layer edits such as BBOX and resolutions.</li>
              </ul>
            </section>

            <section>
              <h3 data-i18n="qrigo.how.title">How to use it</h3>
              <ol>
                <li data-i18n="qrigo.how.1">Open a project in the Qtiler admin dashboard and click a layer to view details.</li>
                <li data-i18n="qrigo.how.2">Select the “Qrigo / Origo” tab to copy the source + layer JSON blocks.</li>
                <li data-i18n="qrigo.how.3">Paste the snippets into Origo index.json and adjust titles or groupings as needed.</li>
              </ol>
            </section>

            <section>
              <h3 data-i18n="qrigo.outputs.title">Outputs included</h3>
              <ul>
                <li data-i18n="qrigo.outputs.1">Source entries for WMTS/WMS/WFS with the correct URLs and request parameters.</li>
                <li data-i18n="qrigo.outputs.2">Layer entries aligned with your Qtiler layer name, styling placeholder, and visibility defaults.</li>
                <li data-i18n="qrigo.outputs.3">Optional API-key placeholders when QtilerAuth is active.</li>
              </ul>
            </section>

            <div class="note" data-i18n="qrigo.note">Qrigo does not change data in Qtiler; it only prepares configuration text you can copy into Origo.</div>
          </main>

          <script>
            const TRANSLATIONS = {
              en: {
                'qrigo.title': 'Qrigo plugin',
                'qrigo.subtitle': 'Adds Origo-ready layer snippets and WMS/WMTS/WFS connection helpers directly inside the Qtiler layer modal.',
                'qrigo.what.title': 'What Qrigo does',
                'qrigo.what.1': 'Creates Origo JSON snippets for WMS, WMTS and WFS layers based on your project configuration.',
                'qrigo.what.2': 'Includes editable WFS details (attributes/workspace) when the layer is marked editable in the dashboard.',
                'qrigo.what.3': 'Keeps the snippets synced with layer edits such as BBOX and resolutions.',
                'qrigo.how.title': 'How to use it',
                'qrigo.how.1': 'Open a project in the Qtiler admin dashboard and click a layer to view details.',
                'qrigo.how.2': 'Select the “Qrigo / Origo” tab to copy the source + layer JSON blocks.',
                'qrigo.how.3': 'Paste the snippets into Origo index.json and adjust titles or groupings as needed.',
                'qrigo.outputs.title': 'Outputs included',
                'qrigo.outputs.1': 'Source entries for WMTS/WMS/WFS with the correct URLs and request parameters.',
                'qrigo.outputs.2': 'Layer entries aligned with your Qtiler layer name, styling placeholder, and visibility defaults.',
                'qrigo.outputs.3': 'Optional API-key placeholders when QtilerAuth is active.',
                'qrigo.note': 'Qrigo does not change data in Qtiler; it only prepares configuration text you can copy into Origo.'
              },
              es: {
                'qrigo.title': 'Plugin Qrigo',
                'qrigo.subtitle': 'Añade snippets listos para Origo y asistentes de conexión WMS/WMTS/WFS directamente en el modal de capas de Qtiler.',
                'qrigo.what.title': 'Qué hace Qrigo',
                'qrigo.what.1': 'Genera snippets JSON de Origo para capas WMS, WMTS y WFS a partir de la configuración del proyecto.',
                'qrigo.what.2': 'Incluye detalles de WFS editable (atributos/espacio de trabajo) cuando la capa está marcada como editable.',
                'qrigo.what.3': 'Mantiene los snippets sincronizados con cambios de capa como BBOX y resoluciones.',
                'qrigo.how.title': 'Cómo usarlo',
                'qrigo.how.1': 'Abre un proyecto en el panel de administración de Qtiler y haz clic en una capa para ver detalles.',
                'qrigo.how.2': 'Selecciona la pestaña “Qrigo / Origo” para copiar los bloques JSON de source + layer.',
                'qrigo.how.3': 'Pega los snippets en index.json de Origo y ajusta títulos o agrupaciones según necesites.',
                'qrigo.outputs.title': 'Salidas incluidas',
                'qrigo.outputs.1': 'Entradas de source para WMTS/WMS/WFS con las URLs y parámetros correctos.',
                'qrigo.outputs.2': 'Entradas de layer alineadas con el nombre de la capa en Qtiler, estilo de ejemplo y visibilidad por defecto.',
                'qrigo.outputs.3': 'Placeholders opcionales de API key cuando QtilerAuth está activo.',
                'qrigo.note': 'Qrigo no modifica datos en Qtiler; solo prepara texto de configuración para copiar en Origo.'
              },
              sv: {
                'qrigo.title': 'Qrigo-plugin',
                'qrigo.subtitle': 'Lägger till Origo-färdiga lagerutdrag och WMS/WMTS/WFS-anslutningshjälp direkt i Qtilers lagerdialog.',
                'qrigo.what.title': 'Vad Qrigo gör',
                'qrigo.what.1': 'Skapar Origo-JSON för WMS-, WMTS- och WFS-lager utifrån projektets konfiguration.',
                'qrigo.what.2': 'Inkluderar detaljer för redigerbar WFS (attribut/arbetsyta) när lagret är markerat som redigerbart.',
                'qrigo.what.3': 'Håller utdragen synkade med lagerändringar som BBOX och upplösningar.',
                'qrigo.how.title': 'Så använder du det',
                'qrigo.how.1': 'Öppna ett projekt i Qtilers adminpanel och klicka på ett lager för att se detaljer.',
                'qrigo.how.2': 'Välj fliken “Qrigo / Origo” för att kopiera source + layer JSON-blocken.',
                'qrigo.how.3': 'Klistra in i Origo index.json och justera titlar eller grupperingar vid behov.',
                'qrigo.outputs.title': 'Inkluderade utdata',
                'qrigo.outputs.1': 'Source-poster för WMTS/WMS/WFS med korrekta URL:er och parametrar.',
                'qrigo.outputs.2': 'Layer-poster som matchar Qtiler-lagernamn, stilplatshållare och standardvisning.',
                'qrigo.outputs.3': 'Valfria API-nyckel-platshållare när QtilerAuth är aktivt.',
                'qrigo.note': 'Qrigo ändrar inte data i Qtiler; det förbereder bara konfigurationstext att kopiera till Origo.'
              }
            };

            const SUPPORTED = ['en', 'es', 'sv'];
            const normalizeLang = (value) => {
              const raw = String(value || '').toLowerCase();
              if (SUPPORTED.includes(raw)) return raw;
              const base = raw.split('-')[0];
              return SUPPORTED.includes(base) ? base : 'en';
            };

            const readLang = () => {
              const fromParent = window.parent?.qtilerLang?.get?.();
              return fromParent || localStorage.getItem('qtiler.lang') || navigator.language || 'en';
            };

            let currentLang = normalizeLang(readLang());

            const applyTranslations = () => {
              document.documentElement.setAttribute('lang', currentLang);
              document.querySelectorAll('[data-i18n]').forEach((el) => {
                const key = el.getAttribute('data-i18n');
                if (!key) return;
                const table = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
                el.textContent = table[key] || TRANSLATIONS.en[key] || key;
              });
            };

            const syncLanguage = () => {
              const next = normalizeLang(readLang());
              if (next === currentLang) return;
              currentLang = next;
              applyTranslations();
            };

            window.addEventListener('storage', (event) => {
              if (event.key === 'qtiler.lang') syncLanguage();
            });

            setInterval(syncLanguage, 1000);
            applyTranslations();
          </script>
        </body>
      </html>`;

    res.type('text/html').send(adminHtml);
  });
  return {
    dispose: async () => {}
  };
};
