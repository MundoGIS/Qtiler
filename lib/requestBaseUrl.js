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