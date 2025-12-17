(function() {
  const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
    ? window.qtilerLang.SUPPORTED_LANGS
    : ["en", "es", "sv"];
  const normalizeLang = window.qtilerLang?.normalize || ((value) => {
    const raw = (value || "").toLowerCase();
    if (SUPPORTED_LANGS.includes(raw)) return raw;
    const base = raw.split("-")[0];
    return SUPPORTED_LANGS.includes(base) ? base : "en";
  });

  // DOM element references
  const form = document.getElementById('login_form');
  const usernameInput = document.getElementById('login_username');
  const passwordInput = document.getElementById('login_password');
  const togglePasswordBtn = document.getElementById('toggle_password');
  const rememberCheckbox = document.getElementById('login_remember');
  const submitBtn = document.getElementById('login_submit');
  const resetBtn = document.getElementById('login_reset');
  const statusEl = document.getElementById('login_status');
  const languageSelect = document.getElementById('lang_select');
  
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePasswordBtn.innerHTML = isPassword 
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  const REMEMBER_KEY = 'qtiler.login.remember';
  let currentLang = window.qtilerLang?.get?.() || normalizeLang(localStorage.getItem("qtiler.lang") || navigator.language || "en");

  // Use centralised translations via qtilerI18n when available.
  const tr = (key, replacements) => {
    try {
      if (window.qtilerI18n && typeof window.qtilerI18n.t === 'function') return window.qtilerI18n.t(key, replacements);
    } catch (e) {}
    return key;
  };
  const ERROR_KEY_MAP = {
    'invalid_credentials': 'login.error.invalidCredentials',
    'user_disabled': 'login.error.userDisabled',
    'missing_credentials': 'login.error.invalidCredentials'
  };

  let busy = false;
  let statusState = { key: null, params: {}, text: '', state: '' };
  let tokenTtlSeconds = 86400;

  const persistRemembered = (username) => {
    try {
      if (username && username.trim()) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: username.trim() }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {}
  };

  const readRemembered = () => {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const syncRememberState = () => {
    const saved = readRemembered();
    if (rememberCheckbox) {
      rememberCheckbox.checked = !!(saved && saved.username);
    }
    if (saved && saved.username && usernameInput && !usernameInput.value) {
      usernameInput.value = saved.username;
    }
  };

  const renderStatus = () => {
    if (!statusEl) return;
    let message = '';
    if (statusState.key) {
      message = tr(statusState.key, statusState.params || {});
    } else if (statusState.text) {
      message = statusState.text;
    }
    statusEl.textContent = message;
    statusEl.dataset.state = statusState.state || '';
  };

  const setStatus = ({ key = null, params = {}, text = '', state = '' } = {}) => {
    statusState = { key, params, text, state };
    renderStatus();
  };

  const applyTranslations = () => {
    try {
      if (document?.documentElement) document.documentElement.setAttribute('lang', window.qtilerLang?.get?.() || currentLang);
      if (document.querySelector) {
        const pageTitle = document.querySelector('title[data-i18n="login.pageTitle"]');
        if (pageTitle) pageTitle.textContent = tr('login.pageTitle');
      }
      if (window.qtilerI18n && typeof window.qtilerI18n.apply === 'function') {
        try { window.qtilerI18n.apply(); } catch (e) {}
      }
      submitBtn.textContent = busy ? tr('login.status.busy') : tr('login.button.submit');
      resetBtn.textContent = tr('login.button.reset');
      if (languageSelect) languageSelect.value = window.qtilerLang?.get?.() || currentLang;
      renderStatus();
    } catch (e) {}
  };

  const setBusy = (value) => {
    busy = !!value;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? tr('login.status.busy') : tr('login.button.submit');
    if (busy) {
      setStatus();
    }
  };

  const handleSuccess = (user) => {
    window.location.href = '/index.html';
  };

  const handleError = async (response) => {
    let key = 'login.error.invalidCredentials';
    let detailText = '';
    try {
      const data = await response.json();
      if (data && (data.error || data.message)) {
        const mappedKey = ERROR_KEY_MAP[data.error] || ERROR_KEY_MAP[data.message];
        if (mappedKey) {
          key = mappedKey;
        } else {
          detailText = data.message || data.error;
        }
      }
    } catch (err) {
      // ignore parse errors
    }
    setStatus({ key, text: detailText, state: 'error' });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        username: usernameInput.value.trim(),
        password: passwordInput.value
      };
      if (rememberCheckbox) {
        if (rememberCheckbox.checked) {
          persistRemembered(payload.username);
        } else {
          persistRemembered('');
        }
      }
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        await handleError(response);
        passwordInput.value = '';
        passwordInput.focus();
        return;
      }
      const data = await response.json();
      handleSuccess(data?.user || null);
    } catch (err) {
      setStatus({ key: 'login.error.network', state: 'error' });
    } finally {
      setBusy(false);
    }
  });

  resetBtn.addEventListener('click', () => {
    submitBtn.hidden = false;
    setBusy(false);
    resetBtn.hidden = true;
    setStatus();
  });

  const checkSession = async () => {
    try {
      const response = await fetch('/auth/me', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      if (data && data.user) {
        handleSuccess(data.user);
      }
    } catch (err) {
      // ignore
    }
  };

  const setLanguage = (lang) => {
    if (window.qtilerLang?.set) {
      window.qtilerLang.set(lang);
      return;
    }
    currentLang = normalizeLang(lang);
    try {
      localStorage.setItem('qtiler.lang', currentLang);
    } catch {}
    applyTranslations();
  };

  if (languageSelect) {
    languageSelect.value = currentLang;
    languageSelect.addEventListener('change', (event) => setLanguage(event.target.value));
  }

  if (rememberCheckbox) {
    rememberCheckbox.addEventListener('change', () => {
      if (rememberCheckbox.checked) {
        persistRemembered(usernameInput.value.trim());
      } else {
        persistRemembered('');
      }
    });
  }

  if (usernameInput && rememberCheckbox) {
    usernameInput.addEventListener('blur', () => {
      if (rememberCheckbox.checked) {
        persistRemembered(usernameInput.value.trim());
      }
    });
  }

  if (window.qtilerLang?.subscribe) {
    window.qtilerLang.subscribe((lang) => {
      const normalized = normalizeLang(lang);
      if (normalized === currentLang) return;
      currentLang = normalized;
      applyTranslations();
    });
  }

  syncRememberState();
  applyTranslations();
  checkSession();
})();
