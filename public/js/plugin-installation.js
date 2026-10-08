export function uploadPluginArchive(body, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/plugins/upload');
    request.withCredentials = true;
    request.timeout = 300000;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener('load', () => {
      let payload;
      try { payload = JSON.parse(request.responseText); }
      catch { reject(Object.assign(new Error('Invalid server response'), { status: request.status })); return; }
      if (request.status >= 200 && request.status < 300) { resolve(payload); return; }
      reject(Object.assign(new Error(payload.details || payload.message || payload.error || 'Upload failed'), { code: payload.error, status: request.status }));
    });
    request.addEventListener('error', () => reject(new Error('Network error during plugin upload')));
    request.addEventListener('abort', () => reject(new Error('Plugin upload cancelled')));
    request.addEventListener('timeout', () => reject(Object.assign(new Error('Plugin upload timed out'), { code: 'installation_timeout' })));
    request.send(body);
  });
}

export async function waitForPluginInstallation(statusUrl, {
  read = async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Object.assign(new Error('Installation status unavailable'), { status: response.status });
    return response.json();
  },
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now, timeoutMs = 180000
} = {}) {
  if (!/^\/plugins\/installations\/[a-f0-9-]{36}$/i.test(statusUrl || '')) throw Object.assign(new Error('The server does not support installation confirmation. Update Qtiler and retry.'), { code: 'installation_unsupported' });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let status;
    try { status = await read(statusUrl); }
    catch (err) { if (err.status >= 400 && err.status < 500) throw err; }
    if (status?.state === 'ready') return status;
    if (status?.state === 'failed') throw Object.assign(new Error('The plugin could not be loaded by all server workers. Check the server log.'), { code: 'installation_failed' });
    await delay(1000);
  }
  throw Object.assign(new Error('Installation has not been confirmed yet. Check the server log before retrying.'), { code: 'installation_timeout' });
}

export function beginViewerInstallation(name) {
  const messages = {
    en: ['Installing', 'Downloading and preparing viewer'],
    es: ['Instalando', 'Descargando y preparando visor'],
    sv: ['Installerar', 'Laddar ner och förbereder kartvisare']
  };
  const [title, phase] = messages[document.documentElement.lang.split('-')[0]] || messages.en;
  const root = document.querySelector('main');
  const originalInert = root?.inert;
  const dialog = document.createElement('dialog');
  dialog.className = 'plugin-installation-dialog';
  const heading = document.createElement('h2');
  heading.textContent = `${title} ${name}`;
  const status = document.createElement('p');
  status.textContent = phase;
  status.setAttribute('role', 'status');
  dialog.setAttribute('aria-label', heading.textContent);
  dialog.append(heading, status, document.createElement('progress'));
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  if (root) { root.inert = true; root.dataset.viewerInstalling = 'true'; }
  dialog.showModal();
  if (window.parent !== window) window.parent.postMessage({ type: 'qtiler:viewer-installation', busy: true, phase: `${heading.textContent}: ${phase}` }, window.location.origin);
  return () => {
    dialog.close();
    dialog.remove();
    if (root) { root.inert = originalInert; delete root.dataset.viewerInstalling; }
    if (window.parent !== window) window.parent.postMessage({ type: 'qtiler:viewer-installation', busy: false }, window.location.origin);
  };
}