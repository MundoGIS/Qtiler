export const sanitizeProjectId = (value) => {
  if (value == null) return "";
  const str = String(value).trim();
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
};

export const sanitizePluginName = (value) => {
  if (!value) return "";
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
};
