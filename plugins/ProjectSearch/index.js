import express from 'express';
import path from 'path';

export const register = async ({ app, baseDir }) => {
  const clientDir = path.join(baseDir, 'client');
  app.use('/plugins/ProjectSearch/client', express.static(clientDir, { index: false }));
  app.get('/plugins/ProjectSearch/admin', (_req, res) => {
    const adminHtml = `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ProjectSearch</title>
          <style>
            :root { color-scheme: light; }
            body { font-family: "Segoe UI", system-ui, sans-serif; padding: 20px; background: #f8fafc; color: #0f172a; }
            .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
            h2 { margin: 0 0 8px; font-size: 1.4rem; }
            p { margin: 0 0 12px; color: #475569; }
          </style>
        </head>
        <body>
          <main class="card">
            <h2>ProjectSearch plugin</h2>
            <p>Adds a project search box to the dashboard so you can quickly filter large project lists.</p>
            <p>No configuration required.</p>
          </main>
        </body>
      </html>`;
    res.type('text/html').send(adminHtml);
  });
  return {
    dispose: async () => {}
  };
};
