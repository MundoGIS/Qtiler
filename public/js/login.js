/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

(function() {
  const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
    ? window.qtilerLang.SUPPORTED_LANGS
    : ["en", "es", "sv", "no"];
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
  const languageSelect = document.getElementById('language_selector') || document.getElementById('lang_select');
  
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
    'missing_credentials': 'login.error.invalidCredentials',
    'too_many_attempts': 'login.error.tooManyAttempts',
    'captcha_required': 'login.error.captchaRequired',
    'captcha_failed': 'login.error.captchaRequired',
    'captcha_missing': 'login.error.captchaRequired'
  };

  /* ----- Captcha (Cloudflare Turnstile / hCaptcha) lazy loader ----- */
  const captchaSlot = document.getElementById('login_captcha_slot');
  let captchaState = {
    provider: null,
    siteKey: null,
    widgetId: null,
    scriptLoaded: false,
    token: null
  };

  const loadCaptchaScript = (provider) => new Promise((resolve, reject) => {
    if (provider === 'pow') return resolve(); // No external script for built-in PoW.
    if (captchaState.scriptLoaded) return resolve();
    const urls = {
      turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      hcaptcha: 'https://hcaptcha.com/1/api.js?render=explicit',
      recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit'
    };
    const src = urls[provider];
    if (!src) return reject(new Error('unknown_captcha_provider'));
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => { captchaState.scriptLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('captcha_script_error'));
    document.head.appendChild(s);
  });

  const renderCaptcha = async (provider, siteKey) => {
    if (!captchaSlot) return;
    captchaState.provider = provider;
    captchaState.siteKey = siteKey;
    captchaSlot.hidden = false;
    try {
      await loadCaptchaScript(provider);
    } catch {
      return;
    }
    const tries = 20;
    let i = 0;
    const lib = () => provider === 'turnstile' ? window.turnstile
      : provider === 'hcaptcha' ? window.hcaptcha
      : window.grecaptcha;
    const tick = () => {
      if (lib() && typeof lib().render === 'function') {
        captchaSlot.innerHTML = '';
        try {
          captchaState.widgetId = lib().render(captchaSlot, {
            sitekey: siteKey,
            callback: (token) => { captchaState.token = token; }
          });
        } catch {}
        return;
      }
      if (++i < tries) setTimeout(tick, 200);
    };
    tick();
  };

  /* ---- Built-in proof-of-work solver (no external dependencies) ---- */
  const _powTextEnc = new TextEncoder();
  const _hexBytes = (buf) => {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
    return s;
  };
  const _powHasLeadingZeros = (hex, bits) => {
    let r = bits;
    for (let i = 0; i < hex.length && r > 0; i++) {
      const n = parseInt(hex[i], 16);
      if (r >= 4) { if (n !== 0) return false; r -= 4; }
      else { const mask = (0xf << (4 - r)) & 0xf; return (n & mask) === 0; }
    }
    return true;
  };
  const solvePow = async (challenge, difficulty) => {
    if (!window.crypto?.subtle) throw new Error('crypto_subtle_unavailable');
    let nonce = 0;
    while (true) {
      const candidate = String(nonce);
      const buf = await window.crypto.subtle.digest('SHA-256', _powTextEnc.encode(challenge + ':' + candidate));
      if (_powHasLeadingZeros(_hexBytes(buf), difficulty)) return candidate;
      nonce++;
      // Yield to the event loop occasionally so the page stays responsive.
      if ((nonce & 0xff) === 0) await new Promise((r) => setTimeout(r, 0));
    }
  };
  const ensurePowToken = async () => {
    try {
      const r = await fetch('/auth/captcha-challenge', { credentials: 'include' });
      if (!r.ok) return;
      const c = await r.json();
      if (!c?.challenge || !c?.sig || !Number.isFinite(c.exp) || !Number.isFinite(c.difficulty)) return;
      if (captchaSlot) {
        captchaSlot.hidden = false;
        captchaSlot.textContent = '…';
      }
      const nonce = await solvePow(c.challenge, c.difficulty);
      captchaState.token = `${c.challenge}.${c.exp}.${c.difficulty}.${c.sig}.${nonce}`;
      if (captchaSlot) captchaSlot.textContent = '✓';
    } catch {
      // Leave captchaState.token null — the server will reject and the user
      // will see the standard captcha-required error.
    }
  };

  const ensureCaptcha = async (provider, siteKey) => {
    if (!provider) return;
    if (provider === 'pow') {
      // Always fetch a fresh challenge per submit — they're single-use.
      captchaState.provider = 'pow';
      await ensurePowToken();
      return;
    }
    if (!siteKey) return;
    if (captchaState.provider === provider && captchaState.widgetId !== null) return;
    await renderCaptcha(provider, siteKey);
  };

  const consumeCaptchaToken = () => {
    const t = captchaState.token || '';
    captchaState.token = null;
    if (captchaState.provider === 'pow') {
      if (captchaSlot) { captchaSlot.textContent = ''; captchaSlot.hidden = true; }
      return t;
    }
    if (captchaState.widgetId !== null) {
      const lib = captchaState.provider === 'turnstile' ? window.turnstile
        : captchaState.provider === 'hcaptcha' ? window.hcaptcha
        : window.grecaptcha;
      try { lib?.reset?.(captchaState.widgetId); } catch {}
    }
    return t;
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

  const flashStatusText = (text, { state = 'info', ttlMs = 10000 } = {}) => {
    setStatus({ text, state });
    if (Number.isFinite(ttlMs) && ttlMs > 0) {
      setTimeout(() => {
        if (statusState.text === text) {
          setStatus();
        }
      }, ttlMs);
    }
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
      if (data) {
        // Server is asking us to render a captcha for the next attempt.
        if ((data.error === 'captcha_required' || response.status === 400) && data.captchaProvider && data.captchaSiteKey) {
          await ensureCaptcha(data.captchaProvider, data.captchaSiteKey);
        }
        if (data.error || data.message) {
          const mappedKey = ERROR_KEY_MAP[data.error] || ERROR_KEY_MAP[data.message];
          if (mappedKey) {
            key = mappedKey;
          } else {
            detailText = data.message || data.error;
          }
        }
        if (response.status === 429 && data.retryAfterSeconds) {
          detailText = ` (${Math.ceil(data.retryAfterSeconds / 60)} min)`;
        }
      }
    } catch (err) {
      // ignore parse errors
    }
    setStatus({ key, text: detailText, state: 'error' });
  };

  const fetchLoginStatus = async (username) => {
    try {
      const res = await fetch('/auth/login-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const username = usernameInput.value.trim();
      // Preflight: ask the server whether captcha is needed (and load widget if so).
      const status = await fetchLoginStatus(username);
      if (status && status.requireCaptcha && status.captchaProvider && status.captchaSiteKey) {
        await ensureCaptcha(status.captchaProvider, status.captchaSiteKey);
        if (!captchaState.token) {
          setStatus({ key: 'login.error.captchaRequired', state: 'error' });
          return;
        }
      }
      const payload = {
        username,
        password: passwordInput.value,
        // Honeypot — must always be empty for real users.
        email_confirm: document.getElementById('login_email_confirm')?.value || '',
        captchaToken: consumeCaptchaToken() || null
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

  // After installing the auth plugin we redirect to /login?justInstalled=1.
  // Show the default credentials for a short time, then remove the query param.
  try {
    const params = new URLSearchParams(window.location.search || '');
    const justInstalled = params.get('justInstalled');
    if (justInstalled && justInstalled !== '0') {
      const defaultUser = 'admin';
      const defaultPass = 'admin2026';
      const text = `Use this username and password and change the default password: ${defaultUser} / ${defaultPass}`;
      flashStatusText(text, { state: 'info', ttlMs: 20000 });

      params.delete('justInstalled');
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, nextUrl);
      }
    }
  } catch {
    // ignore
  }

  checkSession();
})();

// If page is restored from back/forward cache, reload to refresh auth/session state.
window.addEventListener('pageshow', (event) => {
  try {
    if (event && event.persisted) {
      console.log('pageshow persisted (login) - reloading to refresh auth state');
      window.location.reload();
    }
  } catch (e) {}
});

// Ensure clicking the brand/logo goes to a fresh page (prevent bfcache stale UI)
document.addEventListener('click', (evt) => {
  try {
    const link = evt.target && evt.target.closest ? evt.target.closest('a.brand-logo, a.nav-link') : null;
    if (!link || !(link instanceof HTMLAnchorElement)) return;
    const href = link.getAttribute('href') || link.href;
    if (!href) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      evt.preventDefault();
      const sep = url.search ? '&' : '?';
      location.href = url.pathname + url.search + sep + '_cb=' + Date.now();
    }
  } catch (e) {}
}, true);
