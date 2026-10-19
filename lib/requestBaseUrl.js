export const getRequestBaseUrl = (req, { defaultProtocol = 'http' } = {}) => {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configuredBaseUrl) return configuredBaseUrl;

  const firstHeaderValue = (name) => String(req?.get?.(name) || '').split(',')[0].trim();
  const forwardedProto = firstHeaderValue('x-forwarded-proto').toLowerCase();
  const proto = String(req?.protocol || defaultProtocol).trim() || defaultProtocol;
  const trustedForwardedHeaders = !!forwardedProto && forwardedProto === proto.toLowerCase();
  const forwardedHost = trustedForwardedHeaders ? firstHeaderValue('x-forwarded-host') : '';
  const host = forwardedHost || firstHeaderValue('host');
  if (!host) return '';

  return `${proto}://${host}`;
};

export const getViewerBaseUrl = (req, options = {}) => {
  const fallback = getRequestBaseUrl(req, options);
  const referer = String(req?.get?.('referer') || '').trim();
  if (!referer) return fallback;
  try {
    const ref = new URL(referer);
    if (ref.protocol !== 'http:' && ref.protocol !== 'https:') return fallback;
    const firstHeaderValue = (name) => String(req?.get?.(name) || '').split(',')[0].trim().toLowerCase();
    const trustedHosts = new Set([firstHeaderValue('host')].filter(Boolean));
    const forwardedProto = firstHeaderValue('x-forwarded-proto');
    if (forwardedProto && forwardedProto === String(req?.protocol || '').trim().toLowerCase()) {
      const forwardedHost = firstHeaderValue('x-forwarded-host');
      if (forwardedHost) trustedHosts.add(forwardedHost);
    }
    try {
      const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
      if (configured) trustedHosts.add(new URL(configured).host.toLowerCase());
    } catch {}
    if (trustedHosts.has(ref.host.toLowerCase())) return ref.origin;
  } catch {}
  return fallback;
};