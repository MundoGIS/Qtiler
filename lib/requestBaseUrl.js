export const getRequestBaseUrl = (req, { defaultProtocol = 'http' } = {}) => {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configuredBaseUrl) return configuredBaseUrl;

  const forwardedHost = String(req?.get?.('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || String(req?.get?.('host') || '').split(',')[0].trim();
  if (!host) return '';

  const forwardedProto = String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || String(req?.protocol || defaultProtocol).trim() || defaultProtocol;
  return `${proto}://${host}`;
};