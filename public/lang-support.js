(function () {
  const SUPPORTED_LANGS = ["en", "es", "sv"];
  const COOKIE_NAME = "qtiler_lang";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 año

  const normalize = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (SUPPORTED_LANGS.includes(raw)) return raw;
    const base = raw.split("-")[0];
    return SUPPORTED_LANGS.includes(base) ? base : "en";
  };

  const readCookieLang = () => {
    try {
      const segments = document.cookie ? document.cookie.split(/;\s*/) : [];
      for (const segment of segments) {
        const [name, ...rest] = segment.split("=");
        if (!name) continue;
        if (name.trim() === COOKIE_NAME && rest.length) {
          return decodeURIComponent(rest.join("=") || "");
        }
      }
    } catch {}
    return null;
  };

  const persistCookie = (lang) => {
    try {
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(lang)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {}
  };

  const storedLang = (() => {
    try {
      const fromStorage = localStorage.getItem("qtiler.lang");
      if (fromStorage) return fromStorage;
    } catch {}
    return null;
  })();

  const initialLang = normalize(storedLang || readCookieLang() || navigator.language || "en");
  let currentLang = initialLang;
  persistCookie(currentLang);
  const listeners = new Set();

  const applyDocumentLang = () => {
    try {
      if (document?.documentElement) {
        document.documentElement.setAttribute("lang", currentLang);
      }
    } catch {}
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener(currentLang);
      } catch (err) {
        console.warn("qtilerLang listener failed", err);
      }
    });
  };

  const setLanguage = (lang, { fromStorage = false } = {}) => {
    const nextLang = normalize(lang);
    if (nextLang === currentLang) {
      persistCookie(currentLang);
      return;
    }
    currentLang = nextLang;
    if (!fromStorage) {
      try {
        localStorage.setItem("qtiler.lang", currentLang);
      } catch {}
    }
    persistCookie(currentLang);
    applyDocumentLang();
    notify();
  };

  const getLanguage = () => currentLang;

  const subscribe = (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  window.qtilerLang = {
    SUPPORTED_LANGS: SUPPORTED_LANGS.slice(),
    normalize,
    get: getLanguage,
    set: (lang) => setLanguage(lang),
    subscribe,
    notify // Expose notify
  };

  applyDocumentLang();

  window.addEventListener("storage", (event) => {
    if (event.key !== "qtiler.lang") return;
    setLanguage(event.newValue || "en", { fromStorage: true });
  });
})();
