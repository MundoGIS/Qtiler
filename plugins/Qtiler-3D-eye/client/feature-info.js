export function featureInfoHtml(properties, fields, baseUrl) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const selected = Array.isArray(fields) ? fields : Object.keys(properties || {});
  const render = (value) => {
    if (Array.isArray(value)) return value.map(render).join('<br>');
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    if (!/^(https?:\/\/|\/[^/])/i.test(text)) return escape(text);
    let url;
    try { url = new URL(text, baseUrl); } catch { return escape(text); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return escape(text);
    const href = escape(url.href);
    if (/\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname)) return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img src="${href}" alt="" loading="lazy" style="max-width:100%;max-height:260px"></a>`;
    if (/\.(mp4|webm|ogv)$/i.test(url.pathname)) return `<video controls preload="metadata" src="${href}" style="max-width:100%;max-height:260px"></video>`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>`;
  };
  return `<table style="width:100%;border-collapse:collapse">${selected.filter((name) => Object.hasOwn(properties || {}, name)).map((name) => `<tr><th style="text-align:left;vertical-align:top;padding:6px">${escape(name)}</th><td style="padding:6px;overflow-wrap:anywhere">${render(properties[name])}</td></tr>`).join('')}</table>`;
}