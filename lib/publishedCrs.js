export const normalizePublishedCrs = (value) => {
  if (!Array.isArray(value)) throw new Error('Published CRS must be an array');
  if (value.length > 32) throw new Error('At most 32 CRS can be published per project');
  const codes = value.map((entry) => {
    const code = String(entry || '').trim().toUpperCase();
    if (!/^(EPSG:[1-9][0-9]*|CRS:84)$/.test(code)) throw new Error(`Invalid published CRS: ${code}`);
    return code;
  });
  return Array.from(new Set(codes));
};