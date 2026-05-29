/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

 // === Inactivity Timeout Auto-Logout ===
      const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
      let inactivityTimer = null;

      function resetInactivityTimer() {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          console.log('Inactivity timeout reached - logging out');
          fetch('/auth/logout', { method: 'POST', credentials: 'include' })
            .catch(() => {})
            .finally(() => {
              window.location.href = '/login?reason=inactivity';
            });
        }, INACTIVITY_TIMEOUT_MS);
      }

      function initInactivityMonitor() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
          events.forEach(event => {
          document.addEventListener(event, resetInactivityTimer, true);
        });
        resetInactivityTimer();
      }

      // Start monitoring after user is authenticated
      let inactivityMonitorActive = false;

      // Ensure clicking the brand/logo leads to a fresh navigation (avoid bfcache stale UI).
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

      const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
        ? window.qtilerLang.SUPPORTED_LANGS
        : ["en", "es", "sv", "no", "da", "fi"];
      const normalizeLang = window.qtilerLang?.normalize || ((value) => {
        const raw = (value || "").toLowerCase();
        if (SUPPORTED_LANGS.includes(raw)) return raw;
        const base = raw.split("-")[0];
        return SUPPORTED_LANGS.includes(base) ? base : "en";
      });
      let currentLang = window.qtilerLang?.get?.() || normalizeLang(localStorage.getItem("qtiler.lang") || navigator.language || "en");
      // Translations are centralized in /public/lang-support.js (window.TRANSLATIONS)

      const PROJECT_COLLAPSE_STORAGE_KEY = 'qtiler.projectCollapse.v1';
      let collapsePrefsCache = null;

      const readCollapsePrefs = () => {
        if (collapsePrefsCache) return collapsePrefsCache;
        try {
          const raw = localStorage.getItem(PROJECT_COLLAPSE_STORAGE_KEY);
          if (!raw) {
            collapsePrefsCache = {};
          } else {
            const parsed = JSON.parse(raw);
              collapsePrefsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          }
        } catch {
          collapsePrefsCache = {};
        }
        return collapsePrefsCache;
      };
      

      const getStoredCollapse = (projectId) => {
        if (!projectId) return null;
        const prefs = readCollapsePrefs();
        return Object.prototype.hasOwnProperty.call(prefs, projectId) ? !!prefs[projectId] : null;
      };

      const writeCollapsePrefs = () => {
        if (!collapsePrefsCache) return;
        try {
          localStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsePrefsCache));
        } catch {}
      };

      const setStoredCollapse = (projectId, collapsed) => {
        if (!projectId) return;
        const prefs = readCollapsePrefs();
        if (collapsed) {
          prefs[projectId] = true;
        } else if (Object.prototype.hasOwnProperty.call(prefs, projectId)) {
          delete prefs[projectId];
        }
        writeCollapsePrefs();
      };

      const removeStoredCollapse = (projectId) => {
        if (!projectId) return;
        const prefs = readCollapsePrefs();
        if (Object.prototype.hasOwnProperty.call(prefs, projectId)) {
          delete prefs[projectId];
          writeCollapsePrefs();
        }
      };

      const tr = (text, replacements = {}) => {
        if (!text) return "";
        const table = TRANSLATIONS[currentLang] || {};
        let template = table[text] || text;
        return template.replace(/\{(\w+)\}/g, (_, token) => (token in replacements ? replacements[token] : ""));
      };

      const authButton = document.getElementById('auth_button');
        const authUserBadge = document.getElementById('auth_user_badge');
        const adminConsoleLink = document.getElementById('admin_console_link');
        const adminInstallLink = document.getElementById('admin_install_auth');
        const authPluginNotice = document.getElementById('auth_plugin_notice');
        const authPluginNoticeClose = document.getElementById('auth_plugin_notice_close');
        const authPluginLearnMore = document.getElementById('auth_plugin_notice_learn_more');
        const authPluginDismissCheckbox = document.getElementById('auth_plugin_notice_dismiss');
  const AUTH_PLUGIN_INSTALL_URL = '/admin';
      const AUTH_PLUGIN_LEARN_MORE_URL = 'https://mundogis.se';
      const AUTH_NOTICE_DISMISS_KEY = 'qtiler.dismissAuthNotice';
      const setAuthNoticeDismissed = (value) => {
        try {
          localStorage.setItem(AUTH_NOTICE_DISMISS_KEY, value ? '1' : '0');
        } catch {}
      };
      const isAuthNoticeDismissed = () => {
        try {
          return localStorage.getItem(AUTH_NOTICE_DISMISS_KEY) === '1';
        } catch {
          return false;
        }
      };
      const syncAuthNoticeCheckbox = () => {
        if (!authPluginDismissCheckbox) return;
        authPluginDismissCheckbox.checked = isAuthNoticeDismissed();
      };
      let authUser = null;
      let authCheckInFlight = false;
      let authPluginMissing = false;
  let authPluginMissingMessageShown = false;

      // Append api_key to a URL when user is logged in and the project is not public
      const withApiKey = (url, project) => {
        if (!url) return url;
        if (!authUser || !authUser.apiKey) return url;
        if (project && project.isPublic) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}api_key=${encodeURIComponent(authUser.apiKey)}`;
      };
      const normalizeCrsCode = (value) => {
        if (typeof value !== 'string') return null;
        const normalized = value.trim().toUpperCase();
        return normalized || null;
      };
      const isXyzCompatibleCrs = (value) => {
        const normalized = normalizeCrsCode(value);
        if (!normalized) return false;
        return normalized === 'EPSG:3857'
          || normalized === 'EPSG:900913'
          || normalized === 'EPSG:102100'
          || normalized === 'EPSG:3785'
          || normalized === 'URN:OGC:DEF:CRS:EPSG::3857';
      };
      // Expose for plugin client scripts (e.g. VectorTiles dashboard)
      window.qtilerWithApiKey = withApiKey;

      /* Removed refreshAuthUi() and fetchAuthState() - functionality now handled by checkAuthPlugin() IIFE */
      /*
      const refreshAuthUi = () => { ... };
      const updateAuthUser = (user) => { ... };
      const fetchAuthState = async () => { ... };
      */


      if (authButton) {
        authButton.addEventListener('click', async () => {
          const buttonText = authButton.textContent.trim();
          
          // Check if button says "Logout" (or translated equivalent)
          // We use 'Logout' key because that's what checkAuthPlugin sets
          if (buttonText === tr('Logout') || buttonText === 'Logout' || buttonText === 'Sign out') {
            authButton.disabled = true;
            try {
              await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-store' }
              });
            } catch {}
            authUser = null;
            if (authUserBadge) {
              authUserBadge.hidden = true;
              authUserBadge.style.display = 'none';
            }
            if (adminConsoleLink) {
              adminConsoleLink.hidden = true;
              adminConsoleLink.style.display = 'none';
            }
            window.location.replace(`/login?loggedOut=1&_cb=${Date.now()}`);
            return;
          }
          
          // Otherwise redirect to login
          window.location.href = '/login';
        });
      }

      if (authPluginNotice && authPluginNoticeClose) {
        syncAuthNoticeCheckbox();

        if (isAuthNoticeDismissed()) {
          authPluginNotice.hidden = true;
        }

        if (authPluginDismissCheckbox) {
          authPluginDismissCheckbox.addEventListener('change', () => {
            setAuthNoticeDismissed(authPluginDismissCheckbox.checked);
            if (authPluginDismissCheckbox.checked) {
              authPluginNotice.hidden = true;
            } else if (authPluginMissing) {
              authPluginNotice.hidden = false;
            }
          });
        }

        authPluginNoticeClose.addEventListener('click', () => {
          authPluginNotice.hidden = true;
          setAuthNoticeDismissed(!!authPluginDismissCheckbox?.checked);
        });

        if (authPluginLearnMore) {
          authPluginLearnMore.addEventListener('click', (event) => {
            event.preventDefault();
            window.open(AUTH_PLUGIN_LEARN_MORE_URL, '_blank', 'noopener');
            if (authPluginDismissCheckbox?.checked) {
              setAuthNoticeDismissed(true);
            }
          });
        }
      }

      const applyStaticTranslations = () => {
        document.documentElement.setAttribute("lang", currentLang);
        document.querySelectorAll("[data-i18n]").forEach(el => {
          const key = el.getAttribute("data-i18n");
          if (!key) return;
          const translated = tr(key);
          if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            if (el.hasAttribute("placeholder")) el.placeholder = translated;
          } else {
            el.textContent = translated;
          }
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
          const key = el.getAttribute("data-i18n-placeholder");
          if (!key) return;
          el.placeholder = tr(key);
        });
        if (typeof checkAuthPlugin === 'function') {
          checkAuthPlugin();
        }
      };

        // Reload page when restored from back/forward cache to ensure auth state is fresh.
        // Some browsers restore DOM from bfcache without re-running scripts; on pageshow
        // with event.persisted we force a reload so UI reflects current login state.
        window.addEventListener('pageshow', (event) => {
          try {
            if (event && event.persisted) {
              console.log('pageshow persisted - reloading to refresh auth state');
              window.location.reload();
            }
          } catch (e) {}
        });

      const setLanguage = (lang) => {
        if (window.qtilerLang?.set) {
          window.qtilerLang.set(lang);
          return;
        }
        currentLang = normalizeLang(lang);
        try {
          localStorage.setItem("qtiler.lang", currentLang);
        } catch {}
        applyStaticTranslations();
        if (languageSelect && languageSelect.value !== currentLang) {
          languageSelect.value = currentLang;
        }
      };

      // --- Project extent maps (per project) ---
      const extentStates = new Map(); // id -> { extent: [minLon,minLat,maxLon,maxLat], open: bool, map: Leaflet instance, metaInfoEl, config }
      let leafletReadyPromise = null;
      const projectConfigs = new Map();
      const projectConfigPending = new Map();
      const projectConfigTimers = new Map();
  const projectBatchFetches = new Map();
      let activeProjectId = null;
      let suppressControlSync = false;

      const footerYearEl = document.getElementById('footer_year');
      if (footerYearEl) {
        footerYearEl.textContent = String(new Date().getFullYear());
      }

      const qtilerPluginHooks = window.qtilerPluginHooks || { layerInfoTabs: [], layerActionButtons: [] };
      window.qtilerPluginHooks = qtilerPluginHooks;
      if (!Array.isArray(qtilerPluginHooks.layerActionButtons)) qtilerPluginHooks.layerActionButtons = [];
      const loadedPluginClients = new Set();
      const currentScriptEl = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
      const pluginClientVersion = String(currentScriptEl?.dataset?.qtilerAssetVersion || window.qtilerAssetVersion || '').trim();
      const withPluginClientVersion = (url) => {
        if (!url || !pluginClientVersion) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}v=${encodeURIComponent(pluginClientVersion)}`;
      };
      const loadPluginClientScript = (url) => new Promise((resolve, reject) => {
        const finalUrl = withPluginClientVersion(url);
        if (!finalUrl || loadedPluginClients.has(finalUrl)) return resolve();
        const script = document.createElement('script');
        script.src = finalUrl;
        script.async = true;
        script.onload = () => {
          loadedPluginClients.add(finalUrl);
          resolve();
        };
        script.onerror = () => reject(new Error('plugin_load_failed'));
        document.head.appendChild(script);
      });

      const loadPluginClients = async () => {
        try {
          const res = await fetch('/plugins', { credentials: 'include' });
          if (!res.ok) return;
          const payload = await res.json().catch(() => null);
          const enabled = Array.isArray(payload?.enabled) ? payload.enabled : [];
          window.qtilerPluginsEnabled = enabled;
          if (enabled.includes('Qrigo')) {
            await loadPluginClientScript('/plugins/Qrigo/client/qrigo.js');
          }
          if (enabled.includes('ProjectSearch')) {
            await loadPluginClientScript('/plugins/ProjectSearch/client/project-search.js');
          }
          if (enabled.includes('WmsCache')) {
            await loadPluginClientScript('/plugins/WmsCache/client/wmscache-dashboard.js');
          }
          if (enabled.includes('VectorTiles')) {
            await loadPluginClientScript('/plugins/VectorTiles/client/vectortiles-dashboard.js');
          }
          if (enabled.includes('QuantizedMesh')) {
            await loadPluginClientScript('/plugins/QuantizedMesh/client/quantizedmesh-project.js');
          }
        } catch {}
      };

      // Check if auth plugin is enabled and update header buttons
      async function checkAuthPlugin() {
        const installBtn = document.getElementById('admin_install_dashboard');
        const loginBtn = document.getElementById('auth_button');
        const adminLink = document.getElementById('admin_console_link');
        const userBadge = document.getElementById('auth_user_badge');

        // If the server-side API has already told us auth is disabled, don't probe /auth/me.
        // This avoids showing a stale Login button after plugin uninstall (routes may linger
        // until restart, but auth is effectively disabled).
        if (window.appState && window.appState.authEnabled === false) {
          if (installBtn) {
            installBtn.hidden = false;
            installBtn.style.display = 'inline-block';
          }
          if (loginBtn) {
            loginBtn.hidden = true;
            loginBtn.style.display = 'none';
          }
          if (adminLink) {
            adminLink.hidden = true;
            adminLink.style.display = 'none';
          }
          if (userBadge) {
            userBadge.hidden = true;
            userBadge.style.display = 'none';
          }
          authUser = null;
          return;
        }

        try {
          // Avoid /plugins here: when auth is enabled it is admin-only (403 for regular users).
          // /auth/me is a reliable probe:
          // - 200 => logged in
          // - 401 => auth plugin enabled but not logged in
          // - 404/501 => auth plugin not installed/enabled
          const authRes = await fetch('/auth/me', { credentials: 'include' });
          const authAvailable = authRes.status !== 404 && authRes.status !== 501;

          if (!authAvailable) {
            if (installBtn) {
              installBtn.hidden = false;
              installBtn.style.display = 'inline-block';
            }
            if (loginBtn) {
              loginBtn.hidden = true;
              loginBtn.style.display = 'none';
            }
            if (adminLink) {
              adminLink.hidden = true;
              adminLink.style.display = 'none';
            }
            if (userBadge) {
              userBadge.hidden = true;
              userBadge.style.display = 'none';
            }
            authUser = null;
            return;
          }

          if (installBtn) {
            installBtn.hidden = true;
            installBtn.style.display = 'none';
          }

          if (authRes.ok) {
            const authData = await authRes.json().catch(() => null);
            const user = authData?.user || null;
            if (user) {
              if (loginBtn) {
                loginBtn.textContent = tr('Logout');
                loginBtn.setAttribute('data-i18n', 'Logout');
                loginBtn.hidden = false;
                loginBtn.style.display = 'inline-block';
              }
              if (userBadge) {
                const name = user.username || user.displayName || user.id || 'user';
                userBadge.textContent = tr('Signed in as {user}', { user: name });
                userBadge.hidden = false;
                userBadge.style.display = 'inline-block';
              }
              if (adminLink && user.role === 'admin') {
                adminLink.hidden = false;
                adminLink.style.display = 'inline-block';
              } else if (adminLink) {
                adminLink.hidden = true;
                adminLink.style.display = 'none';
              }

              authUser = user;

              if (!inactivityMonitorActive) {
                initInactivityMonitor();
                inactivityMonitorActive = true;
              }
              return;
            }
          }

          // Auth plugin enabled, but user not logged in.
          if (loginBtn) {
            loginBtn.textContent = tr('Login');
            loginBtn.setAttribute('data-i18n', 'Login');
            loginBtn.hidden = false;
            loginBtn.style.display = 'inline-block';
          }
          if (userBadge) {
            userBadge.hidden = true;
            userBadge.style.display = 'none';
          }
          if (adminLink) {
            adminLink.hidden = true;
            adminLink.style.display = 'none';
          }
          authUser = null;
        } catch (err) {
          console.error('Failed to check auth plugin', err);
          // Fail open to the simplest state (show Login) to avoid UI flicker.
          if (installBtn) {
            installBtn.hidden = true;
            installBtn.style.display = 'none';
          }
          if (loginBtn) {
            loginBtn.textContent = tr('Login');
            loginBtn.setAttribute('data-i18n', 'Login');
            loginBtn.hidden = false;
            loginBtn.style.display = 'inline-block';
          }
          if (userBadge) {
            userBadge.hidden = true;
            userBadge.style.display = 'none';
          }
          if (adminLink) {
            adminLink.hidden = true;
            adminLink.style.display = 'none';
          }
          authUser = null;
        }
      };
      
      // Run immediately
      checkAuthPlugin();
      loadPluginClients();

      const deepMergeObjects = (target, patch) => {
        if (!patch || typeof patch !== 'object') return target;
        for (const key of Object.keys(patch)) {
          const value = patch[key];
          if (Array.isArray(value)) {
            target[key] = value.slice();
          } else if (value && typeof value === 'object') {
            const base = target[key] && typeof target[key] === 'object' ? { ...target[key] } : {};
            target[key] = deepMergeObjects(base, value);
          } else {
            target[key] = value;
          }
        }
        return target;
      };

      const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const WEEKDAY_LABELS = {
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat',
        sun: 'Sun'
      };
      const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const DEFAULT_SCHEDULE_TIME = '02:00';
      const DEFAULT_YEARLY_OCCURRENCES = [
        { month: 3, day: 1, time: DEFAULT_SCHEDULE_TIME },
        { month: 7, day: 1, time: DEFAULT_SCHEDULE_TIME },
        { month: 11, day: 1, time: DEFAULT_SCHEDULE_TIME }
      ];
      const WEB_MERCATOR_CODES = ['EPSG:3857', 'EPSG3857', 'EPSG:3858', 'EPSG3858'];
      const MAX_ZOOM_LEVEL = 30;

  let scheduleDialogBackdrop = null;
  let scheduleDialogContainer = null;
  let scheduleDialogKeyHandler = null;
  let recacheDialogBackdrop = null;
  let recacheDialogContainer = null;
  let recacheDialogResolve = null;
  let recacheDialogKeyHandler = null;

      const cloneScheduleEntry = (schedule) => {
        if (!schedule || typeof schedule !== 'object') return null;
        return {
          enabled: schedule.enabled === true,
          mode: typeof schedule.mode === 'string' ? schedule.mode : null,
          weekly: schedule.weekly && typeof schedule.weekly === 'object'
            ? {
                days: Array.isArray(schedule.weekly.days) ? schedule.weekly.days.slice() : [],
                time: schedule.weekly.time || null
              }
            : null,
          monthly: schedule.monthly && typeof schedule.monthly === 'object'
            ? {
                days: Array.isArray(schedule.monthly.days) ? schedule.monthly.days.slice() : [],
                time: schedule.monthly.time || null
              }
            : null,
          yearly: schedule.yearly && typeof schedule.yearly === 'object'
            ? {
                occurrences: Array.isArray(schedule.yearly.occurrences)
                  ? schedule.yearly.occurrences.map((occ) => ({
                      month: Number(occ.month),
                      day: Number(occ.day),
                      time: occ.time || null
                    }))
                  : []
              }
            : null,
          nextRunAt: schedule.nextRunAt || null,
          lastRunAt: schedule.lastRunAt || null,
          lastResult: schedule.lastResult || null,
          lastMessage: schedule.lastMessage || null,
          history: Array.isArray(schedule.history) ? schedule.history.slice() : []
        };
      };

      const describeSchedule = (schedule) => {
        if (!schedule || schedule.enabled !== true) return '';
        const timeLabel = (value) => (value ? value : '00:00');
        if (schedule.mode === 'weekly' && schedule.weekly && Array.isArray(schedule.weekly.days) && schedule.weekly.days.length) {
          const sorted = schedule.weekly.days.slice().sort((a, b) => WEEKDAY_KEYS.indexOf(a) - WEEKDAY_KEYS.indexOf(b));
          const labels = sorted.map((key) => WEEKDAY_LABELS[key] || key.toUpperCase());
          return 'Weekly ' + labels.join(', ') + ' @ ' + timeLabel(schedule.weekly.time);
        }
        if (schedule.mode === 'monthly' && schedule.monthly && Array.isArray(schedule.monthly.days) && schedule.monthly.days.length) {
          const days = schedule.monthly.days.slice().map((n) => Number(n)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
          if (!days.length) return '';
          return 'Monthly ' + days.join(', ') + ' @ ' + timeLabel(schedule.monthly.time);
        }
        if (schedule.mode === 'yearly' && schedule.yearly && Array.isArray(schedule.yearly.occurrences) && schedule.yearly.occurrences.length) {
          const entries = schedule.yearly.occurrences
            .slice()
            .filter((occ) => Number.isInteger(occ.month) && Number.isInteger(occ.day))
            .sort((a, b) => (a.month === b.month ? a.day - b.day : a.month - b.month))
            .map((occ) => {
              const monthName = MONTH_LABELS[(Number(occ.month) || 1) - 1] || `M${occ.month}`;
              return `${monthName} ${occ.day} @ ${timeLabel(occ.time)}`;
            });
          if (!entries.length) return '';
          return 'Yearly ' + entries.join('; ');
        }
        return '';
      };

      const formatTriggerLabel = (token) => {
        if (!token) return '';
        const lower = String(token).toLowerCase();
        if (lower === 'timer' || lower === 'scheduled' || lower === 'scheduled-layer' || lower === 'scheduled-theme') return tr('Timer');
        if (lower === 'manual-recache') return tr('Manual recache');
        if (lower === 'manual-project' || lower === 'manual') return tr('Manual WMTS-cache');
        if (lower === 'manual-theme') return tr('Manual theme');
        return token.charAt(0).toUpperCase() + token.slice(1);
      };

      const formatDateTimeLocal = (value) => {
        if (!value) return '';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString();
      };

      const formatStatusToken = (value) => {
        if (!value) return 'unknown';
        const lower = String(value).toLowerCase();
        if (lower === 'completed') return 'completed';
        if (lower === 'success') return 'success';
        if (lower === 'running') return 'running';
        if (lower === 'queued') return 'queued';
        if (lower === 'error') return 'error';
        if (lower === 'skipped') return 'skipped';
        if (lower === 'aborted') return 'aborted';
        return value;
      };

      const formatJobStatusLabel = (value) => {
        const token = formatStatusToken(value);
        if (token === 'running') return tr('Running');
        if (token === 'queued') return tr('Queued');
        if (token === 'completed') return tr('Completed');
        if (token === 'success') return tr('Success');
        if (token === 'error') return tr('Error');
        if (token === 'aborted') return tr('Aborted');
        if (token === 'skipped') return tr('Skipped');
        return value || tr('Unknown');
      };

      const formatZoomRangeLabel = (min, max) => {
        const hasMin = Number.isFinite(min);
        const hasMax = Number.isFinite(max);
        if (hasMin && hasMax) return 'z' + min + '–' + max;
        if (hasMin) return 'z>=' + min;
        if (hasMax) return 'z<=' + max;
        return null;
      };

      const parseZoomNumber = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return null;
        const rounded = Math.round(num);
        if (rounded < 0 || rounded > MAX_ZOOM_LEVEL) return null;
        return rounded;
      };

      const deriveCachedZoomRange = (entry) => {
        if (!entry) {
          return { min: null, max: null, coverageMin: null, coverageMax: null };
        }
        const minCandidate = parseZoomNumber(entry.last_zoom_min);
        const maxCandidate = parseZoomNumber(entry.last_zoom_max);
        const coverageMin = parseZoomNumber(entry.zoom_min);
        const coverageMax = parseZoomNumber(entry.zoom_max);
        const min = minCandidate != null ? minCandidate : coverageMin;
        const max = maxCandidate != null ? maxCandidate : coverageMax;
        return { min, max, coverageMin, coverageMax };
      };

      function ensureRecacheDialogElements(){
        if (recacheDialogBackdrop) return;
        recacheDialogBackdrop = document.createElement('div');
        recacheDialogBackdrop.className = 'schedule-backdrop';
        recacheDialogBackdrop.dataset.open = '0';
        recacheDialogBackdrop.addEventListener('click', (event) => {
          if (event.target === recacheDialogBackdrop) {
            finishRecacheDialog(null);
          }
        });
        recacheDialogContainer = document.createElement('div');
        recacheDialogContainer.className = 'schedule-dialog recache-dialog';
        recacheDialogBackdrop.appendChild(recacheDialogContainer);
        document.body.appendChild(recacheDialogBackdrop);
      }

      function hideRecacheDialog(){
        if (recacheDialogBackdrop) {
          recacheDialogBackdrop.dataset.open = '0';
        }
        if (recacheDialogContainer) {
          recacheDialogContainer.innerHTML = '';
        }
        if (recacheDialogKeyHandler) {
          document.removeEventListener('keydown', recacheDialogKeyHandler);
          recacheDialogKeyHandler = null;
        }
      }

      function finishRecacheDialog(result){
        hideRecacheDialog();
        if (recacheDialogResolve) {
          const resolver = recacheDialogResolve;
          recacheDialogResolve = null;
          resolver(result);
        }
      }

      const openRecacheDialog = ({ projectId, layerName, cachedEntry }) => {
        ensureRecacheDialogElements();
        return new Promise((resolve) => {
          if (recacheDialogResolve) {
            finishRecacheDialog(null);
          }
          recacheDialogResolve = resolve;
          recacheDialogBackdrop.dataset.open = '1';
          recacheDialogContainer.innerHTML = '';
          if (recacheDialogKeyHandler) {
            document.removeEventListener('keydown', recacheDialogKeyHandler);
            recacheDialogKeyHandler = null;
          }
          const rangeInfo = deriveCachedZoomRange(cachedEntry);
          const coverageLabel = formatZoomRangeLabel(rangeInfo.coverageMin, rangeInfo.coverageMax);
          const controlMin = parseZoomNumber(zoomMinInput ? zoomMinInput.value : null);
          const controlMax = parseZoomNumber(zoomMaxInput ? zoomMaxInput.value : null);
          const defaultMin = rangeInfo.min != null ? rangeInfo.min : (controlMin != null ? controlMin : 0);
          let defaultMax = rangeInfo.max != null ? rangeInfo.max : (controlMax != null ? controlMax : defaultMin);
          if (defaultMax == null) defaultMax = defaultMin;

          const heading = document.createElement('h2');
          heading.textContent = tr('Recache layer');
          recacheDialogContainer.appendChild(heading);

          if (layerName) {
            const subtitle = document.createElement('div');
            subtitle.className = 'meta';
            subtitle.textContent = tr('Layer: ') + layerName;
            recacheDialogContainer.appendChild(subtitle);
          }

          const desc = document.createElement('div');
          desc.className = 'dialog-description';
          desc.textContent = tr('Choose zoom levels for this recache run.');
          recacheDialogContainer.appendChild(desc);

          if (coverageLabel) {
            const coverageRow = document.createElement('div');
            coverageRow.className = 'meta';
            coverageRow.textContent = tr('Cached zoom range: {range}', { range: coverageLabel });
            recacheDialogContainer.appendChild(coverageRow);
          }

          const note = document.createElement('div');
          note.className = 'dialog-note';
          note.textContent = tr('Values only apply to this recache operation.');
          recacheDialogContainer.appendChild(note);

          const form = document.createElement('form');
          recacheDialogContainer.appendChild(form);

          const grid = document.createElement('div');
          grid.className = 'dialog-grid';
          form.appendChild(grid);

          const minField = document.createElement('div');
          minField.className = 'dialog-field';
          const minLabel = document.createElement('label');
          minLabel.setAttribute('for', 'recache_zoom_min');
          minLabel.textContent = tr('Min zoom:');
          const minInput = document.createElement('input');
          minInput.id = 'recache_zoom_min';
          minInput.type = 'number';
          minInput.min = '0';
          minInput.max = String(MAX_ZOOM_LEVEL);
          minInput.step = '1';
          minInput.value = defaultMin != null ? String(defaultMin) : '';
          minInput.autocomplete = 'off';
          minInput.inputMode = 'numeric';
          minField.appendChild(minLabel);
          minField.appendChild(minInput);
          grid.appendChild(minField);

          const maxField = document.createElement('div');
          maxField.className = 'dialog-field';
          const maxLabel = document.createElement('label');
          maxLabel.setAttribute('for', 'recache_zoom_max');
          maxLabel.textContent = tr('Max zoom:');
          const maxInput = document.createElement('input');
          maxInput.id = 'recache_zoom_max';
          maxInput.type = 'number';
          maxInput.min = '0';
          maxInput.max = String(MAX_ZOOM_LEVEL);
          maxInput.step = '1';
          maxInput.value = defaultMax != null ? String(defaultMax) : '';
          maxInput.autocomplete = 'off';
          maxInput.inputMode = 'numeric';
          maxField.appendChild(maxLabel);
          maxField.appendChild(maxInput);
          grid.appendChild(maxField);

          const errorRow = document.createElement('div');
          errorRow.className = 'error';
          errorRow.setAttribute('role', 'alert');
          errorRow.textContent = '';
          form.appendChild(errorRow);

          const actions = document.createElement('div');
          actions.className = 'actions';
          form.appendChild(actions);

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'btn btn-secondary';
          cancelBtn.textContent = tr('Cancel');
          cancelBtn.addEventListener('click', () => finishRecacheDialog(null));
          actions.appendChild(cancelBtn);

          const submitBtn = document.createElement('button');
          submitBtn.type = 'submit';
          submitBtn.className = 'btn btn-primary';
          submitBtn.textContent = tr('Start recache');
          actions.appendChild(submitBtn);

          const clearError = () => {
            errorRow.textContent = '';
          };
          minInput.addEventListener('input', clearError);
          maxInput.addEventListener('input', clearError);

          form.addEventListener('submit', (event) => {
            event.preventDefault();
            const minValue = parseZoomNumber(minInput.value);
            const maxValue = parseZoomNumber(maxInput.value);
            if (minValue == null || maxValue == null) {
              errorRow.textContent = tr('Provide valid zoom numbers (0-30).');
              return;
            }
            if (minValue > maxValue) {
              errorRow.textContent = tr('Min zoom must be less than or equal to max zoom.');
              return;
            }
            finishRecacheDialog({ min: minValue, max: maxValue });
          });

          recacheDialogKeyHandler = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              finishRecacheDialog(null);
            }
          };
          document.addEventListener('keydown', recacheDialogKeyHandler);

          setTimeout(() => {
            try { minInput.focus(); minInput.select(); } catch {}
          }, 0);
        });
      };

      function ensureScheduleDialogElements(){
        if (scheduleDialogBackdrop) return;
        scheduleDialogBackdrop = document.createElement('div');
        scheduleDialogBackdrop.className = 'schedule-backdrop';
        scheduleDialogBackdrop.dataset.open = '0';
        scheduleDialogBackdrop.addEventListener('click', (ev) => {
          if (ev.target === scheduleDialogBackdrop) closeScheduleDialog();
        });
  scheduleDialogContainer = document.createElement('div');
  scheduleDialogContainer.className = 'schedule-dialog';
        scheduleDialogBackdrop.appendChild(scheduleDialogContainer);
        document.body.appendChild(scheduleDialogBackdrop);
      }

      function closeScheduleDialog(){
        if (!scheduleDialogBackdrop) return;
        scheduleDialogBackdrop.dataset.open = '0';
  if (scheduleDialogContainer) scheduleDialogContainer.innerHTML = '';
        if (scheduleDialogKeyHandler) {
          document.removeEventListener('keydown', scheduleDialogKeyHandler);
          scheduleDialogKeyHandler = null;
        }
      }

      // Layer details modal (floating centered)
      let layerDetailsOverlay = null;
      let layerDetailsModal = null;

      function ensureLayerDetailsModal() {
        if (layerDetailsOverlay) return;
        
        layerDetailsOverlay = document.createElement('div');
        layerDetailsOverlay.className = 'qtiler-layer-overlay';

        layerDetailsModal = document.createElement('div');
        layerDetailsModal.className = 'qtiler-layer-modal';

        layerDetailsOverlay.appendChild(layerDetailsModal);
        document.body.appendChild(layerDetailsOverlay);

        // ensure CSS is loaded for modal
        (function ensureCss(){
          if (document.querySelector('link[href="/css/layer-details.css"]')) return;
          try {
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = '/css/layer-details.css';
            document.head.appendChild(l);
          } catch (e) { /* ignore */ }
        }());
        
        layerDetailsOverlay.addEventListener('click', (e) => {
          if (e.target === layerDetailsOverlay) {
            closeLayerDetailsModal();
          }
        });
      }

      function closeLayerDetailsModal() {
        if (layerDetailsOverlay) {
          layerDetailsOverlay.style.display = 'none';
          if (layerDetailsModal) {
            layerDetailsModal.innerHTML = '';
          }
        }
      }

      async function toggleLayerDetails(containerElement, { projectId, layerData, cachedEntry, isAdmin, configLayer, project: projectRef }) {
        if (!projectId || !layerData) return;

        const safeXmlNameLocal = (value) => {
          const raw = (value == null ? '' : String(value)).trim();
          if (!raw) return '_';
          let out = raw.replace(/[^A-Za-z0-9_.-]+/g, '_');
          if (!/^[A-Za-z_]/.test(out)) out = '_' + out;
          if (out.toLowerCase().startsWith('xml')) out = '_' + out;
          return out;
        };

        const isVectorLayerLikeLocal = (layer) => {
          if (!layer) return false;
          if (layer.kind === 'vector' || layer.kind === 'VectorLayer') return true;
          const typeToken = String(layer.type || '').toUpperCase();
          if (layer.geometry_type && !['XYZ', 'OSM', 'WMS', 'WMTS', 'TILE', 'RASTER'].includes(typeToken)) return true;
          return false;
        };
        
        ensureLayerDetailsModal();
        layerDetailsModal.innerHTML = '';

        const state = getProjectState(projectId);
        const projectMeta = state ? state.projectMeta : null;
        
        // Header
        const header = document.createElement('div');
        header.className = 'qtiler-layer-modal__header';

        const title = document.createElement('h2');
        title.className = 'qtiler-layer-modal__title';
        title.textContent = 'Layer Details';
        header.appendChild(title);

        const layerNameEl = document.createElement('div');
        layerNameEl.className = 'qtiler-layer-modal__subtitle';
        layerNameEl.textContent = layerData.name || 'Unknown layer';
        header.appendChild(layerNameEl);

        layerDetailsModal.appendChild(header);

        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'qtiler-layer-modal__tabs';

        // Content
        const content = document.createElement('div');
        content.className = 'qtiler-layer-modal__content';

        const detailsPane = document.createElement('div');
        detailsPane.className = 'qtiler-layer-modal__pane';
        const editPane = document.createElement('div');
        editPane.className = 'qtiler-layer-modal__pane';

        const tabRegistry = [];
        const registerTab = (id, button, pane) => {
          tabRegistry.push({ id, button, pane });
          if (button) tabs.appendChild(button);
          if (pane) content.appendChild(pane);
        };
        const setActiveTab = (id) => {
          tabRegistry.forEach((tab) => {
            const active = tab.id === id;
            if (tab.button) tab.button.classList.toggle('is-active', active);
            if (tab.pane) tab.pane.style.display = active ? '' : 'none';
          });
        };

        const tabDetails = document.createElement('button');
        tabDetails.type = 'button';
        tabDetails.className = 'qtiler-layer-modal__tab';
        tabDetails.textContent = 'Layer Details';
        tabDetails.addEventListener('click', () => setActiveTab('details'));

        const tabEdit = document.createElement('button');
        tabEdit.type = 'button';
        tabEdit.className = 'qtiler-layer-modal__tab';
        tabEdit.textContent = 'Edit parameters';
        if (!isAdmin) {
          tabEdit.disabled = true;
          tabEdit.title = 'Admin only';
        }
        tabEdit.addEventListener('click', () => setActiveTab('edit'));

        registerTab('details', tabDetails, detailsPane);
        registerTab('edit', tabEdit, editPane);
        layerDetailsModal.appendChild(tabs);
        layerDetailsModal.appendChild(content);
        setActiveTab('details');

        // Fetch cached layer data to get tile_matrix_set
        let tileMatrixSet = null;
        
        // Use tile_matrix_set from cachedEntry if available
        if (cachedEntry && cachedEntry.tile_matrix_set) {
          tileMatrixSet = cachedEntry.tile_matrix_set;
          console.log('Using tile_matrix_set from cachedEntry');
        }

        // Build formatted output
        const output = {};
        
        // Add layer name
        output.layerName = layerData.name;
        
        // CRS
        if (layerData.crs) {
          output.crs = layerData.crs;
        }
        
        // projection Extent from tile_matrix_set
        if (tileMatrixSet && tileMatrixSet.topLeftCorner && cachedEntry && cachedEntry.extent) {
          const tlc = tileMatrixSet.topLeftCorner;
          const ext = cachedEntry.extent;
          const matrices = tileMatrixSet.matrices || tileMatrixSet.matrixSet || [];
          if (matrices.length > 0) {
            const finestMatrix = matrices[matrices.length - 1];
            const tileSize = tileMatrixSet.tile_width || 256;
            const res = finestMatrix.resolution;
            const width = finestMatrix.matrix_width * tileSize * res;
            const height = finestMatrix.matrix_height * tileSize * res;
            output.projectionExtent = [tlc[0], tlc[1] - height, tlc[0] + width, tlc[1]];
          }
        }

        // Extent
        if (cachedEntry && cachedEntry.extent) {
          output.extent = cachedEntry.extent;
        }
        
        // Origin / topLeftCorner
        if (tileMatrixSet && tileMatrixSet.topLeftCorner) {
          output.origin = tileMatrixSet.topLeftCorner;
        }

        // Center (calculate from extent)
        if (output.extent && output.extent.length === 4) {
          const [minX, minY, maxX, maxY] = output.extent;
          output.center = [(minX + maxX) / 2, (minY + maxY) / 2];
        }

        // Resolutions from tile_matrix_set (always use project tile grid)
        if (tileMatrixSet) {
          console.log('tileMatrixSet structure:', Object.keys(tileMatrixSet));
          if (tileMatrixSet.matrices && Array.isArray(tileMatrixSet.matrices)) {
            output.resolutions = tileMatrixSet.matrices.map(m => m.resolution);
            console.log('Got resolutions from matrices:', output.resolutions.length);
          } else if (tileMatrixSet.matrixSet && Array.isArray(tileMatrixSet.matrixSet)) {
            output.resolutions = tileMatrixSet.matrixSet.map(m => m.resolution);
            console.log('Got resolutions from matrixSet:', output.resolutions.length);
          } else {
            console.warn('No matrices or matrixSet found in tileMatrixSet');
          }
          
          // Store tile grid ID for editing
          if (tileMatrixSet.id) {
            output.tileGridId = tileMatrixSet.id;
          }
        } else {
          console.warn('No tileMatrixSet available');
        }

        // Create output text
        const outputText = JSON.stringify(output, null, 2);

        // Show project configuration above layer config (if available)
        let projectConfigForDisplay = null;
        try {
          const pcRes = await fetch(`/projects/${encodeURIComponent(projectId)}/config`, { credentials: 'include' });
          if (pcRes.ok) projectConfigForDisplay = await pcRes.json();
        } catch (e) { projectConfigForDisplay = null; }
        if (projectConfigForDisplay) {
          const projLabel = document.createElement('div');
          projLabel.className = 'meta';
          projLabel.textContent = 'Project configuration';
          detailsPane.appendChild(projLabel);
          const preProj = document.createElement('pre');
          preProj.className = 'qtiler-layer-modal__pre';
          try { preProj.textContent = JSON.stringify(projectConfigForDisplay, null, 2); } catch (e) { preProj.textContent = String(projectConfigForDisplay); }
          detailsPane.appendChild(preProj);
        }

        // Create pre element for layer output
        const pre = document.createElement('pre');
        pre.className = 'qtiler-layer-modal__pre';
        pre.textContent = outputText;
        detailsPane.appendChild(pre);

        // WMTS URLs section
        const wmtsSection = document.createElement('div');
        wmtsSection.style.marginTop = '24px';
        wmtsSection.style.paddingTop = '24px';
        wmtsSection.style.borderTop = '1px solid rgba(0, 0, 0, 0.1)';

        const wmtsLabel = document.createElement('div');
        wmtsLabel.style.fontSize = '14px';
        wmtsLabel.style.fontWeight = '600';
        wmtsLabel.style.marginBottom = '12px';
        wmtsLabel.style.color = '#333';
        wmtsLabel.textContent = 'WMTS URLs';
        wmtsSection.appendChild(wmtsLabel);

        // Determine if it's a theme or layer
        const isTheme = layerData.layers && Array.isArray(layerData.layers);
        const layerName = layerData.name;
        const xyzPath = isTheme
          ? `/wmts/${encodeURIComponent(projectId)}/themes/${encodeURIComponent(layerName)}/{z}/{x}/{y}.png`
          : `/wmts/${encodeURIComponent(projectId)}/${encodeURIComponent(layerName)}/{z}/{x}/{y}.png`;
        const xyzCrs = (cachedEntry && (cachedEntry.tile_crs || cachedEntry.tileCrs || cachedEntry.crs))
          || output?.tileCrs
          || layerData?.tile_crs
          || layerData?.tileCrs
          || layerData?.crs
          || projectMeta?.crs
          || null;
        const xyzEnabled = isXyzCompatibleCrs(xyzCrs);

        if (xyzEnabled) {
          // XYZ URL (for Origo and similar clients)
          const xyzUrl = withApiKey(`${window.location.origin}${xyzPath}`, projectRef);

          const xyzLabel = document.createElement('div');
          xyzLabel.style.fontSize = '12px';
          xyzLabel.style.fontWeight = '600';
          xyzLabel.style.marginTop = '12px';
          xyzLabel.style.marginBottom = '4px';
          xyzLabel.style.color = '#666';
          xyzLabel.textContent = 'XYZ URL (for Origo Web Map):';
          wmtsSection.appendChild(xyzLabel);

          const xyzUrlContainer = document.createElement('div');
          xyzUrlContainer.style.display = 'flex';
          xyzUrlContainer.style.gap = '8px';
          xyzUrlContainer.style.marginBottom = '16px';

          const xyzUrlInput = document.createElement('input');
          xyzUrlInput.type = 'text';
          xyzUrlInput.readOnly = true;
          xyzUrlInput.value = xyzUrl;
          xyzUrlInput.style.flex = '1';
          xyzUrlInput.style.padding = '8px';
          xyzUrlInput.style.fontFamily = 'Consolas, Monaco, monospace';
          xyzUrlInput.style.fontSize = '12px';
          xyzUrlInput.style.border = '1px solid #ccc';
          xyzUrlInput.style.borderRadius = '4px';
          xyzUrlInput.style.background = '#f8f9fa';
          xyzUrlContainer.appendChild(xyzUrlInput);

          const xyzCopyBtn = document.createElement('button');
          xyzCopyBtn.type = 'button';
          xyzCopyBtn.className = 'btn btn-secondary btn-sm';
          xyzCopyBtn.textContent = 'Copy';
          xyzCopyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(xyzUrl).then(() => {
              showStatus('XYZ URL copied to clipboard');
            }).catch(err => {
              showStatus('Copy failed: ' + String(err), true);
            });
          });
          xyzUrlContainer.appendChild(xyzCopyBtn);
          wmtsSection.appendChild(xyzUrlContainer);
        }

        // GetCapabilities URL (standard WMTS)
        const capabilitiesUrl = withApiKey(`${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(layerName)}`, projectRef);
        
        const capLabel = document.createElement('div');
        capLabel.style.fontSize = '12px';
        capLabel.style.fontWeight = '600';
        capLabel.style.marginBottom = '4px';
        capLabel.style.color = '#666';
        capLabel.textContent = 'GetCapabilities URL (standard WMTS):';
        wmtsSection.appendChild(capLabel);

        const capUrlContainer = document.createElement('div');
        capUrlContainer.style.display = 'flex';
        capUrlContainer.style.gap = '8px';

        const capUrlInput = document.createElement('input');
        capUrlInput.type = 'text';
        capUrlInput.readOnly = true;
        capUrlInput.value = capabilitiesUrl;
        capUrlInput.style.flex = '1';
        capUrlInput.style.padding = '8px';
        capUrlInput.style.fontFamily = 'Consolas, Monaco, monospace';
        capUrlInput.style.fontSize = '12px';
        capUrlInput.style.border = '1px solid #ccc';
        capUrlInput.style.borderRadius = '4px';
        capUrlInput.style.background = '#f8f9fa';
        capUrlContainer.appendChild(capUrlInput);

        const capCopyBtn = document.createElement('button');
        capCopyBtn.type = 'button';
        capCopyBtn.className = 'btn btn-secondary btn-sm';
        capCopyBtn.textContent = 'Copy';
        capCopyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(capabilitiesUrl).then(() => {
            showStatus('GetCapabilities URL copied to clipboard');
          }).catch(err => {
            showStatus('Copy failed: ' + String(err), true);
          });
        });
        capUrlContainer.appendChild(capCopyBtn);
        wmtsSection.appendChild(capUrlContainer);

        // WMS GetCapabilities URL
        const wmsCapabilitiesUrl = withApiKey(`${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`, projectRef);

        const wmsLabel = document.createElement('div');
        wmsLabel.style.fontSize = '14px';
        wmsLabel.style.fontWeight = '600';
        wmsLabel.style.marginTop = '20px';
        wmsLabel.style.marginBottom = '12px';
        wmsLabel.style.color = '#333';
        wmsLabel.textContent = 'WMS URL';
        wmtsSection.appendChild(wmsLabel);

        const wmsCapLabel = document.createElement('div');
        wmsCapLabel.style.fontSize = '12px';
        wmsCapLabel.style.fontWeight = '600';
        wmsCapLabel.style.marginBottom = '4px';
        wmsCapLabel.style.color = '#666';
        wmsCapLabel.textContent = 'GetCapabilities URL (standard WMS):';
        wmtsSection.appendChild(wmsCapLabel);

        const wmsCapUrlContainer = document.createElement('div');
        wmsCapUrlContainer.style.display = 'flex';
        wmsCapUrlContainer.style.gap = '8px';

        const wmsCapUrlInput = document.createElement('input');
        wmsCapUrlInput.type = 'text';
        wmsCapUrlInput.readOnly = true;
        wmsCapUrlInput.value = wmsCapabilitiesUrl;
        wmsCapUrlInput.style.flex = '1';
        wmsCapUrlInput.style.padding = '8px';
        wmsCapUrlInput.style.fontFamily = 'Consolas, Monaco, monospace';
        wmsCapUrlInput.style.fontSize = '12px';
        wmsCapUrlInput.style.border = '1px solid #ccc';
        wmsCapUrlInput.style.borderRadius = '4px';
        wmsCapUrlInput.style.background = '#f8f9fa';
        wmsCapUrlContainer.appendChild(wmsCapUrlInput);

        const wmsCapCopyBtn = document.createElement('button');
        wmsCapCopyBtn.type = 'button';
        wmsCapCopyBtn.className = 'btn btn-secondary btn-sm';
        wmsCapCopyBtn.textContent = 'Copy';
        wmsCapCopyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(wmsCapabilitiesUrl).then(() => {
            showStatus(tr('WMS URL copied to clipboard'));
          }).catch(err => {
            showStatus('Copy failed: ' + String(err), true);
          });
        });
        wmsCapUrlContainer.appendChild(wmsCapCopyBtn);
        wmtsSection.appendChild(wmsCapUrlContainer);

        detailsPane.appendChild(wmtsSection);

        const pluginTabs = Array.isArray(window.qtilerPluginHooks?.layerInfoTabs)
          ? window.qtilerPluginHooks.layerInfoTabs
          : [];
        const pluginTabInstances = [];
        const buildPluginContext = () => ({
          projectId,
          layerData,
          cachedEntry,
          projectMeta,
          tileMatrixSet,
          output,
          isAdmin,
          configLayer,
          tr
        });
        const renderPluginTab = (tab, pane) => {
          pane.innerHTML = '';
          try {
            const rendered = tab.render ? tab.render({ ...buildPluginContext(), container: pane }) : null;
            if (rendered && typeof rendered.then === 'function') {
              rendered.then((node) => {
                if (node instanceof HTMLElement) pane.appendChild(node);
              }).catch(() => {
                const msg = document.createElement('div');
                msg.className = 'meta';
                msg.textContent = 'Plugin tab failed to render.';
                pane.appendChild(msg);
              });
            } else if (rendered instanceof HTMLElement) {
              pane.appendChild(rendered);
            }
          } catch (err) {
            const msg = document.createElement('div');
            msg.className = 'meta';
            msg.textContent = 'Plugin tab failed to render.';
            pane.appendChild(msg);
          }
        };
        const refreshPluginTabs = () => {
          pluginTabInstances.forEach((entry) => {
            if (!entry?.tab || !entry?.pane) return;
            renderPluginTab(entry.tab, entry.pane);
          });
        };

        if (pluginTabs.length) {
          const pluginContext = buildPluginContext();
          for (const tab of pluginTabs) {
            if (!tab || typeof tab !== 'object') continue;
            const tabId = String(tab.id || tab.title || 'plugin').trim();
            if (!tabId) continue;
            if (typeof tab.shouldShow === 'function') {
              try {
                if (!tab.shouldShow(pluginContext)) continue;
              } catch {
                continue;
              }
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'qtiler-layer-modal__tab';
            button.textContent = String(tab.title || tabId);

            const pane = document.createElement('div');
            pane.className = 'qtiler-layer-modal__pane';
            pane.style.display = 'none';

            registerTab(tabId, button, pane);
            button.addEventListener('click', () => setActiveTab(tabId));

            renderPluginTab(tab, pane);
            pluginTabInstances.push({ tab, pane, id: tabId });
          }
        }

        // If admin, add editable fields section
        if (isAdmin) {
          const editSection = document.createElement('div');
          editSection.className = 'qtiler-layer-modal__edit';

          const editLabel = document.createElement('div');
          editLabel.className = 'meta';
          editLabel.textContent = 'Edit Configuration (Admin only)';
          editSection.appendChild(editLabel);

          const editDescription = document.createElement('div');
          editDescription.className = 'meta';
          editDescription.textContent = 'You may only edit extent and resolutions for this layer.';
          editSection.appendChild(editDescription);

          // try to load layer entry from cache index.json so edits apply to index.json
          let layerIndexEntry = null;
          try {
            const idxRes = await fetch(`/cache/${encodeURIComponent(projectId)}/index.json`, { credentials: 'include' });
            if (idxRes.ok) {
              const idxJson = await idxRes.json();
              if (idxJson && Array.isArray(idxJson.layers)) {
                layerIndexEntry = idxJson.layers.find(l => l && (l.name === (layerData.name || layerData.layer)) );
              }
            }
          } catch (e) { layerIndexEntry = null; }

          // Extent inputs (minX,minY,maxX,maxY)
          const extentLabel = document.createElement('div');
          extentLabel.className = 'meta';
          extentLabel.textContent = 'Extent [minX, minY, maxX, maxY]';
          editSection.appendChild(extentLabel);
          const extentRow = document.createElement('div');
          extentRow.style.display = 'flex';
          extentRow.style.gap = '8px';
          extentRow.style.marginTop = '8px';
          const extentInputs = [];
          for (let i = 0; i < 4; i++) {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.className = 'input-number';
            inp.style.flex = '1';
            extentInputs.push(inp);
            extentRow.appendChild(inp);
          }
          // prefill from index entry if available, otherwise from output.extent
          try {
            const earr = layerIndexEntry && Array.isArray(layerIndexEntry.extent) ? layerIndexEntry.extent : (Array.isArray(output.extent) ? output.extent : null);
            if (earr && earr.length === 4) {
              extentInputs[0].value = Number(earr[0]);
              extentInputs[1].value = Number(earr[1]);
              extentInputs[2].value = Number(earr[2]);
              extentInputs[3].value = Number(earr[3]);
            }
          } catch (e) {}
          editSection.appendChild(extentRow);

          // Resolutions input (JSON array or comma-separated)
          const resLabel = document.createElement('div');
          resLabel.className = 'meta';
          resLabel.style.marginTop = '12px';
          resLabel.textContent = 'Resolutions (JSON array or comma-separated list)';
          editSection.appendChild(resLabel);
          const resTextarea = document.createElement('textarea');
          resTextarea.className = 'qtiler-layer-modal__textarea';
          resTextarea.style.minHeight = '80px';
          let resInit = '';
          try {
            if (layerIndexEntry && Array.isArray(layerIndexEntry.resolutions)) resInit = JSON.stringify(layerIndexEntry.resolutions, null, 2);
            else if (Array.isArray(output.resolutions)) resInit = JSON.stringify(output.resolutions, null, 2);
          } catch (e) { resInit = ''; }
          resTextarea.value = resInit;
          editSection.appendChild(resTextarea);

          const configError = document.createElement('div');
          configError.className = 'qtiler-layer-modal__error';
          configError.textContent = '';
          editSection.appendChild(configError);

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'btn btn-primary';
          saveBtn.textContent = 'Save Configuration';
          saveBtn.style.marginTop = '12px';

          const parseResolutions = (txt) => {
            if (!txt || !txt.trim()) return null;
            try {
              const parsed = JSON.parse(txt);
              if (Array.isArray(parsed)) return parsed.map(Number);
            } catch (e) {
              // try comma-separated
              const parts = txt.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
              if (!parts.length) return null;
              return parts.map(Number);
            }
            return null;
          };

          // UI element to require purge confirmation when technical params change
          const purgeConfirmRow = document.createElement('label');
          purgeConfirmRow.style.display = 'flex';
          purgeConfirmRow.style.alignItems = 'center';
          purgeConfirmRow.style.gap = '8px';
          purgeConfirmRow.style.marginTop = '12px';
          const purgeCheckbox = document.createElement('input');
          purgeCheckbox.type = 'checkbox';
          purgeCheckbox.checked = false;
          purgeConfirmRow.appendChild(purgeCheckbox);
          const purgeText = document.createElement('span');
          purgeText.style.fontSize = '12px';
          purgeText.innerHTML = 'I understand changing resolutions or tile grid will purge existing cache for this layer';
          purgeConfirmRow.appendChild(purgeText);
          purgeConfirmRow.style.display = 'none';
          editSection.appendChild(purgeConfirmRow);

          const validateFields = () => {
            configError.textContent = '';
            // extent
            const ex = extentInputs.map(i => i.value === '' ? null : Number(i.value));
            if (ex.some(v => v == null || !Number.isFinite(v))) {
              configError.textContent = 'Extent requires four numeric values';
              saveBtn.disabled = true;
              return false;
            }
            if (!(ex[2] > ex[0] && ex[3] > ex[1])) {
              configError.textContent = 'Extent max must be greater than min';
              saveBtn.disabled = true;
              return false;
            }
            // resolutions
            const res = parseResolutions(resTextarea.value);
            if (res && (!Array.isArray(res) || res.some(r => !Number.isFinite(r)))) {
              configError.textContent = 'Resolutions must be an array of numbers';
              saveBtn.disabled = true;
              return false;
            }
            // enforce descending order (coarse -> fine)
            if (Array.isArray(res) && res.length > 1) {
              for (let i = 1; i < res.length; i++) {
                const prev = Number(res[i - 1]);
                const cur = Number(res[i]);
                if (!Number.isFinite(prev) || !Number.isFinite(cur) || !(cur < prev)) {
                  configError.textContent = 'Resolutions must be ordered from coarse to fine (descending numeric values).';
                  saveBtn.disabled = true;
                  return false;
                }
              }
            }
            // purge confirmation if resolutions changed compared to output
            const parsedRes = res || [];
            const outRes = Array.isArray(output.resolutions) ? output.resolutions : [];
            const resChanged = JSON.stringify(parsedRes) !== JSON.stringify(outRes);
            const extentChanged = JSON.stringify(ex) !== JSON.stringify(output.extent || []);
            const wantsPurge = resChanged || extentChanged;
            purgeConfirmRow.style.display = wantsPurge ? 'flex' : 'none';
            if (wantsPurge && !purgeCheckbox.checked) {
              configError.textContent = 'This edit changes technical parameters and will purge cached tiles for this layer — please confirm to proceed.';
              saveBtn.disabled = true;
              return false;
            }
            saveBtn.disabled = false;
            return true;
          };

          extentInputs.forEach(i => i.addEventListener('input', validateFields));
          resTextarea.addEventListener('input', validateFields);
          purgeCheckbox.addEventListener('change', validateFields);
          // initial validation
          validateFields();

          // fetch project config to validate extent boundaries and warn about purges
          let projectConfig = null;
          try {
            const cfgRes = await fetch(`/projects/${encodeURIComponent(projectId)}/config`, { credentials: 'include' });
            if (cfgRes.ok) projectConfig = await cfgRes.json();
          } catch (e) { projectConfig = null; }

          const inProjectExtent = (layerBbox) => {
            try {
              if (!projectConfig || !projectConfig.extent || !Array.isArray(projectConfig.extent.bbox) || projectConfig.extent.bbox.length !== 4) return true;
              if (!Array.isArray(layerBbox) || layerBbox.length !== 4) return false;
              const [pMinX, pMinY, pMaxX, pMaxY] = projectConfig.extent.bbox.map(Number);
              const [lMinX, lMinY, lMaxX, lMaxY] = layerBbox.map(Number);
              return lMinX >= pMinX && lMinY >= pMinY && lMaxX <= pMaxX && lMaxY <= pMaxY;
            } catch (e) { return false; }
          };

          

          

          saveBtn.addEventListener('click', async () => {
            try {
              // Defensive check: if auth is enabled require admin on client too
              if (window.appState && window.appState.authEnabled && !(window.appState.user && window.appState.user.role === 'admin')) {
                showStatus('Admin role required to save configuration', true);
                return;
              }

              if (!validateFields()) {
                throw new Error('Invalid input');
              }
              // assemble edited fields
              const exVals = extentInputs.map(i => Number(i.value));
              const resVals = parseResolutions(resTextarea.value) || null;
              const layerName = layerData.name || layerData.layer;
              console.log('Saving extent/resolutions to layer:', layerName);
              const editedData = { extent: exVals };
              if (resVals) editedData.resolutions = resVals;

              // Build the patch request with only extent and resolutions
              const patchData = { layers: { [layerName]: editedData } };

              console.log('Patch data:', patchData);

              // disable save while request is in-flight
              saveBtn.disabled = true;

              // Save configuration to cache index (index.json)
              let saveRes = await fetch(`/cache/${encodeURIComponent(projectId)}/index.json`, {
                method: 'PATCH',
                headers: { 
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(patchData)
              });
              if ([403, 404, 405, 501].includes(saveRes.status)) {
                saveRes = await fetch(`/cache/${encodeURIComponent(projectId)}/index.json`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                  },
                  credentials: 'include',
                  body: JSON.stringify(patchData)
                });
              }

              console.log('Save response status:', saveRes.status);

              if (!saveRes.ok) {
                const errorText = await saveRes.text();
                console.error('Save error response:', errorText);
                throw new Error(`Server error (${saveRes.status}): ${errorText}`);
              }

              const result = await saveRes.json();
              console.log('Save result:', result);
              // find saved layer entry in returned index
              const savedLayer = result && result.index && Array.isArray(result.index.layers)
                ? result.index.layers.find(l => l && l.name === layerName) || null
                : null;

              showStatus('Configuration saved successfully');
              try {
                const src = savedLayer || editedData || {};
                if (Array.isArray(src.extent) && src.extent.length === 4) {
                  extentInputs[0].value = Number(src.extent[0]);
                  extentInputs[1].value = Number(src.extent[1]);
                  extentInputs[2].value = Number(src.extent[2]);
                  extentInputs[3].value = Number(src.extent[3]);
                  output.extent = src.extent.slice();
                }
                if (Array.isArray(src.resolutions)) {
                  try { resTextarea.value = JSON.stringify(src.resolutions, null, 2); } catch { resTextarea.value = String(src.resolutions); }
                  output.resolutions = src.resolutions.slice();
                }
              } catch (e) { /* ignore */ }

              try {
                refreshPluginTabs();
              } catch {}

              // re-run validation to reflect updated content and enable save
              validateFields();

              // reload layers listing in background so UI reflects changes
              loadLayers({ forceConfigReload: true });

              // if server purged cache, show notice
              if (result && Array.isArray(result.purged) && result.purged.includes(layerName)) {
                showStatus('Cache purged for this layer due to technical parameter changes', false);
              }
            } catch (err) {
              console.error('Save failed:', err);
              showStatus('Failed to save: ' + String(err.message || err), true);
              // keep modal open on failure
              saveBtn.disabled = false;
            }
          });
          // add small note about purging
          const purgeNote = document.createElement('div');
          purgeNote.className = 'qtiler-layer-modal__meta';
          purgeNote.style.marginTop = '8px';
          purgeNote.textContent = 'Note: changing technical parameters may purge existing cache for this layer.';
          editSection.appendChild(purgeNote);
          editSection.appendChild(saveBtn);

          editPane.appendChild(editSection);
        } else {
          const editSection = document.createElement('div');
          editSection.className = 'qtiler-layer-modal__edit';
          const editLabel = document.createElement('div');
          editLabel.className = 'meta';
          editLabel.textContent = 'Edit parameters (Admin only)';
          editSection.appendChild(editLabel);
          const editDescription = document.createElement('div');
          editDescription.className = 'meta';
          editDescription.textContent = 'You need an admin account to edit technical parameters.';
          editSection.appendChild(editDescription);
          editPane.appendChild(editSection);
        }

        layerDetailsModal.appendChild(content);

        // Footer with buttons
        const footer = document.createElement('div');
        footer.style.padding = '16px 24px';
        footer.style.borderTop = '1px solid rgba(0, 0, 0, 0.1)';
        footer.style.display = 'flex';
        footer.style.gap = '12px';
        footer.style.justifyContent = 'flex-end';
        footer.style.background = '#f8f9fa';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = 'Copy to clipboard';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(outputText).then(() => {
            showStatus(tr('Copied to clipboard'));
          }).catch(err => {
            showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
          });
        });
        footer.appendChild(copyBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn btn-primary';
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', closeLayerDetailsModal);
        footer.appendChild(closeBtn);

        layerDetailsModal.appendChild(footer);

        // Show modal
        layerDetailsOverlay.style.display = 'flex';
        
        // ESC key to close
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            closeLayerDetailsModal();
            document.removeEventListener('keydown', escHandler);
          }
        };
        document.addEventListener('keydown', escHandler);
      }

      function openScheduleDialog({ projectId, targetType, targetName, configEntry }){
        if (!projectId || !targetType || !targetName) return;
        ensureScheduleDialogElements();
        const existingSchedule = cloneScheduleEntry(configEntry && configEntry.schedule ? configEntry.schedule : null) || {
          enabled: false,
          mode: 'weekly',
          weekly: { days: ['mon'], time: DEFAULT_SCHEDULE_TIME },
          monthly: { days: [1], time: DEFAULT_SCHEDULE_TIME },
          yearly: { occurrences: DEFAULT_YEARLY_OCCURRENCES.map((occ) => ({ ...occ })) },
          history: []
        };
        if (!existingSchedule.weekly || !Array.isArray(existingSchedule.weekly.days)) {
          existingSchedule.weekly = { days: ['mon'], time: DEFAULT_SCHEDULE_TIME };
        }
        if (!existingSchedule.monthly || !Array.isArray(existingSchedule.monthly.days)) {
          existingSchedule.monthly = { days: [1], time: DEFAULT_SCHEDULE_TIME };
        }
        if (!existingSchedule.yearly || !Array.isArray(existingSchedule.yearly.occurrences) || !existingSchedule.yearly.occurrences.length) {
          existingSchedule.yearly = { occurrences: DEFAULT_YEARLY_OCCURRENCES.map((occ) => ({ ...occ })) };
        }
        const configuredTargetZoom = targetType === 'layer'
          ? getLayerZoomRange(projectId, targetName)
          : getProjectZoomRange(projectId);

        scheduleDialogContainer.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = tr('Automatic cache schedule');
        scheduleDialogContainer.appendChild(heading);

        const subtitle = document.createElement('div');
        subtitle.className = 'meta';
  subtitle.textContent = (targetType === 'theme' ? tr('Theme: ') : tr('Layer: ')) + targetName;
        scheduleDialogContainer.appendChild(subtitle);

        const form = document.createElement('form');
        scheduleDialogContainer.appendChild(form);

        const zoomRow = document.createElement('div');
        zoomRow.className = 'schedule-zoom-row';
        zoomRow.style.display = 'flex';
        zoomRow.style.gap = '8px';
        zoomRow.style.marginTop = '12px';
        const zoomMinLabel = document.createElement('label');
        zoomMinLabel.style.display = 'flex';
        zoomMinLabel.style.flexDirection = 'column';
        zoomMinLabel.style.fontSize = '12px';
        zoomMinLabel.textContent = tr('Min zoom');
        const zoomMinInput = document.createElement('input');
        zoomMinInput.type = 'number';
        zoomMinInput.min = '0';
        zoomMinInput.max = String(MAX_ZOOM_LEVEL);
        zoomMinInput.step = '1';
        if (Number.isFinite(existingSchedule.zoomMin)) {
          zoomMinInput.value = String(existingSchedule.zoomMin);
        } else if (configuredTargetZoom?.min != null) {
          zoomMinInput.placeholder = String(configuredTargetZoom.min);
        }
        zoomMinLabel.appendChild(zoomMinInput);
        zoomRow.appendChild(zoomMinLabel);
        const zoomMaxLabel = document.createElement('label');
        zoomMaxLabel.style.display = 'flex';
        zoomMaxLabel.style.flexDirection = 'column';
        zoomMaxLabel.style.fontSize = '12px';
        zoomMaxLabel.textContent = tr('Max zoom');
        const zoomMaxInput = document.createElement('input');
        zoomMaxInput.type = 'number';
        zoomMaxInput.min = '0';
        zoomMaxInput.max = String(MAX_ZOOM_LEVEL);
        zoomMaxInput.step = '1';
        if (Number.isFinite(existingSchedule.zoomMax)) {
          zoomMaxInput.value = String(existingSchedule.zoomMax);
        } else if (configuredTargetZoom?.max != null) {
          zoomMaxInput.placeholder = String(configuredTargetZoom.max);
        }
        zoomMaxLabel.appendChild(zoomMaxInput);
        zoomRow.appendChild(zoomMaxLabel);
        form.appendChild(zoomRow);

        if (targetType === 'layer') {
          const targetMapHint = document.createElement('div');
          targetMapHint.className = 'meta';
          targetMapHint.style.marginTop = '8px';
          targetMapHint.textContent = tr('Automatic cache uses the extent saved in this layer map. Leave zoom empty to use that layer map zoom range.');
          form.appendChild(targetMapHint);
        }

        const enableRow = document.createElement('label');
        enableRow.style.display = 'flex';
        enableRow.style.alignItems = 'center';
        enableRow.style.gap = '8px';
        enableRow.style.marginTop = '12px';
        const enableCheckbox = document.createElement('input');
        enableCheckbox.type = 'checkbox';
        enableCheckbox.checked = existingSchedule.enabled === true;
        enableRow.appendChild(enableCheckbox);
        const enableText = document.createElement('span');
  enableText.textContent = tr('Enable automatic cache generation');
        enableRow.appendChild(enableText);
        form.appendChild(enableRow);

        const fieldset = document.createElement('fieldset');
        fieldset.disabled = !enableCheckbox.checked;
        fieldset.style.marginTop = '12px';
        form.appendChild(fieldset);

        const frequencyBox = document.createElement('div');
        frequencyBox.className = 'frequency-options';
        fieldset.appendChild(frequencyBox);

        const frequencyOptions = [
          { value: 'weekly', label: tr('Weekly'), description: tr('Run on selected weekdays at a fixed time.') },
          { value: 'monthly', label: tr('Monthly'), description: tr('Run on chosen days each month.') },
          { value: 'yearly', label: tr('3x per year'), description: tr('Run up to three specific dates per year.') }
        ];

        const currentMode = existingSchedule.mode || 'weekly';

        frequencyOptions.forEach((option) => {
          const optionLabel = document.createElement('label');
          optionLabel.style.display = 'flex';
          optionLabel.style.flexDirection = 'column';
          optionLabel.style.gap = '2px';

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '6px';

          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'schedule-frequency';
          radio.value = option.value;
          radio.checked = currentMode === option.value;
          row.appendChild(radio);
          row.appendChild(document.createTextNode(option.label));
          optionLabel.appendChild(row);
          if (option.description) {
            const hint = document.createElement('span');
            hint.className = 'meta';
            hint.style.fontSize = '12px';
            hint.textContent = option.description;
            optionLabel.appendChild(hint);
          }
          frequencyBox.appendChild(optionLabel);
        });

        const weeklySection = document.createElement('div');
        weeklySection.className = 'schedule-section';
        const weeklyTitle = document.createElement('div');
        weeklyTitle.style.fontWeight = '600';
  weeklyTitle.textContent = tr('Weekly options');
        weeklySection.appendChild(weeklyTitle);
        const weeklyDaysGrid = document.createElement('div');
        weeklyDaysGrid.className = 'day-grid';
        WEEKDAY_KEYS.forEach((key) => {
          const label = document.createElement('label');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = key;
          cb.checked = existingSchedule.weekly && Array.isArray(existingSchedule.weekly.days) && existingSchedule.weekly.days.includes(key);
          label.appendChild(cb);
          label.appendChild(document.createTextNode(WEEKDAY_LABELS[key] || key.toUpperCase()));
          weeklyDaysGrid.appendChild(label);
        });
        weeklySection.appendChild(weeklyDaysGrid);
        const weeklyTimeLabel = document.createElement('label');
        weeklyTimeLabel.style.display = 'flex';
        weeklyTimeLabel.style.flexDirection = 'column';
        weeklyTimeLabel.style.gap = '4px';
        weeklyTimeLabel.style.marginTop = '8px';
  weeklyTimeLabel.textContent = tr('Time (local)');
        const weeklyTimeInput = document.createElement('input');
        weeklyTimeInput.type = 'time';
        weeklyTimeInput.value = (existingSchedule.weekly && existingSchedule.weekly.time) || DEFAULT_SCHEDULE_TIME;
        weeklyTimeLabel.appendChild(weeklyTimeInput);
        weeklySection.appendChild(weeklyTimeLabel);

        const monthlySection = document.createElement('div');
        monthlySection.className = 'schedule-section';
        const monthlyDaysLabel = document.createElement('label');
        monthlyDaysLabel.style.display = 'flex';
        monthlyDaysLabel.style.flexDirection = 'column';
        monthlyDaysLabel.style.gap = '4px';
  monthlyDaysLabel.textContent = tr('Days of month (comma separated)');
        const monthlyDaysInput = document.createElement('input');
        monthlyDaysInput.type = 'text';
        monthlyDaysInput.placeholder = '1,15,30';
        monthlyDaysInput.value = (existingSchedule.monthly && Array.isArray(existingSchedule.monthly.days) && existingSchedule.monthly.days.length ? existingSchedule.monthly.days.join(',') : '1');
        monthlyDaysLabel.appendChild(monthlyDaysInput);
        monthlySection.appendChild(monthlyDaysLabel);
        const monthlyTimeLabel = document.createElement('label');
        monthlyTimeLabel.style.display = 'flex';
        monthlyTimeLabel.style.flexDirection = 'column';
        monthlyTimeLabel.style.gap = '4px';
        monthlyTimeLabel.style.marginTop = '8px';
  monthlyTimeLabel.textContent = tr('Time (local)');
        const monthlyTimeInput = document.createElement('input');
        monthlyTimeInput.type = 'time';
        monthlyTimeInput.value = (existingSchedule.monthly && existingSchedule.monthly.time) || DEFAULT_SCHEDULE_TIME;
        monthlyTimeLabel.appendChild(monthlyTimeInput);
        monthlySection.appendChild(monthlyTimeLabel);

        const yearlySection = document.createElement('div');
        yearlySection.className = 'schedule-section';
        const yearlyTitle = document.createElement('div');
        yearlyTitle.style.fontWeight = '600';
  yearlyTitle.textContent = tr('Yearly dates (up to 3)');
        yearlySection.appendChild(yearlyTitle);
        const yearlyGrid = document.createElement('div');
        yearlyGrid.className = 'yearly-grid';
        const yearlyOccurrences = existingSchedule.yearly && Array.isArray(existingSchedule.yearly.occurrences) && existingSchedule.yearly.occurrences.length
          ? existingSchedule.yearly.occurrences.slice(0, 3)
          : DEFAULT_YEARLY_OCCURRENCES.map((occ) => ({ ...occ }));
        while (yearlyOccurrences.length < 3) {
          yearlyOccurrences.push({ month: 1, day: 1, time: DEFAULT_SCHEDULE_TIME });
        }
        const yearlyRows = [];
        yearlyOccurrences.forEach((occ) => {
          const row = document.createElement('div');
          row.className = 'yearly-row';
          const monthSelect = document.createElement('select');
          MONTH_LABELS.forEach((label, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx + 1);
            opt.textContent = `${idx + 1} — ${label}`;
            if ((Number(occ.month) || 0) === idx + 1) opt.selected = true;
            monthSelect.appendChild(opt);
          });
          row.appendChild(monthSelect);
          const dayInput = document.createElement('input');
          dayInput.type = 'number';
          dayInput.min = '1';
          dayInput.max = '31';
          dayInput.value = Number(occ.day) ? String(Math.min(Math.max(1, Number(occ.day)), 31)) : '';
          row.appendChild(dayInput);
          const timeInput = document.createElement('input');
          timeInput.type = 'time';
          timeInput.value = occ.time || DEFAULT_SCHEDULE_TIME;
          row.appendChild(timeInput);
          yearlyGrid.appendChild(row);
          yearlyRows.push({ monthSelect, dayInput, timeInput });
        });
        yearlySection.appendChild(yearlyGrid);

        const sections = {
          weekly: weeklySection,
          monthly: monthlySection,
          yearly: yearlySection
        };

        Object.values(sections).forEach((section) => fieldset.appendChild(section));

        const updateSectionVisibility = (value) => {
          Object.entries(sections).forEach(([key, el]) => {
            el.style.display = key === value ? 'block' : 'none';
          });
        };
        updateSectionVisibility(currentMode);

        frequencyBox.querySelectorAll('input[name="schedule-frequency"]').forEach((radio) => {
          radio.addEventListener('change', () => updateSectionVisibility(radio.value));
        });

        enableCheckbox.addEventListener('change', () => {
          fieldset.disabled = !enableCheckbox.checked;
          zoomMinInput.disabled = !enableCheckbox.checked;
          zoomMaxInput.disabled = !enableCheckbox.checked;
        });

        const updateZoomDisabledState = () => {
          const disable = !enableCheckbox.checked;
          zoomMinInput.disabled = disable;
          zoomMaxInput.disabled = disable;
        };
        updateZoomDisabledState();

        const errorEl = document.createElement('div');
        errorEl.className = 'error';
        errorEl.style.marginTop = '12px';
        form.appendChild(errorEl);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = tr('Cancel');
        cancelBtn.addEventListener('click', () => closeScheduleDialog());
        actions.appendChild(cancelBtn);
        const saveBtn = document.createElement('button');
        saveBtn.type = 'submit';
        saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = tr('Save schedule');
        actions.appendChild(saveBtn);
        form.appendChild(actions);

        const handleDisableSchedule = () => {
          const disabledPayload = {
            enabled: false,
            mode: null,
            weekly: null,
            monthly: null,
            yearly: null,
            nextRunAt: null,
            lastRunAt: existingSchedule.lastRunAt || null,
            lastResult: existingSchedule.lastResult || null,
            lastMessage: existingSchedule.lastMessage || null,
            zoomMin: null,
            zoomMax: null,
            history: existingSchedule.history ? existingSchedule.history.slice(-5) : []
          };
          const patch = targetType === 'theme'
            ? { themes: { [targetName]: { schedule: disabledPayload } } }
            : { layers: { [targetName]: { schedule: disabledPayload } } };
          queueProjectConfigSave(projectId, patch, { immediate: true });
          showStatus(tr('Auto cache disabled for {name}', { name: targetName }));
          closeScheduleDialog();
          scheduleProjectRefresh(projectId, { delayMs: 500, forceConfigReload: true });
        };

        const handleSave = () => {
          errorEl.textContent = '';
          if (!enableCheckbox.checked) {
            handleDisableSchedule();
            return;
          }
          const selectedRadio = form.querySelector('input[name="schedule-frequency"]:checked');
          const mode = selectedRadio ? selectedRadio.value : 'weekly';
          const schedulePayload = {
            enabled: true,
            mode,
            weekly: null,
            monthly: null,
            yearly: null,
            nextRunAt: null,
            lastRunAt: null,
            lastResult: null,
            lastMessage: null,
            history: [],
            zoomMin: null,
            zoomMax: null
          };

        const minValue = zoomMinInput.value != null ? String(zoomMinInput.value).trim() : '';
        const maxValue = zoomMaxInput.value != null ? String(zoomMaxInput.value).trim() : '';
          const parseZoom = (value) => {
            if (!value) return null;
            const num = Number(value);
            if (!Number.isFinite(num)) return null;
            const rounded = Math.round(num);
            if (rounded < 0 || rounded > MAX_ZOOM_LEVEL) return null;
            return rounded;
          };
          const parsedMin = parseZoom(minValue);
          const parsedMax = parseZoom(maxValue);
          if (minValue && parsedMin == null) {
            errorEl.textContent = tr('Min zoom must be between 0 and {max}.', { max: MAX_ZOOM_LEVEL });
            return;
          }
          if (maxValue && parsedMax == null) {
            errorEl.textContent = tr('Max zoom must be between 0 and {max}.', { max: MAX_ZOOM_LEVEL });
            return;
          }
          if (parsedMin != null && parsedMax != null && parsedMin > parsedMax) {
            errorEl.textContent = tr('Min zoom cannot exceed max zoom.');
            return;
          }
          schedulePayload.zoomMin = parsedMin;
          schedulePayload.zoomMax = parsedMax;

          if (mode === 'weekly') {
            const selectedDays = [];
            weeklyDaysGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
              if (cb.checked) selectedDays.push(cb.value);
            });
            if (!selectedDays.length) {
              errorEl.textContent = tr('Select at least one weekday.');
              return;
            }
            const sortedDays = selectedDays.sort((a, b) => WEEKDAY_KEYS.indexOf(a) - WEEKDAY_KEYS.indexOf(b));
            const timeValue = weeklyTimeInput.value || DEFAULT_SCHEDULE_TIME;
            schedulePayload.weekly = { days: sortedDays, time: timeValue };
            schedulePayload.monthly = null;
            schedulePayload.yearly = null;
          } else if (mode === 'monthly') {
            const tokens = monthlyDaysInput.value.split(/[\s,]+/).filter(Boolean);
            const parsed = Array.from(new Set(tokens.map((token) => Number(token)))).filter((n) => Number.isInteger(n));
            if (!parsed.length) {
              errorEl.textContent = tr('Provide one or more day numbers between 1 and 31.');
              return;
            }
            const invalid = parsed.find((n) => n < 1 || n > 31);
            if (invalid != null) {
              errorEl.textContent = tr('Day values must be between 1 and 31.');
              return;
            }
            parsed.sort((a, b) => a - b);
            const timeValue = monthlyTimeInput.value || DEFAULT_SCHEDULE_TIME;
            schedulePayload.monthly = { days: parsed, time: timeValue };
            schedulePayload.weekly = null;
            schedulePayload.yearly = null;
          } else if (mode === 'yearly') {
            const occurrences = [];
            let invalidMessage = null;
            yearlyRows.forEach(({ monthSelect, dayInput, timeInput }) => {
              const monthVal = Number(monthSelect.value);
              const dayRaw = dayInput.value.trim();
              const timeVal = timeInput.value;
              if (!dayRaw && !timeVal) {
                return;
              }
              if (!monthVal || !dayRaw || !timeVal) {
                invalidMessage = tr('Complete month, day and time for yearly entries or leave them blank.');
                return;
              }
              const dayVal = Number(dayRaw);
              if (!Number.isInteger(dayVal) || dayVal < 1 || dayVal > 31) {
                invalidMessage = tr('Day values must be between 1 and 31.');
                return;
              }
              occurrences.push({ month: monthVal, day: dayVal, time: timeVal || DEFAULT_SCHEDULE_TIME });
            });
            if (invalidMessage) {
              errorEl.textContent = invalidMessage;
              return;
            }
            if (!occurrences.length) {
              errorEl.textContent = tr('Add at least one yearly date.');
              return;
            }
            schedulePayload.yearly = { occurrences: occurrences.slice(0, 3) };
            schedulePayload.weekly = null;
            schedulePayload.monthly = null;
          }

          const patch = targetType === 'theme'
            ? { themes: { [targetName]: { schedule: schedulePayload } } }
            : { layers: { [targetName]: { schedule: schedulePayload } } };

          saveBtn.disabled = true;
          queueProjectConfigSave(projectId, patch, { immediate: true });
          showStatus(tr('Schedule saved for {name}', { name: targetName }));
          closeScheduleDialog();
          scheduleProjectRefresh(projectId, { delayMs: 600, forceConfigReload: true });
        };

        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          handleSave();
        });

        scheduleDialogBackdrop.dataset.open = '1';
        scheduleDialogKeyHandler = (ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            closeScheduleDialog();
          }
        };
        document.addEventListener('keydown', scheduleDialogKeyHandler);
      }

      async function loadProjectConfig(projectId, { force = false } = {}) {
        if (!force && projectConfigs.has(projectId)) return projectConfigs.get(projectId);
        try {
          const res = await fetch('/projects/' + encodeURIComponent(projectId) + '/config');
          if (res.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return null;
          }
          if (!res.ok) throw new Error(res.statusText || 'config fetch failed');
          const cfg = await res.json();
          projectConfigs.set(projectId, cfg);
          return cfg;
        } catch (err) {
          console.warn('Failed to load project config', projectId, err);
          return null;
        }
      }

      function setActiveProject(projectId){
        if (!projectId) return;
        const wasActive = activeProjectId === projectId;
        activeProjectId = projectId;
        const state = getProjectState(projectId);
        const cfg = projectConfigs.get(projectId);
        suppressControlSync = true;
        try {
          // If the project is already active and the user edited controls, keep their inputs.
          const preserveUserInputs = wasActive && state && state.controlsEdited;
          if (cfg && !preserveUserInputs) {
            if (cfg.zoom) {
              if (zoomMinInput && cfg.zoom.min != null) zoomMinInput.value = Math.round(cfg.zoom.min);
              if (zoomMaxInput && cfg.zoom.max != null) zoomMaxInput.value = Math.round(cfg.zoom.max);
            }
            if (cfg.cachePreferences) {
              if (modeSelect && typeof cfg.cachePreferences.mode === 'string') modeSelect.value = cfg.cachePreferences.mode;
              if (tileCrsInput && typeof cfg.cachePreferences.tileCrs === 'string') tileCrsInput.value = cfg.cachePreferences.tileCrs;
              if (allowRemoteCheckbox && typeof cfg.cachePreferences.allowRemote === 'boolean') allowRemoteCheckbox.checked = cfg.cachePreferences.allowRemote;
              if (throttleInput && cfg.cachePreferences.throttleMs != null) throttleInput.value = cfg.cachePreferences.throttleMs;
            }
          }
          applyCachedZoomRangeToControls(projectId, { force: !preserveUserInputs });

          // Only clear the "user edited" flag when we actually re-hydrated controls from config.
          // If we preserved user inputs, keep it sticky so background refreshes don't overwrite them.
          if (state) {
            state.controlsEdited = !!preserveUserInputs;
          }
        } finally {
          suppressControlSync = false;
        }
        if (!state.defaultMapExtent && state.layerExtentUnion) {
          state.defaultMapExtent = state.layerExtentUnion.slice();
        }
        syncRemoteButtons();
      }

      function applyCachedZoomRangeToControls(projectId, { force = false } = {}){
        if (!projectId || projectId !== activeProjectId) return;
        const state = getProjectState(projectId);
        const projectZoom = getProjectZoomRange(projectId);
        if (projectZoom) {
          state.lastAppliedZoomRange = null;
          return;
        }
        const range = state?.cachedZoomRange || null;
        if (!range) {
          state.lastAppliedZoomRange = null;
          return;
        }
        const lastApplied = state.lastAppliedZoomRange || null;
        const matchesLast = lastApplied && lastApplied.min === range.min && lastApplied.max === range.max;
        if (!force && (state.controlsEdited || matchesLast)) {
          return;
        }
        suppressControlSync = true;
        try {
          if (zoomMinInput && range.min != null) zoomMinInput.value = Math.round(range.min);
          if (zoomMaxInput && range.max != null) zoomMaxInput.value = Math.round(range.max);
        } finally {
          suppressControlSync = false;
        }
        state.lastAppliedZoomRange = {
          min: range.min != null ? range.min : null,
          max: range.max != null ? range.max : null
        };
      }

      function mergeProjectConfig(projectId, patch){
        if (!patch || typeof patch !== 'object') return;
        const current = projectConfigs.get(projectId) || {};
        const merged = deepMergeObjects({ ...current }, patch);
        projectConfigs.set(projectId, merged);
        const state = getProjectState(projectId);
        if (state) {
          state.config = merged;
          hydrateStateExtentFromConfig(projectId, merged);
        }
        if (state && state.metaInfoEl) refreshProjectMetaInfo({ id: projectId }, null, merged);
      }

      async function flushProjectConfigSave(projectId){
        const patch = projectConfigPending.get(projectId);
        if (!patch) return;
        projectConfigPending.delete(projectId);
        projectConfigTimers.delete(projectId);
        try {
          let res = await fetch('/projects/' + encodeURIComponent(projectId) + '/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
          });
          if ([403, 404, 405, 501].includes(res.status)) {
            res = await fetch('/projects/' + encodeURIComponent(projectId) + '/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch)
            });
          }
          if (!res.ok) {
            const err = await res.json().catch(()=>null);
            throw new Error(err?.details || err?.error || res.statusText);
          }
          const updated = await res.json();
          projectConfigs.set(projectId, updated);
          const state = getProjectState(projectId);
          if (state) {
            state.config = updated;
            hydrateStateExtentFromConfig(projectId, updated);
            if (state.metaInfoEl) refreshProjectMetaInfo({ id: projectId }, null, updated);
          }
        } catch (err) {
          console.warn('Config sync failed for', projectId, err);
          showStatus(tr('Config save failed for {projectId}: {error}', { projectId, error: err }), true);
        }
      }

      function queueProjectConfigSave(projectId, patch, { immediate = false } = {}){
        if (!projectId || !patch || typeof patch !== 'object') return;
        mergeProjectConfig(projectId, patch);
        const pending = projectConfigPending.get(projectId) || {};
        projectConfigPending.set(projectId, deepMergeObjects(pending, patch));
        if (immediate) {
          flushProjectConfigSave(projectId);
          return;
        }
        const existingTimer = projectConfigTimers.get(projectId);
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(() => flushProjectConfigSave(projectId), 600);
        projectConfigTimers.set(projectId, timer);
      }

      // Origo auto-add removed.

      function setProjectBatchPolling(projectId, active){
        const state = getProjectState(projectId);
        if (!state) return;
        if (active) {
          if (state.batchPoller) return;
          state.batchPoller = setInterval(() => {
            refreshProjectBatchStatus(projectId);
          }, 4000);
        } else if (state.batchPoller) {
          clearInterval(state.batchPoller);
          state.batchPoller = null;
        }
      }

      function syncProjectBatchControls(projectId, current){
        const state = getProjectState(projectId);
        if (!state) return;
        const progressEl = state.batchProgressEl;
        const progressBarEl = state.batchProgressBarEl;
        const progressTextEl = state.batchProgressTextEl;
        const abortBtn = state.batchAbortBtn;
        if (!progressEl || !progressBarEl || !progressTextEl || !abortBtn) return;

        const isActive = !!(current && (current.status === 'running' || current.status === 'queued'));
        progressEl.style.display = isActive ? '' : 'none';
        abortBtn.style.display = isActive ? '' : 'none';

        if (!isActive) {
          progressBarEl.style.width = '0%';
          progressTextEl.textContent = '';
          abortBtn.disabled = false;
          abortBtn.textContent = tr('Abort');
          return;
        }

        const totalLayers = Array.isArray(current.layers)
          ? current.layers.length
          : (Number.isFinite(current.totalCount) ? current.totalCount : null);
        const completedLayers = Number.isFinite(current.completedCount) ? current.completedCount : 0;
        const hasActiveLayer = !!(current.currentLayer || Number.isFinite(current.currentIndex));
        let percent = 0;
        if (current.status === 'queued') {
          percent = 5;
        } else if (Number.isFinite(totalLayers) && totalLayers > 0) {
          const visualCompleted = Math.min(totalLayers, completedLayers + (hasActiveLayer ? 1 : 0));
          percent = Math.max(5, Math.min(99, (visualCompleted / totalLayers) * 100));
        } else {
          percent = 35;
        }
        progressBarEl.style.width = percent + '%';

        if (Number.isFinite(totalLayers) && totalLayers > 0) {
          progressTextEl.textContent = `${Math.min(totalLayers, completedLayers)}/${totalLayers}`;
        } else {
          progressTextEl.textContent = formatJobStatusLabel(current.status);
        }

        abortBtn.disabled = !!current.abortRequested;
        abortBtn.textContent = current.abortRequested ? tr('Aborting…') : tr('Abort');
      }

      function updateProjectBatchInfo(projectId, payload){
        const state = getProjectState(projectId);
        if (!state || !state.batchInfoEl) return;
        let current = payload?.current || null;
        const last = payload?.last || null;
        const terminalStatusMaxAgeMs = 2 * 60 * 1000;

        if (current && current.status && current.status !== 'running' && current.status !== 'queued') {
          const endedAt = Number(current.endedAt);
          const terminalAge = Number.isFinite(endedAt) ? (Date.now() - endedAt) : Number.POSITIVE_INFINITY;
          if (terminalAge > terminalStatusMaxAgeMs) {
            current = null;
          }
        }

        const lines = [];
        if (current) {
          const status = current.status || 'unknown';
          const startedLabel = current.startedAt ? formatDateTimeLocal(current.startedAt) : null;
          const totalLayers = Array.isArray(current.layers)
            ? current.layers.length
            : (Number.isFinite(current.totalCount) ? current.totalCount : (typeof current.layers === 'number' ? current.layers : null));
          if (status === 'running') {
            let runningLine = tr('Project cache running');
            if (totalLayers != null) runningLine += ` (${totalLayers})`;
            if (startedLabel) runningLine += ` · ${startedLabel}`;
            lines.push(runningLine);
            const idx = Number.isFinite(current.currentIndex) ? current.currentIndex : null;
            const activeLayer = current.currentLayer || (idx != null && Array.isArray(current.layers) && current.layers[idx] ? current.layers[idx] : null);
            if (activeLayer) {
              if (idx != null && totalLayers != null) {
                lines.push(tr('Working on {layer} ({current}/{total})', {
                  layer: activeLayer,
                  current: idx + 1,
                  total: totalLayers
                }));
              } else {
                lines.push(tr('Working on {layer}', { layer: activeLayer }));
              }
                const configuredLayerZoom = projectId && layerName ? getLayerZoomRange(projectId, layerName) : null;
            }
          } else if (status === 'queued') {
                const defaultMin = configuredLayerZoom?.min != null
                  ? configuredLayerZoom.min
                  : (rangeInfo.min != null ? rangeInfo.min : (controlMin != null ? controlMin : 0));
                let defaultMax = configuredLayerZoom?.max != null
                  ? configuredLayerZoom.max
                  : (rangeInfo.max != null ? rangeInfo.max : (controlMax != null ? controlMax : defaultMin));
            lines.push(tr('Project cache aborted.'));
          } else if (status === 'error') {
            lines.push(tr('Project cache error: {error}', { error: current.error || tr('Unknown') }));
          } else {
            lines.push(tr('Project cache status: {status}', { status: formatJobStatusLabel(status) }));
          }
          if (current.abortRequested) lines.push(tr('Project cache abort requested.'));
          const triggerToken = current.trigger || current.reason || null;
          const triggerLabel = formatTriggerLabel(triggerToken);
          if (triggerLabel) lines.push(tr('Trigger: {value}', { value: triggerLabel }));
        } else {
          lines.push(tr('Project cache idle'));
        }
        if (last?.lastRunAt) {
          const parsed = Date.parse(last.lastRunAt);
          const isParsed = !Number.isNaN(parsed);
          const ageMs = isParsed ? (Date.now() - parsed) : Number.POSITIVE_INFINITY;
          const keepErrorWindowMs = 15 * 60 * 1000;
          const lastResultToken = String(last.lastResult || 'unknown').toLowerCase();
          const shouldShowLast =
            lastResultToken === 'success'
            || current
            || (lastResultToken !== 'error')
            || ageMs <= keepErrorWindowMs;
          if (shouldShowLast) {
            const label = isParsed ? formatDateTimeLocal(parsed) : last.lastRunAt;
            const resultLabel = formatJobStatusLabel(last.lastResult || 'unknown');
            if (label) {
              lines.push(tr('Last result: {result} at {time}', { result: resultLabel, time: label }));
            } else {
              lines.push(tr('Last result: {result}', { result: resultLabel }));
            }
          }
        }
        state.batchInfoEl.textContent = lines.join(' · ');
        syncProjectBatchControls(projectId, current);
        const nextStatus = current ? current.status : null;
        if (state.batchButton) {
          state.batchButton.disabled = nextStatus === 'running' || nextStatus === 'queued';
        }
        const prevStatus = state.lastBatchStatus;
        state.lastBatchStatus = nextStatus;
        if (prevStatus === 'running' && nextStatus && nextStatus !== 'running' && nextStatus !== 'queued') {
          scheduleProjectRefresh(projectId, { delayMs: 800, forceConfigReload: true });
        }
      }

      async function refreshProjectBatchStatus(projectId){
        if (!projectId) return;
        if (projectBatchFetches.get(projectId)) return;
        projectBatchFetches.set(projectId, true);
        try {
          const res = await fetch('/projects/' + encodeURIComponent(projectId) + '/cache/project');
          if (res.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          if (!res.ok) {
            setProjectBatchPolling(projectId, false);
            const state = getProjectState(projectId);
            if (state?.batchInfoEl) state.batchInfoEl.textContent = tr('Project cache status unavailable');
            syncProjectBatchControls(projectId, null);
            return;
          }
          const data = await res.json().catch(() => null) || {};
          updateProjectBatchInfo(projectId, data);
          const active = data?.current?.status === 'running' || data?.current?.status === 'queued';
          setProjectBatchPolling(projectId, active);
        } catch (err) {
          console.warn('Project batch status fetch failed', projectId, err);
          setProjectBatchPolling(projectId, false);
          const state = getProjectState(projectId);
          if (state?.batchInfoEl) state.batchInfoEl.textContent = tr('Project cache status error');
          syncProjectBatchControls(projectId, null);
        } finally {
          projectBatchFetches.delete(projectId);
        }
      }

      function openProjectCacheDialog(project, layers) {
        return new Promise((resolve) => {
          if (!project?.id || !Array.isArray(layers) || layers.length === 0) {
            resolve(null);
            return;
          }

          enforceCacheControls();
          const projectZoom = getProjectZoomRange(project.id);
          const defaultMin = projectZoom ? projectZoom.min : Number.parseInt(zoomMinInput ? zoomMinInput.value : '0', 10);
          const defaultMax = projectZoom ? projectZoom.max : Number.parseInt(zoomMaxInput ? zoomMaxInput.value : '0', 10);
          const initialMin = Number.isFinite(defaultMin) ? Math.max(0, Math.min(MAX_ZOOM_LEVEL, defaultMin)) : 0;
          const initialMax = Number.isFinite(defaultMax) ? Math.max(0, Math.min(MAX_ZOOM_LEVEL, defaultMax)) : 0;

          const backdrop = document.createElement('div');
          backdrop.className = 'schedule-backdrop';
          backdrop.dataset.open = '1';

          const dialog = document.createElement('div');
          dialog.className = 'schedule-dialog';
          dialog.style.maxWidth = '720px';

          const title = document.createElement('h3');
          title.textContent = tr('Generate WMTS-Tiles for all layers');

          const subtitle = document.createElement('p');
          subtitle.className = 'dialog-description';
          subtitle.textContent = tr('Select layers and zoom range for project cache.');

          const zoomGrid = document.createElement('div');
          zoomGrid.style.display = 'grid';
          zoomGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
          zoomGrid.style.gap = '10px';

          const minWrap = document.createElement('label');
          minWrap.className = 'schedule-field';
          const minLabel = document.createElement('span');
          minLabel.textContent = tr('Min zoom:');
          const minInput = document.createElement('input');
          minInput.type = 'number';
          minInput.min = '0';
          minInput.max = String(MAX_ZOOM_LEVEL);
          minInput.value = String(initialMin);
          minWrap.append(minLabel, minInput);

          const maxWrap = document.createElement('label');
          maxWrap.className = 'schedule-field';
          const maxLabel = document.createElement('span');
          maxLabel.textContent = tr('Max zoom:');
          const maxInput = document.createElement('input');
          maxInput.type = 'number';
          maxInput.min = '0';
          maxInput.max = String(MAX_ZOOM_LEVEL);
          maxInput.value = String(initialMax);
          maxWrap.append(maxLabel, maxInput);

          zoomGrid.append(minWrap, maxWrap);

          const toolsRow = document.createElement('div');
          toolsRow.style.display = 'flex';
          toolsRow.style.gap = '8px';
          toolsRow.style.marginTop = '10px';
          toolsRow.style.flexWrap = 'wrap';

          const selectAllBtn = document.createElement('button');
          selectAllBtn.type = 'button';
          selectAllBtn.className = 'btn btn-secondary';
          selectAllBtn.textContent = tr('Select all layers');

          const clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.className = 'btn btn-secondary';
          clearBtn.textContent = tr('Clear selection');

          toolsRow.append(selectAllBtn, clearBtn);

          const listWrap = document.createElement('div');
          listWrap.style.maxHeight = '320px';
          listWrap.style.overflow = 'auto';
          listWrap.style.border = '1px solid var(--border)';
          listWrap.style.borderRadius = '10px';
          listWrap.style.padding = '8px';
          listWrap.style.marginTop = '8px';
          listWrap.style.background = 'var(--card)';

          const layerItems = [];
          layers.forEach((layer) => {
            if (!layer?.name) return;
            const row = document.createElement('label');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.gap = '10px';
            row.style.padding = '8px';
            row.style.borderBottom = '1px dashed var(--border)';

            const left = document.createElement('span');
            left.style.display = 'inline-flex';
            left.style.alignItems = 'center';
            left.style.gap = '8px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;

            const name = document.createElement('span');
            name.textContent = layer.name;

            left.append(checkbox, name);

            const right = document.createElement('span');
            right.style.fontSize = '12px';
            right.style.opacity = '0.8';
            right.textContent = layer.cacheable === false
              ? tr('Remote layer') + ` · z${initialMin}-${initialMax}`
              : `z${initialMin}-${initialMax}`;

            row.append(left, right);
            listWrap.appendChild(row);
            layerItems.push({ layer, checkbox, rangeEl: right });
          });

          const updateRangeLabels = () => {
            const minVal = Number.parseInt(minInput.value, 10);
            const maxVal = Number.parseInt(maxInput.value, 10);
            const min = Number.isFinite(minVal) ? minVal : 0;
            const max = Number.isFinite(maxVal) ? maxVal : 0;
            layerItems.forEach(({ layer, rangeEl }) => {
              rangeEl.textContent = layer.cacheable === false
                ? tr('Remote layer') + ` · z${min}-${max}`
                : `z${min}-${max}`;
            });
          };

          minInput.addEventListener('input', updateRangeLabels);
          maxInput.addEventListener('input', updateRangeLabels);

          selectAllBtn.addEventListener('click', () => {
            layerItems.forEach(item => { item.checkbox.checked = true; });
          });
          clearBtn.addEventListener('click', () => {
            layerItems.forEach(item => { item.checkbox.checked = false; });
          });

          const errorBox = document.createElement('div');
          errorBox.style.color = 'var(--danger, #b42318)';
          errorBox.style.fontSize = '13px';
          errorBox.style.minHeight = '18px';
          errorBox.style.marginTop = '8px';

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.justifyContent = 'flex-end';
          actions.style.gap = '10px';
          actions.style.marginTop = '14px';

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'btn btn-secondary';
          cancelBtn.textContent = tr('Cancel');

          const startBtn = document.createElement('button');
          startBtn.type = 'button';
          startBtn.className = 'btn btn-primary';
          startBtn.textContent = tr('Start cache generation');

          actions.append(cancelBtn, startBtn);

          dialog.append(title, subtitle, zoomGrid, toolsRow, listWrap, errorBox, actions);
          backdrop.appendChild(dialog);
          document.body.appendChild(backdrop);

          const cleanup = (value) => {
            try { document.removeEventListener('keydown', onKeyDown); } catch {}
            try { backdrop.remove(); } catch {}
            resolve(value || null);
          };

          const onKeyDown = (event) => {
            if (event.key === 'Escape') cleanup(null);
          };

          cancelBtn.addEventListener('click', () => cleanup(null));
          backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) cleanup(null);
          });
          document.addEventListener('keydown', onKeyDown);

          startBtn.addEventListener('click', () => {
            errorBox.textContent = '';
            const min = Number.parseInt(minInput.value, 10);
            const max = Number.parseInt(maxInput.value, 10);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > MAX_ZOOM_LEVEL || max > MAX_ZOOM_LEVEL) {
              errorBox.textContent = tr('Provide valid zoom numbers (0-30).');
              return;
            }
            if (min > max) {
              errorBox.textContent = tr('Min zoom must be less than or equal to max zoom.');
              return;
            }
            const selectedLayers = layerItems
              .filter(item => item.checkbox.checked)
              .map(item => item.layer)
              .filter(layer => layer?.name);
            if (!selectedLayers.length) {
              errorBox.textContent = tr('Select at least one layer.');
              return;
            }
            cleanup({ zoomMin: min, zoomMax: max, selectedLayers });
          });
        });
      }

      async function runProjectCacheFromDialog(project, layers, triggerBtn){
        if (!project?.id) return;
        if (!Array.isArray(layers) || layers.length === 0) {
          showStatus(tr('No layers available for this project'), true);
          return;
        }

        const selection = await openProjectCacheDialog(project, layers);
        if (!selection) return;

        const confirmedProjectRun = await confirmActionModal({
          title: tr('Project-wide recache confirmation title'),
          message: tr('Project-wide recache confirmation message'),
          confirmLabel: tr('Continue'),
          cancelLabel: tr('Cancel'),
          isDanger: true
        });
        if (!confirmedProjectRun) return;

        const { zoomMin, zoomMax, selectedLayers } = selection;
        const throttleVal = Math.max(300, parseInt(throttleInput ? throttleInput.value : '300', 10) || 300);
        const extentPayload = getProjectedExtentPayload(project.id);
        const payloadLayers = [];

        selectedLayers.forEach(layer => {
          const params = {
            project: project.id,
            layer: layer.name,
            zoom_min: zoomMin,
            zoom_max: zoomMax,
            scheme: 'auto',
            wmts: true,
            allow_remote: true,
            throttle_ms: throttleVal
          };
          if (extentPayload) {
            params.project_extent = extentPayload.extentString;
            params.extent_crs = extentPayload.crs;
          }
          payloadLayers.push({ layer: layer.name, params });
        });

        if (!payloadLayers.length) {
          showStatus(tr('No layers selected for cache generation.'), true);
          return;
        }

        const originalLabel = triggerBtn ? triggerBtn.innerHTML : null;
        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        }

        showStatus(tr('Starting project cache for {project} ({count} layers)…', {
          project: project.id,
          count: payloadLayers.length
        }));

        try {
          const res = await fetch('/projects/' + encodeURIComponent(project.id) + '/cache/project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layers: payloadLayers })
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            const detail = data?.message || data?.error || res.statusText;
            showStatus(tr('Project cache failed to start: {detail}', { detail }), true);
            return;
          }
          showStatus(tr('Project cache started (run {runId}).', { runId: data?.runId || 'unknown' }));
          refreshProjectBatchStatus(project.id);
        } catch (err) {
          showStatus(tr('Project cache error: {error}', { error: err }), true);
        } finally {
          if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = originalLabel != null ? originalLabel : ICONS.play;
          }
        }
      }

      const ICONS = {
  project: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 5A1.75 1.75 0 0 1 5.5 3.25h4.19c.46 0 .9.18 1.23.5l1.56 1.56c.33.32.77.5 1.23.5h6.29A1.75 1.75 0 0 1 21.5 7.5v10.75A2.75 2.75 0 0 1 18.75 21H5.25A2.75 2.75 0 0 1 2.5 18.25V5.75A.75.75 0 0 1 3.25 5h.5Zm.75 1.5v11.75c0 .69.56 1.25 1.25 1.25h13.5c.69 0 1.25-.56 1.25-1.25V8.5h-6.29c-.83 0-1.63-.33-2.22-.92L10.93 6H5.5a.75.75 0 0 0-.75.75Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.23 8.97a.75.75 0 0 1 1.06-.08L12 13.01l4.71-4.12a.75.75 0 0 1 .99 1.12l-5.2 4.55a.75.75 0 0 1-.99 0l-5.2-4.55a.75.75 0 0 1-.08-1.04Z"/></svg>',
        layer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 8.25 12 13.5 22 8.25 12 3Zm8.18 9.58L12 17.35 3.82 12.58 2 13.5l10 5.75 10-5.75-1.82-.92Zm0 4.5L12 21.85 3.82 17.08 2 18l10 5.75 10-5.75-1.82-.92Z"/></svg>',
        wmts: '<img src="/css/images/wmts-letters.svg" alt="WMTS" width="28" height="18" loading="lazy" />',
        wms: '<img src="/css/images/wms-letters.svg" alt="WMS" width="28" height="18" loading="lazy" />',
        wfs: '<img src="/css/images/wfs-letters.svg" alt="WFS" width="28" height="18" loading="lazy" />',
        tiles: '<img src="/css/images/xyz-letters.svg" alt="XYZ" width="28" height="18" loading="lazy" />',
        theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5h6a2 2 0 0 1 2 2v2.5h2.5a2 2 0 0 1 2 2v6a1.5 1.5 0 0 1-1.5 1.5h-6a2 2 0 0 1-2-2v-2.5H6.5a2 2 0 0 1-2-2v-6A1.5 1.5 0 0 1 5.5 5.5Zm.5 1.5v5.5a.5.5 0 0 0 .5.5H12V7.5a.5.5 0 0 0-.5-.5H6A.5.5 0 0 0 6 7Zm7 7v2.5a.5.5 0 0 0 .5.5h5.5a.5.5 0 0 0 .5-.5V12h-5.5a.5.5 0 0 0-.5.5Z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2.75a.75.75 0 0 1 1.5 0V4h7V2.75a.75.75 0 0 1 1.5 0V4h1.25A2.75 2.75 0 0 1 21 6.75v11.5A2.75 2.75 0 0 1 18.25 21H5.75A2.75 2.75 0 0 1 3 18.25V6.75A2.75 2.75 0 0 1 5.75 4H7V2.75ZM5.75 5.5A1.25 1.25 0 0 0 4.5 6.75v1.25h15V6.75A1.25 1.25 0 0 0 18.25 5.5H5.75Zm12.5 4.5h-15v8.25c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V10Z"/></svg>',
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.27a1 1 0 0 1 1.52-.85l9 5.73a1 1 0 0 1 0 1.7l-9 5.73a1 1 0 0 1-1.52-.85V5.27Z"/></svg>',
        download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.25 4a.75.75 0 0 1 1.5 0v8.19l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0l-3.75-3.75a.75.75 0 1 1 1.06-1.06l2.47 2.47V4ZM4.75 15a.75.75 0 0 1 .75.75v2.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-2.5a.75.75 0 0 1 1.5 0v2.5A2.75 2.75 0 0 1 17.25 21H6.75A2.75 2.75 0 0 1 4 18.25v-2.5A.75.75 0 0 1 4.75 15Z"/></svg>',
        trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a1 1 0 0 0-1 1v1H4.75a.75.75 0 0 0 0 1.5h.68l.76 11.24A2.75 2.75 0 0 0 8.93 20.5h6.14a2.75 2.75 0 0 0 2.74-2.76l.76-11.24h.68a.75.75 0 0 0 0-1.5H16V4a1 1 0 0 0-1-1H9Zm1 1.5h4V5H10V4.5Zm-1.82 3h7.64l-.74 11a1.25 1.25 0 0 1-1.24 1.2H8.7a1.25 1.25 0 0 1-1.24-1.2l-.74-11Z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.75 4A3.75 3.75 0 0 0 6 7.75v8.5A3.75 3.75 0 0 0 9.75 20h8.5A3.75 3.75 0 0 0 22 16.25v-8.5A3.75 3.75 0 0 0 18.25 4h-8.5Zm0 1.5h8.5A2.25 2.25 0 0 1 20.5 7.75v8.5a2.25 2.25 0 0 1-2.25 2.25h-8.5A2.25 2.25 0 0 1 7.5 16.25v-8.5A2.25 2.25 0 0 1 9.75 5.5ZM4.75 7A.75.75 0 0 1 5.5 7.75v9a.75.75 0 0 1-1.5 0v-9A.75.75 0 0 1 4.75 7Z"/></svg>',
        eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.97 0 9.15 3.16 10.63 7.5C21.15 16.84 16.96 20 12 20s-9.15-3.16-10.63-7.5C2.85 8.16 7.04 5 12 5Zm0 1.5c-4.09 0-7.68 2.5-9.04 6 1.36 3.5 4.95 6 9.04 6 4.09 0 7.68-2.5 9.04-6-1.36-3.5-4.95-6-9.04-6Zm0 2.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>',
        map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 15 2l6 2.5v16L15 22l-6-2.5L3 22V6l6-1.5Zm0 1.6L4.5 7.3v12.2L9 18.4V6.1Zm1.5 0V18.4l4.5 1.9V7.9l-4.5-1.8Zm6 1.8v12.3l4.5-1.9V6.1l-4.5 1.8Z"/></svg>',
        link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.06 5.53a3.75 3.75 0 0 1 5.3-.02l.13.13a3.75 3.75 0 0 1 0 5.3l-1.84 1.84a.75.75 0 0 1-1.06-1.06l1.84-1.84a2.25 2.25 0 0 0 0-3.18l-.13-.13a2.25 2.25 0 0 0-3.18 0l-1.84 1.84a.75.75 0 1 1-1.06-1.06l1.84-1.84Zm-6.25 6.23a.75.75 0 0 1 1.06 1.06l-1.84 1.84a2.25 2.25 0 0 0 0 3.18l.13.13a2.25 2.25 0 0 0 3.18 0l1.84-1.84a.75.75 0 0 1 1.06 1.06l-1.84 1.84a3.75 3.75 0 0 1-5.3 0l-.13-.13a3.75 3.75 0 0 1 0-5.3l1.84-1.84Zm6.59-4.13a.75.75 0 0 1 0 1.06l-5.02 5.02a.75.75 0 0 1-1.06-1.06l5.02-5.02a.75.75 0 0 1 1.06 0Z"/></svg>'
        ,
        info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 7a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75ZM12 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>'
        ,
        refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 4a.75.75 0 0 1 .75.75v2.19A7.25 7.25 0 0 1 20.02 12a.75.75 0 0 1-1.5 0 5.75 5.75 0 1 0-10.95-2h2.18a.75.75 0 0 1 .53 1.28l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5A.75.75 0 0 1 2.75 11h2.18a7.25 7.25 0 0 1 13.57-3.56V4.75a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h2.19A5.75 5.75 0 1 0 3.5 12a.75.75 0 0 1-1.5 0A7.25 7.25 0 0 1 5.5 6.94V4.75a.75.75 0 0 1 .75-.75Z"/></svg>'
        ,
        reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.25a8.75 8.75 0 1 1-7.92 5.04.75.75 0 0 1 1.36.63A7.25 7.25 0 1 0 12 4.75c-2.1 0-4.08.89-5.45 2.43H9a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 7.93V3.75a.75.75 0 0 1 1.5 0v2.12A8.72 8.72 0 0 1 12 3.25Z"/></svg>'
        ,
        cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a5 5 0 0 1-.24-10A6.01 6.01 0 0 1 12.76 6 4.75 4.75 0 0 1 19 10.5a4 4 0 0 1-.18 8.5H7Zm0-1.5h11.82a2.5 2.5 0 0 0 .19-5c-.38 0-.75.04-1.1.12a.75.75 0 0 1-.9-.54A4.5 4.5 0 0 0 12.76 7.5c-1.7 0-3.2.95-4 2.37a.75.75 0 0 1-.7.39H8a3.5 3.5 0 0 0-.17 7Z"/></svg>'
      };

      function ensureLeafletReady(){
        if (typeof L !== 'undefined' && L.Control && L.Control.Draw) return Promise.resolve();
        if (leafletReadyPromise) return leafletReadyPromise;
        leafletReadyPromise = new Promise((resolve, reject) => {
          const fail = (err) => {
            leafletReadyPromise = null;
            reject(err || new Error('Failed to load Leaflet'));
          };
          const loadDraw = () => {
            if (typeof L !== 'undefined' && L.Control && L.Control.Draw) {
              resolve();
              return;
            }
            const drawCss = document.createElement('link');
            drawCss.rel = 'stylesheet';
            drawCss.href = 'https://cdn.jsdelivr.net/npm/leaflet-draw@1.0.4/dist/leaflet.draw.css';
            document.head.appendChild(drawCss);
            const drawJs = document.createElement('script');
            drawJs.src = 'https://cdn.jsdelivr.net/npm/leaflet-draw@1.0.4/dist/leaflet.draw.js';
            drawJs.onload = () => resolve();
            drawJs.onerror = fail;
            document.head.appendChild(drawJs);
          };
          if (typeof L !== 'undefined') {
            loadDraw();
            return;
          }
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
          script.onload = loadDraw;
          script.onerror = fail;
          document.head.appendChild(script);
        });
        return leafletReadyPromise;
      }

      function getProjectState(projectId){
        if (!extentStates.has(projectId)) {
          const storedCollapse = getStoredCollapse(projectId);
          extentStates.set(projectId, {
            extent: null,
            extentNative: null,
            extentNativeCrs: null,
            open: false,
            map: null,
            metaInfoEl: null,
            config: null,
            projectMeta: null,
            batchInfoEl: null,
            batchPoller: null,
            batchButton: null,
            batchProgressEl: null,
            batchProgressBarEl: null,
            batchProgressTextEl: null,
            batchAbortBtn: null,
            lastBatchStatus: null,
            cachedZoomRange: null,
            lastAppliedZoomRange: null,
            controlsEdited: false,
            layerExtents: new Map(),
            themeExtents: new Map(),
            layerExtentUnion: null,
            layerExtentPanels: new Map(),
            focusLayerGroup: null,
            lastFocusKey: null,
            pendingMapFocus: null,
            mapHolder: null,
            mapResizeObserver: null,
            mapVisibilityObserver: null,
            mapResizeTimer: null,
            defaultMapExtent: null,
            projectViewExtent: null,
            collapsed: storedCollapse != null ? !!storedCollapse : false
          });
        }
        return extentStates.get(projectId);
      }

      function findProjectWrap(projectId){
        if (!projectId) return null;
        const nodes = document.querySelectorAll('[data-project-id]');
        for (const node of nodes) {
          if (node?.dataset?.projectId === projectId) return node;
        }
        return null;
      }

      function setProjectCollapsed(projectId, collapsed, options = {}) {
        const { store = true, silent = false, element = null } = options;
        const wrap = element || findProjectWrap(projectId);
        const state = getProjectState(projectId);
        const isCollapsed = !!collapsed;
        state.collapsed = isCollapsed;
        if (wrap) {
          wrap.classList.toggle('is-collapsed', isCollapsed);
          wrap.dataset.collapsed = isCollapsed ? '1' : '0';
          const toggleBtn = wrap.querySelector('.project-toggle');
          if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            toggleBtn.classList.toggle('is-open', !isCollapsed);
          }
        }
        if (store) {
          setStoredCollapse(projectId, isCollapsed);
        }
        if (!isCollapsed && !silent) {
          setActiveProject(projectId);
        }
      }

      const toDomId = (value) => {
        const token = String(value || 'project');
        const sanitized = token.replace(/[^a-zA-Z0-9_-]+/g, '-');
        return sanitized || 'project';
      };

      function refreshProjectMetaInfo(project, projectMeta, projectConfig){
        const projectId = project && project.id ? project.id : project;
        const state = getProjectState(projectId);
        if (!state.metaInfoEl) return;
        const parts = [];
        parts.push('Project settings');
        const cfg = projectConfig || state.config || projectConfigs.get(projectId);
        if (cfg && cfg.zoom) {
          const zMin = cfg.zoom.min != null ? cfg.zoom.min : 'auto';
          const zMax = cfg.zoom.max != null ? cfg.zoom.max : 'auto';
          parts.push('Zoom ' + zMin + '–' + zMax);
        }
        if (cfg) {
          const layersWithSchedule = Object.values(cfg.layers || {}).filter(entry => entry && entry.schedule && entry.schedule.enabled).length;
          const themesWithSchedule = Object.values(cfg.themes || {}).filter(entry => entry && entry.schedule && entry.schedule.enabled).length;
          if (layersWithSchedule || themesWithSchedule) {
            const bits = [];
            if (layersWithSchedule) bits.push(layersWithSchedule + ' layer' + (layersWithSchedule === 1 ? '' : 's'));
            if (themesWithSchedule) bits.push(themesWithSchedule + ' theme' + (themesWithSchedule === 1 ? '' : 's'));
            parts.push('Auto cache: ' + bits.join(', '));
          }
        }
        state.metaInfoEl.textContent = parts.join(' · ');
      }

      function makeIconButton(label, iconName, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-icon' + (extraClass ? ' ' + extraClass : '');
        btn.innerHTML = ICONS[iconName] || '';
        btn.dataset.iconHtml = ICONS[iconName] || '';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        if (typeof onClick === 'function') {
          btn.addEventListener('click', onClick);
        }
        return btn;
      }

      function makeLabeledIconButton(label, iconName, text, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary layer-action-labeled' + (extraClass ? ' ' + extraClass : '');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.innerHTML =
          `<span class="layer-action-labeled__icon" aria-hidden="true">${ICONS[iconName] || ''}</span>` +
          `<span class="layer-action-labeled__text">${escapeHtml(text)}</span>`;
        if (typeof onClick === 'function') {
          btn.addEventListener('click', onClick);
        }
        return btn;
      }

      function toBoundsWgs84(extent){
        if (!Array.isArray(extent) || extent.length !== 4) return null;
        const [minLon, minLat, maxLon, maxLat] = extent;
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const a = [clamp(minLat, -85, 85), clamp(minLon, -180, 180)];
        const b = [clamp(maxLat, -85, 85), clamp(maxLon, -180, 180)];
        const lat1 = Math.min(a[0], b[0]);
        const lat2 = Math.max(a[0], b[0]);
        const lon1 = Math.min(a[1], b[1]);
        const lon2 = Math.max(a[1], b[1]);
        return [[lat1, lon1], [lat2, lon2]];
      }

      const normalizeExtentList = (extent) => {
        if (!Array.isArray(extent) || extent.length !== 4) return null;
        const nums = extent.map((value) => Number(value));
        if (nums.some((value) => !Number.isFinite(value))) return null;
        const [minLon, minLat, maxLon, maxLat] = nums;
        if (maxLon < minLon || maxLat < minLat) return null;
        if (minLon === maxLon || minLat === maxLat) return null;
        return [minLon, minLat, maxLon, maxLat];
      };

      const combineExtentLists = (current, next) => {
        const normNext = normalizeExtentList(next);
        if (!normNext) return current ? current.slice() : null;
        if (!current) return normNext.slice();
        const [curMinLon, curMinLat, curMaxLon, curMaxLat] = current;
        const [minLon, minLat, maxLon, maxLat] = normNext;
        return [
          Math.min(curMinLon, minLon),
          Math.min(curMinLat, minLat),
          Math.max(curMaxLon, maxLon),
          Math.max(curMaxLat, maxLat)
        ];
      };

      const parseProj4PresetsDataset = () => {
        const encoded = document.body?.dataset?.proj4Presets;
        if (!encoded) return {};
        try {
          return JSON.parse(decodeURIComponent(encoded));
        } catch (err) {
          console.warn('Failed to parse proj4 presets payload', err);
          return {};
        }
      };

      const PROJ4_PRESETS = Object.freeze(parseProj4PresetsDataset());

      const canUseProj4 = () => (typeof proj4 === 'function' && typeof proj4.defs === 'function');

      const ensureProj4Definition = (code) => {
        if (!canUseProj4()) return false;
        if (!code || typeof code !== 'string') return false;
        const key = code.trim();
        if (!key) return false;
        if (proj4.defs(key)) return true;
        const upper = key.toUpperCase();
        if (proj4.defs(upper)) {
          if (upper !== key) proj4.defs(key, proj4.defs(upper));
          return true;
        }
        const preset = PROJ4_PRESETS[upper];
        if (preset) {
          proj4.defs(upper, preset);
          if (upper !== key) proj4.defs(key, proj4.defs(upper));
          return true;
        }
        // no client-side preset - we can try asking server to provide it (fire-and-forget)
        try {
          (async () => {
            try {
              const resp = await fetch('/api/proj4/' + encodeURIComponent(upper));
              if (!resp.ok) return;
              const data = await resp.json().catch(() => null);
              if (!data || !data.def) return;
              if (typeof proj4 === 'function' && typeof proj4.defs === 'function') {
                proj4.defs(upper, data.def);
                if (upper !== key) proj4.defs(key, data.def);
              }
            } catch (err) {}
          })();
        } catch (err) {}
        return false;
      };

      const normalizeEpsgKey = (code) => {
        if (!code) return null;
        const s = String(code).trim();
        if (!s) return null;
        const m = s.match(/(\d+)$/);
        const n = m ? m[1] : s;
        return `EPSG:${n}`.toUpperCase();
      };

      // Some projected CRS (notably EPSG:3006) are commonly stored or exchanged as northing/easting
      // (minY,minX,maxY,maxX). When that happens, proj4 transforms can yield NaN.
      const AXIS_SWAP_EPSG = new Set(['EPSG:3006', 'EPSG:3010', 'EPSG:3011']);

      const looksLikeAxisSwappedProjectedBbox = (bbox) => {
        if (!Array.isArray(bbox) || bbox.length !== 4) return false;
        const nums = bbox.map((v) => Math.abs(Number(v)));
        if (nums.some((v) => !Number.isFinite(v))) return false;
        const [a, b, c, d] = nums;
        // Heuristic: northing is usually millions; easting is usually < ~2M.
        return (a > 2000000 && c > 2000000 && b < 2000000 && d < 2000000);
      };

      const normalizeAxisOrderForCrs = (extentList, crs) => {
        const norm = normalizeExtentList(extentList);
        if (!norm) return null;
        const key = normalizeEpsgKey(crs) || (typeof crs === 'string' ? crs.trim().toUpperCase() : null);
        if (!key || !AXIS_SWAP_EPSG.has(key)) return norm;
        // If bbox is likely [minY,minX,maxY,maxX], convert to [minX,minY,maxX,maxY].
        if (looksLikeAxisSwappedProjectedBbox(norm)) {
          return [norm[1], norm[0], norm[3], norm[2]];
        }
        return norm;
      };

      const ensureProj4CodesAvailable = async (codes = [], timeoutMs = 700) => {
        if (!Array.isArray(codes) || codes.length === 0) return;
        const missing = codes.map(normalizeEpsgKey).filter(Boolean).filter((c) => !proj4.defs || !proj4.defs(c));
        if (missing.length === 0) return;
        // request server to fetch defs
        const promises = missing.map((c) => fetch('/api/proj4/' + encodeURIComponent(c)).catch(() => null));
        // wait for first responses but keep overall timeout
        const results = await Promise.all(promises.map(p => Promise.race([p, new Promise(r => setTimeout(() => r(null), timeoutMs))])));
        for (const r of results) {
          try {
            if (!r || !r.ok) continue;
            const data = await r.json().catch(() => null);
            if (!data || !data.def) continue;
            if (typeof proj4 === 'function' && typeof proj4.defs === 'function') {
              const key = normalizeEpsgKey(data.code || '');
              if (key) proj4.defs(key, data.def);
            }
          } catch (err) {}
        }
        // small wait until defs are registered (or timeout)
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const stillMissing = codes.map(normalizeEpsgKey).filter(Boolean).filter((c) => !proj4.defs || !proj4.defs(c));
          if (stillMissing.length === 0) return;
          // sleep a bit
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 80));
        }
      };

      const getProjectTargetCrs = (projectId) => {
        const state = getProjectState(projectId);
        if (!state) return null;
        const projectMetaCrs = state?.projectMeta?.crs || null;
        const cfgTile = state && state.config && state.config.cachePreferences && state.config.cachePreferences.tileCrs ? state.config.cachePreferences.tileCrs : null;
        return projectMetaCrs || cfgTile || null;
      };

      const transformExtentBetweenCrs = (extentList, sourceCrs, targetCrs) => {
        const norm = normalizeExtentList(extentList);
        if (!norm) return null;
        const source = (typeof sourceCrs === 'string' && sourceCrs.trim()) ? sourceCrs.trim() : 'EPSG:4326';
        const target = (typeof targetCrs === 'string' && targetCrs.trim()) ? targetCrs.trim() : 'EPSG:4326';
        if (source.toUpperCase() === target.toUpperCase()) {
          return { bbox: norm.slice(), crs: target, transformed: false };
        }

        const isLikelyWgs84Bbox = (bbox) => {
          if (!Array.isArray(bbox) || bbox.length !== 4) return false;
          const [minX, minY, maxX, maxY] = bbox.map(Number);
          if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
          return (
            minX >= -180 && maxX <= 180 &&
            minY >= -90 && maxY <= 90 &&
            maxX > minX && maxY > minY
          );
        };

        // Defensive: configs sometimes label extents as projected CRS but bbox is actually lon/lat degrees.
        // If the target is EPSG:4326 and the bbox already looks like lon/lat, don't attempt a proj4 transform.
        if (target.toUpperCase() === 'EPSG:4326' && isLikelyWgs84Bbox(norm) && source.toUpperCase() !== 'EPSG:4326') {
          return { bbox: norm.slice(), crs: 'EPSG:4326', transformed: true, assumedSource: 'EPSG:4326' };
        }
        if (!canUseProj4()) {
          console.warn('proj4 not available; cannot transform extent from', source, 'to', target);
          return null;
        }
        if (!ensureProj4Definition(source) || !ensureProj4Definition(target)) {
          console.warn('Missing proj4 definition for extent transform', source, target);
          return null;
        }
        try {
          const fixed = normalizeAxisOrderForCrs(norm, source);
          if (!fixed) return null;
          const tryProject = (swapXY) => {
            const corners = [
              [fixed[0], fixed[1]],
              [fixed[0], fixed[3]],
              [fixed[2], fixed[1]],
              [fixed[2], fixed[3]]
            ];
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const corner of corners) {
              const inX = swapXY ? corner[1] : corner[0];
              const inY = swapXY ? corner[0] : corner[1];
              const projected = proj4(source, target, [inX, inY]);
              const px = Array.isArray(projected) ? projected[0] : Number.NaN;
              const py = Array.isArray(projected) ? projected[1] : Number.NaN;
              if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
              minX = Math.min(minX, px);
              minY = Math.min(minY, py);
              maxX = Math.max(maxX, px);
              maxY = Math.max(maxY, py);
            }
            if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
            if (maxX <= minX || maxY <= minY) return null;
            return { bbox: [minX, minY, maxX, maxY], crs: target, transformed: true, swapXY: !!swapXY };
          };

          const primary = tryProject(false);
          if (primary) return primary;
          const swapped = tryProject(true);
          if (swapped) return swapped;
          return null;
        } catch (err) {
          console.warn('Failed to transform extent from', source, 'to', target, err?.message || String(err));
          return null;
        }
      };

      const transformExtentToProjectCrs = (extentList, projectCrs) => {
        return transformExtentBetweenCrs(extentList, 'EPSG:4326', projectCrs);
      };

      const transformExtentFromProjectCrs = (extentList, sourceCrs) => {
        return transformExtentBetweenCrs(extentList, sourceCrs, 'EPSG:4326');
      };

      function hydrateStateExtentFromConfig(projectId, overrideConfig){
        const state = getProjectState(projectId);
        if (!state) return { wgsExtent: null };
        const projectConfig = overrideConfig || state.config || projectConfigs.get(projectId) || null;
        let wgsExtent = null;
        let nativeExtent = null;
        let nativeCrs = null;
        if (projectConfig) {
          if (projectConfig.extent && Array.isArray(projectConfig.extent.bbox)) {
            const normalizedNative = normalizeExtentList(projectConfig.extent.bbox);
            if (normalizedNative) {
              nativeCrs = typeof projectConfig.extent.crs === 'string' ? projectConfig.extent.crs : null;
              const cfgTileCrs = (projectConfig && projectConfig.cachePreferences && projectConfig.cachePreferences.tileCrs) || null;
              const cfgTileCrsSafe = (typeof cfgTileCrs === 'string' && cfgTileCrs.trim() && cfgTileCrs.trim().toUpperCase() !== 'AUTO') ? cfgTileCrs.trim() : null;
              const sourceCrs = nativeCrs || state.projectMeta?.crs || cfgTileCrsSafe || null;
              const axisFixed = normalizeAxisOrderForCrs(normalizedNative, sourceCrs);
              nativeExtent = (axisFixed || normalizedNative).slice();
              const transformed = transformExtentFromProjectCrs(nativeExtent, sourceCrs);
              if (transformed && Array.isArray(transformed.bbox)) {
                wgsExtent = transformed.bbox.slice();
              }
            }
          }
          const wgsEntry = projectConfig.extentWgs84 || projectConfig.extent_wgs84;
          if (!wgsExtent && wgsEntry && Array.isArray(wgsEntry.bbox)) {
            const normalizedWgs = normalizeExtentList(wgsEntry.bbox);
            if (normalizedWgs) {
              wgsExtent = normalizedWgs.slice();
            }
          }
        }
        state.extentNative = nativeExtent ? nativeExtent.slice() : null;
        {
          const cfgTileCrs2 = (projectConfig && projectConfig.cachePreferences && projectConfig.cachePreferences.tileCrs) || null;
          const cfgTileCrsSafe2 = (typeof cfgTileCrs2 === 'string' && cfgTileCrs2.trim() && cfgTileCrs2.trim().toUpperCase() !== 'AUTO') ? cfgTileCrs2.trim() : null;
          state.extentNativeCrs = nativeCrs || state.projectMeta?.crs || cfgTileCrsSafe2 || null;
        }
        if (!state.extentNative && wgsExtent) {
          const cfgTileCrs3 = (projectConfig && projectConfig.cachePreferences && projectConfig.cachePreferences.tileCrs) || null;
          const cfgTileCrsSafe3 = (typeof cfgTileCrs3 === 'string' && cfgTileCrs3.trim() && cfgTileCrs3.trim().toUpperCase() !== 'AUTO') ? cfgTileCrs3.trim() : null;
          const fallbackNative = transformExtentToProjectCrs(wgsExtent, state.projectMeta?.crs || cfgTileCrsSafe3 || null);
          if (fallbackNative && Array.isArray(fallbackNative.bbox)) {
            state.extentNative = fallbackNative.bbox.slice();
            state.extentNativeCrs = fallbackNative.crs || state.projectMeta?.crs || cfgTileCrsSafe3 || null;
          }
        }
        state.extent = wgsExtent ? wgsExtent.slice() : null;
        if (state.extent && !state.extentNative) {
          const cfgTileCrs4 = (projectConfig && projectConfig.cachePreferences && projectConfig.cachePreferences.tileCrs) || null;
          const cfgTileCrsSafe4 = (typeof cfgTileCrs4 === 'string' && cfgTileCrs4.trim() && cfgTileCrs4.trim().toUpperCase() !== 'AUTO') ? cfgTileCrs4.trim() : null;
          const derivedNative = transformExtentToProjectCrs(state.extent, state.projectMeta?.crs || cfgTileCrsSafe4 || null);
          if (derivedNative && Array.isArray(derivedNative.bbox)) {
            state.extentNative = derivedNative.bbox.slice();
            state.extentNativeCrs = derivedNative.crs || state.projectMeta?.crs || cfgTileCrsSafe4 || null;
          }
        }
        return { wgsExtent: state.extent ? state.extent.slice() : null };
      }

      const buildExtentPatch = (projectId, extentList) => {
        const nowIso = new Date().toISOString();
        const state = getProjectState(projectId);
        const projectCrs = state?.extentNativeCrs || state?.projectMeta?.crs || (state && state.config && state.config.cachePreferences && state.config.cachePreferences.tileCrs) || null;
        if (!Array.isArray(extentList) || extentList.length !== 4) {
          state.extent = null;
          state.extentNative = null;
          state.extentNativeCrs = projectCrs || state?.projectMeta?.crs || null;
          return {
            extent: { bbox: null, crs: projectCrs || 'EPSG:4326', updatedAt: nowIso },
            extentWgs84: { bbox: null, crs: 'EPSG:4326', updatedAt: nowIso }
          };
        }
        const norm = normalizeExtentList(extentList);
        if (!norm) {
          state.extent = null;
          state.extentNative = null;
          state.extentNativeCrs = projectCrs || state?.projectMeta?.crs || null;
          return {
            extent: { bbox: null, crs: projectCrs || 'EPSG:4326', updatedAt: nowIso },
            extentWgs84: { bbox: null, crs: 'EPSG:4326', updatedAt: nowIso }
          };
        }
        state.extent = norm.slice();
        const converted = transformExtentToProjectCrs(norm, projectCrs);
        let nativeBbox = null;
        let nativeCrs = converted?.crs || projectCrs || 'EPSG:4326';
        if (converted && Array.isArray(converted.bbox)) {
          nativeBbox = converted.bbox.slice();
        } else {
          nativeBbox = norm.slice();
          nativeCrs = 'EPSG:4326';
        }
        state.extentNative = nativeBbox.slice();
        state.extentNativeCrs = nativeCrs;
        return {
          extent: { bbox: nativeBbox, crs: nativeCrs, updatedAt: nowIso },
          extentWgs84: { bbox: norm.slice(), crs: 'EPSG:4326', updatedAt: nowIso }
        };
      };

      const buildLayerExtentPatch = (projectId, layerName, extentList, layerCrs) => {
        const nowIso = new Date().toISOString();
        const projectState = getProjectState(projectId);
        const configuredTileCrs = (projectState && projectState.config && projectState.config.cachePreferences && projectState.config.cachePreferences.tileCrs) || null;
        const configuredCrsSafe = (typeof configuredTileCrs === 'string' && configuredTileCrs.trim() && configuredTileCrs.trim().toUpperCase() !== 'AUTO')
          ? configuredTileCrs.trim()
          : null;
        const nativeCrs = layerCrs || projectState?.projectMeta?.crs || configuredCrsSafe || 'EPSG:4326';
        const entryPatch = {
          extent: { bbox: null, crs: nativeCrs, updatedAt: nowIso },
          extentWgs84: { bbox: null, crs: 'EPSG:4326', updatedAt: nowIso }
        };
        if (Array.isArray(extentList) && extentList.length === 4) {
          const norm = normalizeExtentList(extentList);
          if (norm) {
            const converted = transformExtentToProjectCrs(norm, nativeCrs);
            const nativeBbox = (converted && Array.isArray(converted.bbox)) ? converted.bbox.slice() : norm.slice();
            const nativeOutCrs = converted?.crs || nativeCrs;
            entryPatch.extent = { bbox: nativeBbox, crs: nativeOutCrs, updatedAt: nowIso };
            entryPatch.extentWgs84 = { bbox: norm.slice(), crs: 'EPSG:4326', updatedAt: nowIso };
          }
        }
        return { layers: { [layerName]: entryPatch } };
      };

      const getLayerProjectedExtentPayload = (projectId, layerName, fallbackLayerCrs = null) => {
        const projectState = getProjectState(projectId);
        const livePanel = projectState?.layerExtentPanels?.get?.(layerName) || null;
        if (livePanel && Object.prototype.hasOwnProperty.call(livePanel, 'extent')) {
          if (Array.isArray(livePanel.extent) && livePanel.extent.length === 4) {
            const livePatch = buildLayerExtentPatch(projectId, layerName, livePanel.extent, livePanel.layerCrs || fallbackLayerCrs);
            const liveExtent = livePatch?.layers?.[layerName]?.extent || null;
            const bbox = Array.isArray(liveExtent?.bbox) ? normalizeExtentList(liveExtent.bbox) : null;
            const crs = liveExtent?.crs || livePanel.layerCrs || fallbackLayerCrs || null;
            if (bbox) {
              const resolvedCrs = crs || 'EPSG:4326';
              const fixed = normalizeAxisOrderForCrs(bbox, resolvedCrs) || bbox;
              return {
                bbox: fixed,
                extentString: fixed.join(','),
                crs: resolvedCrs
              };
            }
          }
          return null;
        }
        const cfg = projectConfigs.get(projectId);
        const layerCfg = cfg && cfg.layers ? cfg.layers[layerName] : null;
        if (!layerCfg) return null;
        let bbox = null;
        let crs = fallbackLayerCrs || null;
        if (layerCfg.extent && Array.isArray(layerCfg.extent.bbox)) {
          bbox = normalizeExtentList(layerCfg.extent.bbox);
          crs = layerCfg.extent.crs || crs;
        }
        if (!bbox && layerCfg.extentWgs84 && Array.isArray(layerCfg.extentWgs84.bbox)) {
          const wgs = normalizeExtentList(layerCfg.extentWgs84.bbox);
          if (wgs) {
            const converted = transformExtentToProjectCrs(wgs, fallbackLayerCrs || crs || null);
            if (converted && Array.isArray(converted.bbox)) {
              bbox = normalizeExtentList(converted.bbox);
              crs = converted.crs || fallbackLayerCrs || crs;
            }
          }
        }
        if (!bbox) return null;
        const resolvedCrs = crs || fallbackLayerCrs || 'EPSG:4326';
        const fixed = normalizeAxisOrderForCrs(bbox, resolvedCrs) || bbox;
        return {
          bbox: fixed,
          extentString: fixed.join(','),
          crs: resolvedCrs
        };
      };

      const getLayerZoomRange = (projectId, layerName) => {
        const projectState = getProjectState(projectId);
        const livePanel = projectState?.layerExtentPanels?.get?.(layerName) || null;
        if (livePanel) {
          const inputMin = parseZoomNumber(livePanel.minInputEl?.value);
          const inputMax = parseZoomNumber(livePanel.maxInputEl?.value);
          if (inputMin != null && inputMax != null) {
            return { min: inputMin, max: inputMax };
          }
          const liveMin = parseZoomNumber(livePanel.zoomMin);
          const liveMax = parseZoomNumber(livePanel.zoomMax);
          if (liveMin != null && liveMax != null) {
            return { min: liveMin, max: liveMax };
          }
        }
        const cfg = projectConfigs.get(projectId);
        const layerCfg = cfg && cfg.layers ? cfg.layers[layerName] : null;
        if (!layerCfg || !layerCfg.zoom) return null;
        const min = parseZoomNumber(layerCfg.zoom.min);
        const max = parseZoomNumber(layerCfg.zoom.max);
        if (min == null || max == null) return null;
        return { min, max };
      };

      const getProjectZoomRange = (projectId) => {
        const cfg = projectConfigs.get(projectId);
        const zoomCfg = cfg && cfg.zoom ? cfg.zoom : null;
        if (!zoomCfg) return null;
        const min = parseZoomNumber(zoomCfg.min);
        const max = parseZoomNumber(zoomCfg.max);
        if (min == null || max == null) return null;
        return { min, max };
      };

      const getProjectedExtentPayload = (projectId) => {
        const state = getProjectState(projectId);
        if (!state) return null;
        if (Array.isArray(state.extentNative) && state.extentNative.length === 4) {
          const crs = state.extentNativeCrs || state?.projectMeta?.crs || 'EPSG:4326';
          const fixed = normalizeAxisOrderForCrs(state.extentNative, crs) || state.extentNative;
          // keep state consistent for downstream cache requests
          state.extentNative = fixed.slice();
          state.extentNativeCrs = crs;
          const bbox = fixed.map((value) => Number.isFinite(value) ? value : 0);
          return {
            bbox,
            extentString: bbox.join(','),
            crs
          };
        }
        // If no explicit extent captured, but the Leaflet map is open, use its current viewport bounds.
        if ((!Array.isArray(state.extent) || state.extent.length !== 4) && state.map && typeof state.map.getBounds === 'function') {
          try {
            const b = state.map.getBounds();
            const viewport = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
            const normalizedViewport = normalizeExtentList(viewport);
            if (normalizedViewport) {
              state.extent = normalizedViewport.slice();
            }
          } catch (e) {}
        }
        if (!Array.isArray(state.extent) || state.extent.length !== 4) return null;
        const configuredTileCrs = (state && state.config && state.config.cachePreferences && state.config.cachePreferences.tileCrs) || null;
        const configuredCrsSafe = (typeof configuredTileCrs === 'string' && configuredTileCrs.trim() && configuredTileCrs.trim().toUpperCase() !== 'AUTO')
          ? configuredTileCrs.trim()
          : null;
        const projectCrs = state?.projectMeta?.crs || configuredCrsSafe || null;
        const converted = transformExtentToProjectCrs(state.extent, projectCrs);
        if (!converted || !Array.isArray(converted.bbox)) return null;
        const fixed = normalizeAxisOrderForCrs(converted.bbox, converted.crs || projectCrs) || converted.bbox;
        const bbox = fixed.map((value) => Number.isFinite(value) ? value : 0);
        state.extentNative = fixed.slice();
        state.extentNativeCrs = converted.crs || projectCrs || 'EPSG:4326';
        return {
          bbox,
          extentString: bbox.join(','),
          crs: state.extentNativeCrs
        };
      };

      const focusMapToExtent = (projectId, extentList, options = {}) => {
        const norm = normalizeExtentList(extentList);
        if (!projectId || !norm) return;
        const state = getProjectState(projectId);
        const payload = {
          extent: norm,
          highlight: options.highlight !== false,
          sourceKey: options.sourceKey || null,
          maxZoom: Number.isFinite(options.maxZoom) ? Number(options.maxZoom) : null
        };
        state.pendingMapFocus = payload;
        if (!state.map || typeof L === 'undefined') {
          return;
        }
        const map = state.map;
        const bounds = toBoundsWgs84(norm);
        if (!bounds) return;
        const applyFocus = () => {
          try { map.invalidateSize(); } catch {}
          try {
            const fitOptions = payload.maxZoom != null ? { maxZoom: payload.maxZoom } : {};
            map.fitBounds(bounds, { ...fitOptions, animate: true });
          } catch {}
          if (payload.highlight) {
            if (!state.focusLayerGroup) {
              try {
                state.focusLayerGroup = new L.FeatureGroup();
                map.addLayer(state.focusLayerGroup);
              } catch (err) {
                state.focusLayerGroup = null;
              }
            }
            if (state.focusLayerGroup) {
              state.focusLayerGroup.clearLayers();
              try {
                const rect = L.rectangle(bounds, { color: '#f97316', weight: 1, fillOpacity: 0.08, dashArray: '6 4' });
                state.focusLayerGroup.addLayer(rect);
              } catch {}
            }
          } else if (state.focusLayerGroup) {
            state.focusLayerGroup.clearLayers();
          }
          state.lastFocusKey = payload.sourceKey || null;
          state.pendingMapFocus = null;
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(applyFocus);
        } else {
          setTimeout(applyFocus, 16);
        }
      };

      async function toggleLayerExtentPanel(project, layer, configLayer, container, toggleBtn){
        const state = getProjectState(project.id);
        const panelKey = String(layer?.name || '');
        if (!panelKey) return;
        if (!state.layerExtentPanels) state.layerExtentPanels = new Map();
        const existing = state.layerExtentPanels.get(panelKey) || {
          open: false,
          map: null,
          extent: null,
          layerCrs: layer?.tile_crs || layer?.crs || state?.projectMeta?.crs || null,
          zoomMin: null,
          zoomMax: null,
          mapResizeObserver: null,
          mapResizeTimer: null
        };
        state.layerExtentPanels.set(panelKey, existing);

        const updateToggleLabel = () => {
          if (!toggleBtn) return;
          toggleBtn.textContent = existing.open ? tr('Hide extent map') : tr('Show extent map');
        };

        if (existing.open) {
          existing.open = false;
          container.style.display = 'none';
          existing.minInputEl = null;
          existing.maxInputEl = null;
          if (existing.map) {
            try { existing.map.remove(); } catch {}
            existing.map = null;
          }
          if (existing.mapResizeObserver) {
            try { existing.mapResizeObserver.disconnect(); } catch {}
            existing.mapResizeObserver = null;
          }
          if (existing.mapResizeTimer) {
            clearTimeout(existing.mapResizeTimer);
            existing.mapResizeTimer = null;
          }
          container.innerHTML = '';
          updateToggleLabel();
          return;
        }

        existing.open = true;
        container.style.display = 'block';
        container.innerHTML = '';
        updateToggleLabel();

        const wrapper = document.createElement('div');
        wrapper.className = 'layer-extent-panel';
        const title = document.createElement('div');
        title.className = 'panel-title';
        title.textContent = tr('Layer extent map') + ' · ' + (layer.name || 'layer');
        wrapper.appendChild(title);

        const mapId = `layer-extent-map-${toDomId(project.id)}-${toDomId(layer.name)}-${Date.now()}`;
        const mapHolder = document.createElement('div');
        mapHolder.id = mapId;
        mapHolder.style.height = '260px';
        mapHolder.style.width = '100%';
        mapHolder.style.border = '1px solid var(--border)';
        mapHolder.style.borderRadius = '8px';
        mapHolder.style.overflow = 'hidden';
        wrapper.appendChild(mapHolder);

        const settings = document.createElement('div');
        settings.className = 'control-grid project-settings-grid';
        settings.style.marginTop = '10px';

        const layerZoom = getLayerZoomRange(project.id, layer.name);
        const defaultMin = layerZoom ? layerZoom.min : (Number.parseInt(zoomMinInput?.value || '0', 10) || 0);
        const defaultMax = layerZoom ? layerZoom.max : (Number.parseInt(zoomMaxInput?.value || '0', 10) || 0);
        existing.zoomMin = defaultMin;
        existing.zoomMax = defaultMax;

        const minWrap = document.createElement('label');
        minWrap.className = 'field';
        const minLabel = document.createElement('span');
        minLabel.textContent = tr('Min zoom:');
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.className = 'input-number';
        minInput.min = '0';
        minInput.max = String(MAX_ZOOM_LEVEL);
        minInput.value = String(defaultMin);
        existing.minInputEl = minInput;
        minWrap.append(minLabel, minInput);

        const maxWrap = document.createElement('label');
        maxWrap.className = 'field';
        const maxLabel = document.createElement('span');
        maxLabel.textContent = tr('Max zoom:');
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.className = 'input-number';
        maxInput.min = '0';
        maxInput.max = String(MAX_ZOOM_LEVEL);
        maxInput.value = String(defaultMax);
        existing.maxInputEl = maxInput;
        maxWrap.append(maxLabel, maxInput);

        const crsWrap = document.createElement('div');
        crsWrap.className = 'field';
        const crsLabel = document.createElement('span');
        crsLabel.textContent = tr('Tile CRS:');
        const crsValue = document.createElement('input');
        crsValue.type = 'text';
        crsValue.className = 'input-text';
        crsValue.disabled = true;
        crsValue.value = existing.layerCrs || 'AUTO';
        crsWrap.append(crsLabel, crsValue);

        settings.append(minWrap, maxWrap, crsWrap);
        wrapper.appendChild(settings);

        const buttons = document.createElement('div');
        buttons.style.marginTop = '8px';
        buttons.style.display = 'flex';
        buttons.style.flexWrap = 'wrap';
        buttons.style.gap = '8px';
        wrapper.appendChild(buttons);

        const status = document.createElement('div');
        status.className = 'meta project-settings-status';
        status.style.marginTop = '8px';
        wrapper.appendChild(status);

        const showLocalStatus = (msg, isError = false) => {
          status.textContent = String(msg || '');
          status.classList.toggle('error', !!isError);
        };

        const saveLayerSettings = (extentList = null) => {
          const minVal = Number.parseInt(minInput.value, 10);
          const maxVal = Number.parseInt(maxInput.value, 10);
          const min = Number.isFinite(minVal) ? Math.max(0, Math.min(MAX_ZOOM_LEVEL, minVal)) : 0;
          const max = Number.isFinite(maxVal) ? Math.max(0, Math.min(MAX_ZOOM_LEVEL, maxVal)) : 0;
          const finalMin = Math.min(min, max);
          const finalMax = Math.max(min, max);
          existing.zoomMin = finalMin;
          existing.zoomMax = finalMax;
          existing.extent = Array.isArray(extentList) ? extentList.slice() : null;
          minInput.value = String(finalMin);
          maxInput.value = String(finalMax);
          const patch = buildLayerExtentPatch(project.id, layer.name, extentList, existing.layerCrs) || { layers: {} };
          patch.layers[layer.name] = patch.layers[layer.name] || {};
          patch.layers[layer.name].zoom = { min: finalMin, max: finalMax, updatedAt: new Date().toISOString() };
          queueProjectConfigSave(project.id, patch, { immediate: true });
          showLocalStatus(tr('Layer settings saved: z{min}-{max}', { min: finalMin, max: finalMax }));
        };

        container.appendChild(wrapper);

        try {
          await ensureLeafletReady();
        } catch (err) {
          showLocalStatus(tr('Failed to load map: {error}', { error: String(err) }), true);
          return;
        }

        const map = L.map(mapId, {
          zoomControl: true,
          maxZoom: 23,
          minZoom: 0,
          zoomSnap: 0.25,
          wheelPxPerZoomLevel: 80
        });
        existing.map = map;
        try { L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:23, attribution:'OSM'}).addTo(map); } catch {}

        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        const applyRect = (extentArr) => {
          drawnItems.clearLayers();
          const bounds = toBoundsWgs84(extentArr);
          if (!bounds) return;
          try {
            const rect = L.rectangle(bounds, { color: '#2563eb', weight: 1, fillOpacity: 0.05 });
            drawnItems.addLayer(rect);
          } catch {}
        };

        const configuredWgsExtent = normalizeExtentList(configLayer?.extentWgs84?.bbox)
          || normalizeExtentList(configLayer?.extent_wgs84?.bbox)
          || normalizeExtentList(layer.extent_wgs84)
          || normalizeExtentList(layer.extent);
        if (configuredWgsExtent) {
          existing.extent = configuredWgsExtent.slice();
          applyRect(existing.extent);
          try { map.fitBounds(toBoundsWgs84(existing.extent), { maxZoom: 20 }); } catch {}
        } else if (Array.isArray(layer.extent_wgs84) && layer.extent_wgs84.length === 4) {
          try { map.fitBounds(toBoundsWgs84(layer.extent_wgs84), { maxZoom: 20 }); } catch {}
        } else {
          try { map.setView([0, 0], 2); } catch {}
        }

        try {
          const drawControl = new L.Control.Draw({
            draw: { polygon:false, polyline:false, circle:false, marker:false, circlemarker:false, rectangle:{ showArea:false } },
            edit: { featureGroup: drawnItems, remove: true }
          });
          map.addControl(drawControl);
          map.on(L.Draw.Event.CREATED, (e) => {
            drawnItems.clearLayers();
            drawnItems.addLayer(e.layer);
            const b = e.layer.getBounds();
            existing.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
            saveLayerSettings(existing.extent);
          });
          map.on('draw:edited', () => {
            const layerShape = drawnItems.getLayers()[0];
            if (!layerShape) return;
            const b = layerShape.getBounds();
            existing.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
            saveLayerSettings(existing.extent);
          });
          map.on('draw:deleted', () => {
            existing.extent = null;
            saveLayerSettings(null);
          });
        } catch {}

        const setMinBtn = document.createElement('button');
        setMinBtn.type = 'button';
        setMinBtn.className = 'btn btn-secondary';
        setMinBtn.textContent = tr('Set current zoom as Min');
        setMinBtn.onclick = () => {
          minInput.value = String(Math.round(map.getZoom()));
          saveLayerSettings(existing.extent);
        };
        buttons.appendChild(setMinBtn);

        const setMaxBtn = document.createElement('button');
        setMaxBtn.type = 'button';
        setMaxBtn.className = 'btn btn-secondary';
        setMaxBtn.textContent = tr('Set current zoom as Max');
        setMaxBtn.onclick = () => {
          maxInput.value = String(Math.round(map.getZoom()));
          saveLayerSettings(existing.extent);
        };
        buttons.appendChild(setMaxBtn);

        const useCurrentBtn = document.createElement('button');
        useCurrentBtn.type = 'button';
        useCurrentBtn.className = 'btn btn-secondary';
        useCurrentBtn.textContent = tr('Use current view');
        useCurrentBtn.onclick = () => {
          const b = map.getBounds();
          existing.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
          applyRect(existing.extent);
          saveLayerSettings(existing.extent);
        };
        buttons.appendChild(useCurrentBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn';
        clearBtn.textContent = tr('Clear extent');
        clearBtn.onclick = () => {
          existing.extent = null;
          drawnItems.clearLayers();
          saveLayerSettings(null);
        };
        buttons.appendChild(clearBtn);

        const onZoomInputChange = () => saveLayerSettings(existing.extent);
        minInput.addEventListener('input', () => {
          existing.zoomMin = parseZoomNumber(minInput.value);
        });
        maxInput.addEventListener('input', () => {
          existing.zoomMax = parseZoomNumber(maxInput.value);
        });
        minInput.addEventListener('change', onZoomInputChange);
        maxInput.addEventListener('change', onZoomInputChange);
      }

      async function toggleProjectExtentPanel(project, projectMeta, container){
        const projectSettingsCard = document.getElementById('project_settings_card');
        const projectSettingsStatus = document.getElementById('project_settings_status');
        const moveSettingsCardToDefault = () => {
          if (!projectSettingsCard) return;
          const contentPanel = document.querySelector('.content-panel');
          const statusNode = document.getElementById('status');
          if (contentPanel) {
            if (statusNode && statusNode.parentElement === contentPanel) {
              contentPanel.insertBefore(projectSettingsCard, statusNode);
            } else {
              contentPanel.appendChild(projectSettingsCard);
            }
          }
          projectSettingsCard.hidden = true;
          projectSettingsCard.dataset.projectId = '';
          if (projectSettingsStatus) {
            projectSettingsStatus.textContent = '';
            projectSettingsStatus.classList.remove('error');
          }
        };

        const showProjectSettingsStatus = (message, isError = false) => {
          if (!projectSettingsStatus) return;
          projectSettingsStatus.textContent = String(message || '');
          projectSettingsStatus.classList.toggle('error', !!isError);
        };

        const state = getProjectState(project.id);
        if (container.dataset.open === '1') {
          container.dataset.open = '0';
          container.style.display = 'none';
          moveSettingsCardToDefault();
          if (state.map) {
            try { state.map.remove(); } catch {}
            state.map = null;
          }
          if (state.focusLayerGroup) {
            try { state.focusLayerGroup.clearLayers(); } catch {}
          }
          state.focusLayerGroup = null;
          state.pendingMapFocus = null;
          if (state.mapResizeObserver) {
            try { state.mapResizeObserver.disconnect(); } catch {}
            state.mapResizeObserver = null;
          }
          if (state.mapVisibilityObserver) {
            try { state.mapVisibilityObserver.disconnect(); } catch {}
            state.mapVisibilityObserver = null;
          }
          if (state.mapResizeTimer) {
            clearTimeout(state.mapResizeTimer);
            state.mapResizeTimer = null;
          }
          state.mapHolder = null;
          container.innerHTML = '';
          state.open = false;
          state.batchButton = null;
          refreshProjectMetaInfo(project, projectMeta, state.config);
          return;
        }
        container.dataset.open = '1';
        container.style.display = 'block';
        container.innerHTML = '';
        state.open = true;
        if (state.mapResizeObserver) {
          try { state.mapResizeObserver.disconnect(); } catch {}
        }
        if (state.mapVisibilityObserver) {
          try { state.mapVisibilityObserver.disconnect(); } catch {}
        }
        if (state.mapResizeTimer) {
          clearTimeout(state.mapResizeTimer);
          state.mapResizeTimer = null;
        }
        state.mapResizeObserver = null;
        state.mapVisibilityObserver = null;
        state.mapHolder = null;

        const wrapper = document.createElement('div');
        wrapper.style.margin = '12px 0';
        wrapper.style.padding = '12px';
        wrapper.style.background = 'var(--card)';
        wrapper.style.border = '1px solid var(--border)';
        wrapper.style.borderRadius = '12px';
        wrapper.style.boxShadow = 'var(--shadow)';

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        title.textContent = tr('Extent capture') + ' · ' + (project.name || project.id);
        wrapper.appendChild(title);

        const mapId = `extent-map-${project.id}-${Date.now()}`;
        const mapHolder = document.createElement('div');
        mapHolder.id = mapId;
    mapHolder.style.height = '340px';
    mapHolder.style.width = '100%';
    mapHolder.style.minHeight = '240px';
    mapHolder.style.minWidth = '280px';
    mapHolder.style.maxWidth = '100%';
    mapHolder.style.maxHeight = 'calc(100vh - 220px)';
    mapHolder.style.resize = 'both';
        mapHolder.style.border = '1px solid var(--border)';
        mapHolder.style.borderRadius = '8px';
        mapHolder.style.overflow = 'hidden';
        mapHolder.style.position = 'relative';
        wrapper.appendChild(mapHolder);

        const settingsMount = document.createElement('div');
        settingsMount.className = 'project-settings-mount';
        wrapper.appendChild(settingsMount);

        if (projectSettingsCard) {
          projectSettingsCard.dataset.projectId = project.id;
          projectSettingsCard.hidden = false;
          settingsMount.appendChild(projectSettingsCard);
        }

        const buttons = document.createElement('div');
        buttons.style.marginTop = '8px';
        buttons.style.display = 'flex';
        buttons.style.flexWrap = 'wrap';
        buttons.style.gap = '8px';
        wrapper.appendChild(buttons);

        const isAdminUser = !window.appState?.authEnabled || (window.appState.user && window.appState.user.role === 'admin');
        if (isAdminUser && Array.isArray(state.projectLayers) && state.projectLayers.length > 0) {
          const runAllBtn = document.createElement('button');
          runAllBtn.className = 'btn btn-primary';
          runAllBtn.type = 'button';
          runAllBtn.textContent = tr('Generate WMTS-Tiles for all layers');
          runAllBtn.setAttribute('data-i18n', 'Generate WMTS-Tiles for all layers');
          runAllBtn.addEventListener('click', () => runProjectCacheFromDialog(project, state.projectLayers, runAllBtn));
          buttons.appendChild(runAllBtn);
          state.batchButton = runAllBtn;
        }

        const info = document.createElement('div');
        info.style.marginTop = '8px';
        info.style.fontSize = '12px';
        info.style.color = 'var(--muted)';
        wrapper.appendChild(info);

        container.appendChild(wrapper);

        const updateInfo = () => {
          if (state.extent && Array.isArray(state.extent) && state.extent.length === 4) {
            info.textContent = 'Extent (lon/lat WGS84): ' + JSON.stringify(state.extent.map(v => Number(v.toFixed ? v.toFixed(6) : Number(v).toFixed(6))));
          } else {
            info.textContent = 'No extent captured.';
          }
          refreshProjectMetaInfo(project, projectMeta, state.config);
        };

        try {
          await ensureLeafletReady();
        } catch (err) {
          info.textContent = tr('Failed to load map: {error}', { error: String(err) });
          showStatus('Unable to load map library: ' + err, true);
          container.dataset.open = '0';
          container.style.display = 'none';
          container.innerHTML = '';
          state.open = false;
          refreshProjectMetaInfo(project, projectMeta, state.config);
          return;
        }

        const map = L.map(mapId, {
          zoomControl: true,
          maxZoom: 23,
          minZoom: 0,
          zoomSnap: 0.25,
          wheelPxPerZoomLevel: 80
        });
        state.map = map;
        state.mapHolder = mapHolder;
        const queueMapInvalidate = () => {
          if (!state.map) return;
          if (state.mapResizeTimer) {
            clearTimeout(state.mapResizeTimer);
          }
          state.mapResizeTimer = setTimeout(() => {
            state.mapResizeTimer = null;
            try { state.map.invalidateSize(); } catch {}
          }, 60);
        };
        if (typeof ResizeObserver !== 'undefined') {
          try {
            const resizeObserver = new ResizeObserver(() => queueMapInvalidate());
            resizeObserver.observe(mapHolder);
            state.mapResizeObserver = resizeObserver;
          } catch {}
        }
        if (typeof IntersectionObserver !== 'undefined') {
          try {
            const visibilityObserver = new IntersectionObserver((entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                queueMapInvalidate();
              }
            }, { rootMargin: '64px' });
            visibilityObserver.observe(mapHolder);
            state.mapVisibilityObserver = visibilityObserver;
          } catch {}
        } else {
          queueMapInvalidate();
        }
        try {
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:23, attribution:'OSM'}).addTo(map);
        } catch {}
        queueMapInvalidate();
        setTimeout(queueMapInvalidate, 160);

        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        const applyExtentRectangle = (extentArr) => {
          drawnItems.clearLayers();
          const bounds = toBoundsWgs84(extentArr);
          if (!bounds) return;
          try {
            const rect = L.rectangle(bounds, { color: '#2563eb', weight: 1, fillOpacity: 0.05 });
            drawnItems.addLayer(rect);
          } catch {}
        };

        try {
          const drawControl = new L.Control.Draw({
            draw: { polygon:false, polyline:false, circle:false, marker:false, circlemarker:false, rectangle:{ showArea:false } },
            edit: { featureGroup: drawnItems, remove: true }
          });
          map.addControl(drawControl);
          map.on(L.Draw.Event.CREATED, (e) => {
            drawnItems.clearLayers();
            drawnItems.addLayer(e.layer);
            const b = e.layer.getBounds();
            state.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
            updateInfo();
            try {
              const rounded = Math.round(map.getZoom());
              if (zoomMinInput) zoomMinInput.value = rounded;
              if (zoomMaxInput) zoomMaxInput.value = rounded;
              const st = getProjectState(project.id); if (st) st.controlsEdited = true;
              const patch = buildExtentPatch(project.id, state.extent) || {};
              patch.zoom = { min: rounded, max: rounded, updatedAt: new Date().toISOString() };
              queueProjectConfigSave(project.id, patch);
            } catch (err) {
              queueProjectConfigSave(project.id, buildExtentPatch(project.id, state.extent));
            }
          });
          map.on('draw:edited', () => {
            const layer = drawnItems.getLayers()[0];
            if (!layer) return;
            const b = layer.getBounds();
            state.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
            updateInfo();
            try {
              const rounded = Math.round(map.getZoom());
              if (zoomMinInput) zoomMinInput.value = rounded;
              if (zoomMaxInput) zoomMaxInput.value = rounded;
              const st = getProjectState(project.id); if (st) st.controlsEdited = true;
              const patch = buildExtentPatch(project.id, state.extent) || {};
              patch.zoom = { min: rounded, max: rounded, updatedAt: new Date().toISOString() };
              queueProjectConfigSave(project.id, patch);
            } catch (err) {
              queueProjectConfigSave(project.id, buildExtentPatch(project.id, state.extent));
            }
          });
          map.on('draw:deleted', () => {
            state.extent = null;
            updateInfo();
            queueProjectConfigSave(project.id, buildExtentPatch(project.id, null));
          });
        } catch {}

        applyExtentRectangle(state.extent);
        const ensureInitialView = () => {
          if (!state.map) return;
          const pending = state.pendingMapFocus;
          if (pending && pending.extent) {
            focusMapToExtent(project.id, pending.extent, pending);
            return;
          }
          const capturedExtent = normalizeExtentList(state.extent);
          if (capturedExtent) {
            focusMapToExtent(project.id, capturedExtent, { highlight: false, sourceKey: 'captured', maxZoom: 22 });
            return;
          }
          const defaultExtent = normalizeExtentList(state.defaultMapExtent)
            || normalizeExtentList(state.projectViewExtent)
            || normalizeExtentList(projectMeta && projectMeta.extent_wgs84)
            || normalizeExtentList(state.layerExtentUnion);
          if (defaultExtent) {
            focusMapToExtent(project.id, defaultExtent, { highlight: false, sourceKey: 'project-default', maxZoom: 20 });
            return;
          }
          const fallbackBounds = toBoundsWgs84(projectMeta && projectMeta.extent_wgs84);
          try { map.invalidateSize(); } catch {}
          if (fallbackBounds) {
            try { map.fitBounds(fallbackBounds, { maxZoom: 20 }); } catch {}
          } else {
            try { map.setView([0, 0], 2); } catch {}
          }
        };
        ensureInitialView();
        setTimeout(ensureInitialView, 60);

        const btnCapture = document.createElement('button');
        btnCapture.className = 'btn btn-secondary';
        btnCapture.type = 'button';
        btnCapture.textContent = tr('Use current view');
        btnCapture.onclick = () => {
          const b = map.getBounds();
          state.extent = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(v => Number(v.toFixed(6)));
          applyExtentRectangle(state.extent);
          updateInfo();
          try {
            const rounded = Math.round(map.getZoom());
            const patch = buildExtentPatch(project.id, state.extent) || {};
            patch.zoom = { min: rounded, max: rounded, updatedAt: new Date().toISOString() };
            queueProjectConfigSave(project.id, patch);
          } catch (err) {
            queueProjectConfigSave(project.id, buildExtentPatch(project.id, state.extent));
          }
        };
        const btnCenterProject = document.createElement('button');
        btnCenterProject.className = 'btn btn-secondary';
        btnCenterProject.type = 'button';
        btnCenterProject.textContent = tr('Center on project extent');
        btnCenterProject.onclick = () => {
          const targetExtent = normalizeExtentList(state.projectViewExtent)
            || normalizeExtentList(state.defaultMapExtent)
            || normalizeExtentList(projectMeta && projectMeta.extent_wgs84)
            || normalizeExtentList(state.layerExtentUnion);
          if (targetExtent) {
            focusMapToExtent(project.id, targetExtent, { highlight: false, sourceKey: 'project-center', maxZoom: 20 });
          } else {
            showProjectSettingsStatus(tr('Project extent unavailable.'), true);
          }
        };
        buttons.appendChild(btnCenterProject);
        buttons.appendChild(btnCapture);

        const btnMin = document.createElement('button');
        btnMin.className = 'btn btn-secondary';
        btnMin.type = 'button';
        btnMin.textContent = tr('Set current zoom as Min');
        btnMin.onclick = () => {
          const rounded = Math.round(map.getZoom());
          document.getElementById('zoom_min').value = rounded;
          showProjectSettingsStatus(tr('zoom_min set to {zoom}', { zoom: rounded }));
          const currentMaxRaw = document.getElementById('zoom_max').value;
          const parsedMax = Number(currentMaxRaw);
          queueProjectConfigSave(project.id, {
            zoom: {
              min: rounded,
              max: Number.isFinite(parsedMax) ? parsedMax : null,
              updatedAt: new Date().toISOString()
            }
          });
        };
        buttons.appendChild(btnMin);

        const btnMax = document.createElement('button');
        btnMax.className = 'btn btn-secondary';
        btnMax.type = 'button';
        btnMax.textContent = tr('Set current zoom as Max');
        btnMax.onclick = () => {
          const rounded = Math.round(map.getZoom());
          document.getElementById('zoom_max').value = rounded;
          showProjectSettingsStatus(tr('zoom_max set to {zoom}', { zoom: rounded }));
          const currentMinRaw = document.getElementById('zoom_min').value;
          const parsedMin = Number(currentMinRaw);
          queueProjectConfigSave(project.id, {
            zoom: {
              min: Number.isFinite(parsedMin) ? parsedMin : null,
              max: rounded,
              updatedAt: new Date().toISOString()
            }
          });
        };
        buttons.appendChild(btnMax);

        const btnClear = document.createElement('button');
        btnClear.className = 'btn';
        btnClear.type = 'button';
        btnClear.textContent = tr('Clear extent');
        btnClear.onclick = () => {
          state.extent = null;
          drawnItems.clearLayers();
          updateInfo();
          showProjectSettingsStatus(tr('Extent removed'));
          queueProjectConfigSave(project.id, buildExtentPatch(project.id, null));
        };
        buttons.appendChild(btnClear);

        updateInfo();
      }

      let statusHideTimer = null;

      function ensureStatusToastHost() {
        let host = document.getElementById('status_toast_host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'status_toast_host';
          host.className = 'status-toast-host';
          host.setAttribute('aria-live', 'polite');
          host.setAttribute('aria-atomic', 'true');
          document.body.appendChild(host);
        }
        return host;
      }

      function clearStatus() {
        const host = document.getElementById('status_toast_host');
        if (!host) return;
        host.innerHTML = '';
        host.classList.remove('is-visible');
        if (statusHideTimer) {
          clearTimeout(statusHideTimer);
          statusHideTimer = null;
        }
      }

      // Global helper to show centered Bulma-like notifications.
      function showStatus(msg, isError = false, autoHideMs = null) {
        const host = ensureStatusToastHost();
        host.innerHTML = '';
        host.classList.add('is-visible');

        const note = document.createElement('div');
        note.className = 'notification qtiler-toast ' + (isError ? 'is-danger' : 'is-success');
        note.textContent = String(msg || '');
        host.appendChild(note);

        if (statusHideTimer) {
          clearTimeout(statusHideTimer);
          statusHideTimer = null;
        }
        const ttl = Number.isFinite(autoHideMs)
          ? Math.max(0, autoHideMs)
          : (isError ? 5600 : 3400);
        if (ttl > 0) {
          statusHideTimer = setTimeout(() => {
            clearStatus();
          }, ttl);
        }
      }

  const layersEl = document.getElementById('layers');
  const reloadBtn = document.getElementById('reload');
  const uploadBtn = document.getElementById('upload_project_btn');
  const uploadInput = document.getElementById('project_upload_input');
  const languageSelect = document.getElementById('language_selector');
  if (window.qtilerLang?.subscribe) {
    window.qtilerLang.subscribe((lang) => {
      const normalized = normalizeLang(lang);
      if (normalized === currentLang) return;
      currentLang = normalized;
      applyStaticTranslations();
      if (languageSelect && languageSelect.value !== currentLang) {
        languageSelect.value = currentLang;
      }
      try { reapplyInlineJobSlotsFromCache(); } catch {}
      try { refreshJobs(); } catch {}
      try {
        extentStates.forEach((state, projectId) => {
          if (state?.batchInfoEl) refreshProjectBatchStatus(projectId);
        });
      } catch {}
    });
  }
  const zoomMinInput = document.getElementById('zoom_min');
  const zoomMaxInput = document.getElementById('zoom_max');
  const modeSelect = document.getElementById('cache_mode');
  const tileCrsInput = document.getElementById('tile_crs');
  const allowRemoteCheckbox = document.getElementById('allow_remote');
  const throttleInput = document.getElementById('throttle_ms');
  const jobsWrap = document.getElementById('jobs');
  const jobsList = document.getElementById('jobsList');
  let loadLayersRunning = false;
  let loadLayersQueued = false;
  let loadLayersQueuedOptions = null;

      if (languageSelect) {
        languageSelect.value = currentLang;
        languageSelect.addEventListener('change', (event) => setLanguage(event.target.value));
      }

      applyStaticTranslations();

      // Force cache settings: WMTS automatic + allow remote + throttle >= 300ms.
      function enforceCacheControls(){
        try {
          if (modeSelect) {
            modeSelect.value = 'wmts';
            modeSelect.disabled = true;
          }
          if (tileCrsInput) {
            tileCrsInput.value = 'AUTO';
            tileCrsInput.disabled = true;
          }
          if (allowRemoteCheckbox) {
            allowRemoteCheckbox.checked = true;
            allowRemoteCheckbox.disabled = true;
          }
          if (throttleInput) {
            const parsed = Number.parseInt(String(throttleInput.value || '').trim(), 10);
            const next = Number.isFinite(parsed) ? Math.max(300, parsed) : 300;
            throttleInput.min = '300';
            throttleInput.value = String(next);
          }
        } catch (e) {}
      }

      enforceCacheControls();

      if (uploadBtn && uploadInput) {
        uploadBtn.addEventListener('click', () => uploadInput.click());
        uploadInput.addEventListener('change', async (event) => {
          const file = event.target.files && event.target.files[0];
          if (!file) return;
          await uploadProjectFile(uploadBtn, file);
          uploadInput.value = '';
        });
      }

      function emitControlConfigChange(extraPatch = {}){
        if (!activeProjectId || suppressControlSync) return;
        const state = getProjectState(activeProjectId);
        if (state) {
          state.controlsEdited = true;
        }
        enforceCacheControls();
        const zoomMinVal = Number(zoomMinInput?.value);
        const zoomMaxVal = Number(zoomMaxInput?.value);
        const parsedThrottle = Number.parseInt(String(throttleInput?.value || '').trim(), 10);
        const throttleSafe = Number.isFinite(parsedThrottle) ? Math.max(300, parsedThrottle) : 300;
        const prefsPatch = {
          cachePreferences: {
            mode: 'wmts',
            // UI shows AUTO, but backend expects a real CRS string or null.
            tileCrs: null,
            allowRemote: true,
            throttleMs: throttleSafe,
            updatedAt: new Date().toISOString()
          }
        };
        const zoomPatch = {
          zoom: {
            min: Number.isFinite(zoomMinVal) ? zoomMinVal : null,
            max: Number.isFinite(zoomMaxVal) ? zoomMaxVal : null,
            updatedAt: new Date().toISOString()
          }
        };
        queueProjectConfigSave(activeProjectId, deepMergeObjects(zoomPatch, deepMergeObjects(prefsPatch, extraPatch))); // merge extras afterwards
      }

      if (zoomMinInput) {
        zoomMinInput.addEventListener('change', () => emitControlConfigChange());
        zoomMinInput.addEventListener('blur', () => emitControlConfigChange());
      }
      if (zoomMaxInput) {
        zoomMaxInput.addEventListener('change', () => emitControlConfigChange());
        zoomMaxInput.addEventListener('blur', () => emitControlConfigChange());
      }
      if (modeSelect) {
        modeSelect.addEventListener('change', () => emitControlConfigChange());
      }
      if (tileCrsInput) {
        tileCrsInput.addEventListener('change', () => emitControlConfigChange());
        tileCrsInput.addEventListener('blur', () => emitControlConfigChange());
      }
      if (allowRemoteCheckbox) {
        allowRemoteCheckbox.addEventListener('change', () => emitControlConfigChange());
      }
      if (throttleInput) {
        throttleInput.addEventListener('change', () => emitControlConfigChange());
        throttleInput.addEventListener('blur', () => emitControlConfigChange());
      }

      function syncRemoteButtons(){
        const isAdminUser = !window.appState?.authEnabled || (window.appState.user && window.appState.user.role === 'admin');
        const cfgAllowRemote = (() => {
          try {
            if (!activeProjectId) return false;
            const cfg = projectConfigs.get(activeProjectId);
            return cfg && cfg.cachePreferences && cfg.cachePreferences.allowRemote === true;
          } catch (e) {
            return false;
          }
        })();
        const allowChecked = allowRemoteCheckbox ? !!allowRemoteCheckbox.checked : cfgAllowRemote;
        const active = allowChecked || isAdminUser;
        document.querySelectorAll('button[data-remote="1"]').forEach(btn => {
          btn.disabled = !active;
          if (active) {
            btn.title = isAdminUser && !allowChecked ? tr('Generate Tiles (admin override)') : tr('Generate Tiles');
            btn.setAttribute('aria-label', btn.title);
          } else {
            btn.title = tr('Remote layer. Enable "Allow remote" to cache.');
            btn.setAttribute('aria-label', tr('Remote layer. Enable "Allow remote" to cache.'));
          }
        });
      }

      async function loadLayers(options = {}) {
        const forceConfigReload = !!options.forceConfigReload;
        let loadLayersError = false;
        if (loadLayersRunning) {
          loadLayersQueued = true;
          loadLayersQueuedOptions = options ? { ...options } : {};
          return;
        }
        loadLayersRunning = true;
        loadLayersQueued = false;
        loadLayersQueuedOptions = null;
        layersEl.textContent = tr('Loading projects…');
        try {
          const r = await fetch('/projects');
          if (r.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          const data = await r.json();
          const projects = Array.isArray(data) ? data : (Array.isArray(data.projects) ? data.projects : []);
          
          console.log('Projects loaded:', { 
            count: projects.length, 
            authEnabled: data.authEnabled, 
            user: data.user,
            projects: projects.map(p => ({ id: p.id, isPublic: p.isPublic, access: p.access }))
          });
          
          window.appState = {
            authEnabled: data.authEnabled === true,
            user: data.user || null
          };
          // Ensure plugin clients are loaded after we know auth/user state and projects
          try {
            await loadPluginClients();
          } catch (e) {
            console.warn('loadPluginClients after projects failed:', String(e?.message || e));
          }
          
          // Fallback for legacy response
          if (Array.isArray(data)) {
             window.appState.authEnabled = false;
             window.appState.user = { role: 'admin' };
          }

           // Now that we have authoritative authEnabled/user from /projects, refresh header state.
           try { await checkAuthPlugin(); } catch {}

          const isAdmin = !window.appState.authEnabled || (window.appState.user && window.appState.user.role === 'admin');
          const uploadBtn = document.getElementById('upload_project_btn');
          const reloadBtn = document.getElementById('reload');
          if (uploadBtn) uploadBtn.style.display = isAdmin ? '' : 'none';
          if (reloadBtn) reloadBtn.style.display = isAdmin ? '' : 'none';

          if (projects.length === 0) {
            layersEl.innerHTML = '<div>' + tr('No projects in qgisprojects/') + '</div>';
            return;
          }
          layersEl.innerHTML = '';
          // cargar capas por proyecto
          for (const p of projects) {
            const state = getProjectState(p.id);
            const wrap = document.createElement('div');
            wrap.dataset.projectId = p.id;
            wrap.className = 'project-block';

            const heading = document.createElement('div');
            heading.className = 'project-heading';

            const contentId = `project-${toDomId(p.id)}-content`;
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'project-toggle';
            const projectLabel = escapeHtml(p.name || p.id || '');
            toggleBtn.innerHTML = `
              <span class="toggle-caret" aria-hidden="true">${ICONS.chevron}</span>
              <span class="heading-icon">${ICONS.project}</span>
              <span class="project-title">Project: ${projectLabel}</span>
            `;
            toggleBtn.setAttribute('aria-controls', contentId);
            toggleBtn.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
            toggleBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const next = !wrap.classList.contains('is-collapsed');
              setProjectCollapsed(p.id, next, { silent: true });
            });
            heading.appendChild(toggleBtn);

            if (isAdmin) {
              const headingActions = document.createElement('div');
              headingActions.style.marginLeft = 'auto';
              headingActions.style.display = 'flex';
              headingActions.style.gap = '8px';
              const downloadProjectBtn = makeIconButton(tr('Download project'), 'download');
              downloadProjectBtn.addEventListener('click', () => downloadProjectBundle(downloadProjectBtn, p));
              headingActions.appendChild(downloadProjectBtn);
              const deleteProjectBtn = makeIconButton('Delete project', 'trash', null, 'btn-danger');
              deleteProjectBtn.addEventListener('click', () => deleteProject(deleteProjectBtn, p));
              headingActions.appendChild(deleteProjectBtn);
              heading.appendChild(headingActions);
            }

            wrap.appendChild(heading);
            const listEl = document.createElement('div');
            listEl.className = 'list';
            listEl.id = contentId;
            wrap.appendChild(listEl);
            layersEl.appendChild(wrap);
            setProjectCollapsed(p.id, state.collapsed, { store: false, silent: true, element: wrap });
            try {
              const lr = await fetch('/projects/' + encodeURIComponent(p.id) + '/layers');
              if (lr.status === 401) {
                window.location.href = '/login?reason=session_expired';
                return;
              }
              const text = await lr.text();
              if (!lr.ok) {
                listEl.innerHTML = '<div class="error">' + tr('Failed to load layers: HTTP {status}', { status: lr.status }) + '</div>';
                showStatus(tr('Details: {text}', { text }), true);
                continue;
              }
              const json = JSON.parse(text);
              await renderProjectLayers(p, json, listEl, wrap, { forceConfigReload });
            } catch (e) {
              listEl.innerHTML = `<div class="error">${tr('Network error while loading project layers')}</div>`;
            }
          }
          if (!activeProjectId && projects.length) {
            setActiveProject(projects[0].id);
          }
        } catch (err) {
          loadLayersError = true;
          layersEl.innerHTML = '<div class="error">Network error: ' + String(err) + '</div>';
          showStatus('Network error: ' + String(err), true);
          console.error('Fetch /projects failed', err);
        }
        finally {
          loadLayersRunning = false;
          if (!loadLayersError) {
            clearStatus();
          }
          syncRemoteButtons();
          if (loadLayersQueued) {
            const queuedOptions = loadLayersQueuedOptions ? { ...loadLayersQueuedOptions } : {};
            loadLayersQueued = false;
            loadLayersQueuedOptions = null;
            setTimeout(() => loadLayers(queuedOptions), 0);
          }
        }
      }

      async function ensureProjectBlock(projectId, { projectMeta = null, forceConfigReload = false } = {}) {
        if (!projectId) return;
        let project = projectMeta || null;
        const existingWrap = findProjectWrap(projectId);
        if (!project) {
          try {
            const res = await fetch('/projects');
            const list = await res.json().catch(() => []);
            if (Array.isArray(list)) {
              project = list.find((item) => item && (item.id === projectId || item.name === projectId)) || null;
            }
          } catch (err) {
            console.warn('ensureProjectBlock failed to fetch project list', err);
          }
        }
        if (!project || !project.id) {
          if (existingWrap) {
            // Keep the current project visible if a targeted refresh temporarily
            // fails to find it; cache/purge jobs can briefly race with /projects.
            return;
          }
          extentStates.delete(projectId);
          projectConfigs.delete(projectId);
          if (activeProjectId === projectId) {
            activeProjectId = null;
            const firstWrap = layersEl.querySelector('[data-project-id]');
            if (firstWrap && firstWrap.dataset.projectId) {
              setActiveProject(firstWrap.dataset.projectId);
            }
          }
          if (!layersEl.querySelector('[data-project-id]')) {
            loadLayers({ forceConfigReload: true });
          }
          return;
        }
        const state = getProjectState(project.id);
        let wrap = findProjectWrap(project.id);
        let listEl = null;
        const contentId = `project-${toDomId(project.id)}-content`;
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.dataset.projectId = project.id;
          wrap.className = 'project-block';

          const heading = document.createElement('div');
          heading.className = 'project-heading';

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'project-toggle';
          toggleBtn.innerHTML = `
            <span class="toggle-caret" aria-hidden="true">${ICONS.chevron}</span>
            <span class="heading-icon">${ICONS.project}</span>
            <span class="project-title">Project: ${escapeHtml(project.name || project.id || '')}</span>
          `;
          toggleBtn.setAttribute('aria-controls', contentId);
          toggleBtn.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
          toggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const next = !wrap.classList.contains('is-collapsed');
            setProjectCollapsed(project.id, next, { silent: true });
          });
          heading.appendChild(toggleBtn);

          if (isAdmin) {
            const headingActions = document.createElement('div');
            headingActions.style.marginLeft = 'auto';
            headingActions.style.display = 'flex';
            headingActions.style.gap = '8px';
            const downloadProjectBtn = makeIconButton(tr('Download project'), 'download');
            downloadProjectBtn.addEventListener('click', () => downloadProjectBundle(downloadProjectBtn, project));
            headingActions.appendChild(downloadProjectBtn);
            const deleteProjectBtn = makeIconButton('Delete project', 'trash', null, 'btn-danger');
            deleteProjectBtn.addEventListener('click', () => deleteProject(deleteProjectBtn, project));
            headingActions.appendChild(deleteProjectBtn);
            heading.appendChild(headingActions);
          }

          wrap.appendChild(heading);
          listEl = document.createElement('div');
          listEl.className = 'list';
          listEl.id = contentId;
          wrap.appendChild(listEl);
          layersEl.appendChild(wrap);
          setProjectCollapsed(project.id, state.collapsed, { store: false, silent: true, element: wrap });
        } else {
          const toggleBtn = wrap.querySelector('.project-toggle');
          if (toggleBtn) {
            toggleBtn.setAttribute('aria-controls', contentId);
            const titleEl = toggleBtn.querySelector('.project-title');
            if (titleEl) {
              titleEl.textContent = 'Project: ' + (project.name || project.id || '');
            }
          }
          listEl = wrap.querySelector('.list');
          if (!listEl) {
            listEl = document.createElement('div');
            listEl.className = 'list';
            listEl.id = contentId;
            wrap.appendChild(listEl);
          } else {
            listEl.id = contentId;
          }
        }

        state.projectMeta = project;
        if (listEl) {
          listEl.innerHTML = '<div>' + tr('Loading projects…') + '</div>';
        }

        try {
          const lr = await fetch('/projects/' + encodeURIComponent(project.id) + '/layers');
          if (lr.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          const text = await lr.text();
          if (!lr.ok) {
            if (listEl) {
              listEl.innerHTML = '<div class="error">' + tr('Failed to load layers: HTTP {status}', { status: lr.status }) + '</div>';
            }
            showStatus(tr('Details: {text}', { text }), true);
            return;
          }
          const json = JSON.parse(text);
          if (listEl) {
            listEl.innerHTML = '';
          }
          await renderProjectLayers(project, json, listEl, wrap, { forceConfigReload });
          if (!activeProjectId || activeProjectId === project.id) {
            setActiveProject(project.id);
          }
        } catch (err) {
          if (listEl) {
            listEl.innerHTML = `<div class="error">${tr('Network error while loading project layers')}</div>`;
          }
        }
      }

      function scheduleProjectRefresh(projectId, { delayMs = 400, forceConfigReload = true } = {}) {
        if (!projectId) return;
        const timeout = Math.max(0, Number(delayMs) || 0);
        setTimeout(() => {
          ensureProjectBlock(projectId, { forceConfigReload }).catch((err) => {
            console.warn('scheduleProjectRefresh fallback reload', err);
            loadLayers({ forceConfigReload: true });
          });
        }, timeout);
      }

      function findLayerRowIn(container, layerName, kind = 'layer') {
        if (!container || !layerName) return null;
        const targetName = String(layerName);
        return Array.from(container.querySelectorAll('.layer')).find((node) => {
          return node?.dataset?.layerKind === kind && node?.dataset?.layerName === targetName;
        }) || null;
      }

      function findProjectLayerRow(projectId, layerName, kind = 'layer') {
        const wrap = findProjectWrap(projectId);
        if (!wrap) return null;
        const listEl = wrap.querySelector('.list');
        return findLayerRowIn(listEl, layerName, kind);
      }

      function snapshotProjectState(projectId) {
        const state = getProjectState(projectId);
        return {
          projectMeta: state.projectMeta,
          themes: state.themes,
          projectLayers: state.projectLayers,
          layerExtents: state.layerExtents,
          themeExtents: state.themeExtents,
          layerExtentUnion: state.layerExtentUnion,
          projectViewExtent: state.projectViewExtent,
          defaultMapExtent: state.defaultMapExtent,
          config: state.config,
          metaInfoEl: state.metaInfoEl,
          batchInfoEl: state.batchInfoEl,
          batchButton: state.batchButton,
          batchProgressEl: state.batchProgressEl,
          batchProgressBarEl: state.batchProgressBarEl,
          batchProgressTextEl: state.batchProgressTextEl,
          batchAbortBtn: state.batchAbortBtn,
          lastBatchStatus: state.lastBatchStatus
        };
      }

      function restoreProjectState(projectId, snapshot) {
        if (!snapshot) return;
        const state = getProjectState(projectId);
        state.projectMeta = snapshot.projectMeta;
        state.themes = snapshot.themes;
        state.projectLayers = snapshot.projectLayers;
        state.layerExtents = snapshot.layerExtents;
        state.themeExtents = snapshot.themeExtents;
        state.layerExtentUnion = snapshot.layerExtentUnion;
        state.projectViewExtent = snapshot.projectViewExtent;
        state.defaultMapExtent = snapshot.defaultMapExtent;
        state.config = snapshot.config;
        state.metaInfoEl = snapshot.metaInfoEl;
        state.batchInfoEl = snapshot.batchInfoEl;
        state.batchButton = snapshot.batchButton;
        state.batchProgressEl = snapshot.batchProgressEl;
        state.batchProgressBarEl = snapshot.batchProgressBarEl;
        state.batchProgressTextEl = snapshot.batchProgressTextEl;
        state.batchAbortBtn = snapshot.batchAbortBtn;
        state.lastBatchStatus = snapshot.lastBatchStatus;
      }

      async function reloadLayerRow(btn, project, layerName) {
        if (!btn || !project?.id || !layerName) return;
        let stateSnapshot = null;
        const initialDisabled = btn.disabled;
        const originalHtml = btn.innerHTML;
        const originalTitle = btn.title;
        const restoreButton = () => {
          btn.disabled = initialDisabled;
          btn.innerHTML = btn.dataset.iconHtml || originalHtml;
          btn.title = originalTitle;
          btn.removeAttribute('aria-busy');
        };

        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        btn.title = tr('Reloading layer: {layer}', { layer: layerName });
        btn.setAttribute('aria-busy', 'true');

        try {
          const res = await fetch('/projects/' + encodeURIComponent(project.id) + '/layers');
          if (res.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          const text = await res.text();
          if (!res.ok) {
            throw new Error(tr('Failed to load layers: HTTP {status}', { status: res.status }) + ' · ' + text);
          }

          const payload = JSON.parse(text);
          const layers = Array.isArray(payload) ? payload : (Array.isArray(payload?.layers) ? payload.layers : []);
          const targetLayer = layers.find((entry) => entry && entry.name === layerName);
          if (!targetLayer) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }
          stateSnapshot = snapshotProjectState(project.id);
          const tempTarget = document.createElement('div');
          await renderProjectLayers(project, { project: payload?.project || null, layers: [targetLayer], themes: [] }, tempTarget, null, {
            forceConfigReload: true,
            clearProjectInlineSlots: false,
            skipProjectChrome: true
          });
          const replacementRow = findLayerRowIn(tempTarget, layerName, 'layer');
          restoreProjectState(project.id, stateSnapshot);
          if (!replacementRow) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }

          const currentRow = findProjectLayerRow(project.id, layerName, 'layer');
          if (!currentRow) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }
          currentRow.replaceWith(replacementRow);
          showStatus(tr('Layer reloaded: {layer}', { layer: layerName }));
        } catch (err) {
          showStatus(tr('Failed to reload layer: {error}', { error: err?.message || String(err) }), true);
          console.error('reloadLayerRow failed', err);
          scheduleProjectRefresh(project.id, { delayMs: 0, forceConfigReload: true });
        } finally {
          if (stateSnapshot) restoreProjectState(project.id, stateSnapshot);
          restoreButton();
        }
      }

      async function reloadLayerRowSilent(projectId, layerName, { forceConfigReload = true } = {}) {
        if (!projectId || !layerName) return;
        let stateSnapshot = null;
        try {
          const state = getProjectState(projectId);
          const projectMeta = state?.projectMeta && state.projectMeta.id ? state.projectMeta : { id: projectId, name: projectId };

          const res = await fetch('/projects/' + encodeURIComponent(projectId) + '/layers');
          if (res.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          const text = await res.text();
          if (!res.ok) {
            throw new Error(tr('Failed to load layers: HTTP {status}', { status: res.status }) + ' · ' + text);
          }

          const payload = JSON.parse(text);
          const layers = Array.isArray(payload) ? payload : (Array.isArray(payload?.layers) ? payload.layers : []);
          const targetLayer = layers.find((entry) => entry && entry.name === layerName);
          if (!targetLayer) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }

          stateSnapshot = snapshotProjectState(projectId);
          const tempTarget = document.createElement('div');
          await renderProjectLayers(projectMeta, { project: payload?.project || null, layers: [targetLayer], themes: [] }, tempTarget, null, {
            forceConfigReload,
            clearProjectInlineSlots: false,
            skipProjectChrome: true
          });
          const replacementRow = findLayerRowIn(tempTarget, layerName, 'layer');
          restoreProjectState(projectId, stateSnapshot);
          if (!replacementRow) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }

          const currentRow = findProjectLayerRow(projectId, layerName, 'layer');
          if (!currentRow) {
            throw new Error(tr('Layer not found: {layer}', { layer: layerName }));
          }
          currentRow.replaceWith(replacementRow);
        } catch (err) {
          console.warn('reloadLayerRowSilent failed', err);
          scheduleProjectRefresh(projectId, { delayMs: 0, forceConfigReload: true });
        } finally {
          if (stateSnapshot) restoreProjectState(projectId, stateSnapshot);
        }
      }

      function showProjectReplaceDialog(conflictPayload = {}) {
        const lang = String(conflictPayload?.language || currentLang || 'en').toLowerCase();
        const isEs = lang.startsWith('es');
        const isSv = lang.startsWith('sv');

        const text = {
          title: conflictPayload?.title || (isEs ? 'Proyecto ya existe' : (isSv ? 'Projektet finns redan' : 'Project already exists')),
          message: conflictPayload?.message || (isEs
            ? 'Ya existe un proyecto con el mismo id. ¿Deseas reemplazarlo?'
            : (isSv ? 'Ett projekt med samma id finns redan. Vill du ersatta det?' : 'A project with the same id already exists. Do you want to replace it?')),
          hint: conflictPayload?.hint || (isEs
            ? 'Puedes elegir mantener o eliminar la configuracion y cache existentes.'
            : (isSv ? 'Du kan valja att behalla eller radera befintlig konfiguration och cache.' : 'You can choose to keep or delete existing configuration and cache.')),
          keepConfig: isEs ? 'Mantener configuracion existente' : (isSv ? 'Behall befintlig konfiguration' : 'Keep existing configuration'),
          keepCache: isEs ? 'Mantener cache existente' : (isSv ? 'Behall befintlig cache' : 'Keep existing cache'),
          replaceBtn: isEs ? 'Reemplazar' : (isSv ? 'Ersatt' : 'Replace'),
          cancelBtn: isEs ? 'Cancelar' : (isSv ? 'Avbryt' : 'Cancel')
        };

        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.style.position = 'fixed';
          overlay.style.inset = '0';
          overlay.style.background = 'rgba(2, 8, 23, 0.65)';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          overlay.style.zIndex = '4200';
          overlay.style.padding = '16px';

          const card = document.createElement('div');
          card.style.width = 'min(560px, 96vw)';
          card.style.background = '#0f1729';
          card.style.border = '1px solid #334766';
          card.style.borderRadius = '12px';
          card.style.padding = '16px';
          card.style.color = '#e6edf7';
          card.style.boxShadow = '0 20px 50px rgba(0,0,0,.45)';
          overlay.appendChild(card);

          const title = document.createElement('h3');
          title.textContent = text.title;
          title.style.margin = '0 0 8px 0';
          card.appendChild(title);

          const message = document.createElement('p');
          message.textContent = text.message;
          message.style.margin = '0 0 6px 0';
          message.style.lineHeight = '1.45';
          card.appendChild(message);

          if (text.hint) {
            const hint = document.createElement('p');
            hint.textContent = text.hint;
            hint.style.margin = '0 0 14px 0';
            hint.style.color = '#9fb0ca';
            hint.style.fontSize = '0.92rem';
            card.appendChild(hint);
          }

          const opts = document.createElement('div');
          opts.style.display = 'grid';
          opts.style.gap = '10px';
          opts.style.marginBottom = '14px';

          const keepCfgLabel = document.createElement('label');
          keepCfgLabel.style.display = 'flex';
          keepCfgLabel.style.gap = '10px';
          keepCfgLabel.style.alignItems = 'center';
          const keepCfg = document.createElement('input');
          keepCfg.type = 'checkbox';
          keepCfg.checked = true;
          keepCfgLabel.appendChild(keepCfg);
          keepCfgLabel.appendChild(document.createTextNode(text.keepConfig));

          const keepCacheLabel = document.createElement('label');
          keepCacheLabel.style.display = 'flex';
          keepCacheLabel.style.gap = '10px';
          keepCacheLabel.style.alignItems = 'center';
          const keepCache = document.createElement('input');
          keepCache.type = 'checkbox';
          keepCache.checked = true;
          keepCacheLabel.appendChild(keepCache);
          keepCacheLabel.appendChild(document.createTextNode(text.keepCache));

          opts.appendChild(keepCfgLabel);
          opts.appendChild(keepCacheLabel);
          card.appendChild(opts);

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '10px';
          actions.style.justifyContent = 'flex-end';

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.textContent = text.cancelBtn;
          cancelBtn.className = 'secondary';

          const replaceBtn = document.createElement('button');
          replaceBtn.type = 'button';
          replaceBtn.textContent = text.replaceBtn;
          replaceBtn.className = 'primary';

          actions.appendChild(cancelBtn);
          actions.appendChild(replaceBtn);
          card.appendChild(actions);

          const cleanup = () => {
            try {
              window.removeEventListener('keydown', onKey);
              overlay.remove();
            } catch {}
          };

          const done = (result) => {
            cleanup();
            resolve(result);
          };

          const onKey = (ev) => {
            if (ev.key === 'Escape') {
              done(null);
            }
          };

          window.addEventListener('keydown', onKey);
          overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) done(null);
          });
          cancelBtn.addEventListener('click', () => done(null));
          replaceBtn.addEventListener('click', () => {
            done({
              replaceExisting: true,
              keepExistingConfig: !!keepCfg.checked,
              keepExistingCache: !!keepCache.checked
            });
          });

          document.body.appendChild(overlay);
          replaceBtn.focus();
        });
      }

      function showPartialCacheResumeDialog({ targetName, cachedEntry = null } = {}) {
        const progress = cachedEntry && typeof cachedEntry === 'object' ? (cachedEntry.progress || null) : null;
        const savedMin = Number.isFinite(Number(progress?.zoom_min)) ? Number(progress.zoom_min)
          : (Number.isFinite(Number(cachedEntry?.last_zoom_min)) ? Number(cachedEntry.last_zoom_min) : null);
        const savedMax = Number.isFinite(Number(progress?.zoom_max)) ? Number(progress.zoom_max)
          : (Number.isFinite(Number(cachedEntry?.last_zoom_max)) ? Number(cachedEntry.last_zoom_max) : null);
        const zoomHint = savedMin != null && savedMax != null
          ? tr('Saved progress covers zoom {min}-{max}.', { min: savedMin, max: savedMax })
          : tr('Saved progress from the aborted cache run is available.');

        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.style.position = 'fixed';
          overlay.style.inset = '0';
          overlay.style.background = 'rgba(2, 8, 23, 0.65)';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          overlay.style.zIndex = '4200';
          overlay.style.padding = '16px';

          const card = document.createElement('div');
          card.style.width = 'min(560px, 96vw)';
          card.style.background = '#0f1729';
          card.style.border = '1px solid #334766';
          card.style.borderRadius = '12px';
          card.style.padding = '16px';
          card.style.color = '#e6edf7';
          card.style.boxShadow = '0 20px 50px rgba(0,0,0,.45)';
          overlay.appendChild(card);

          const title = document.createElement('h3');
          title.textContent = tr('Partial cache detected');
          title.style.margin = '0 0 8px 0';
          card.appendChild(title);

          const message = document.createElement('p');
          message.textContent = tr('Cache for {target} was not finished. Do you want to continue from the saved progress or replace it and start over?', { target: targetName || '' });
          message.style.margin = '0 0 6px 0';
          message.style.lineHeight = '1.45';
          card.appendChild(message);

          const hint = document.createElement('p');
          hint.textContent = zoomHint;
          hint.style.margin = '0 0 14px 0';
          hint.style.color = '#9fb0ca';
          hint.style.fontSize = '0.92rem';
          card.appendChild(hint);

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '10px';
          actions.style.justifyContent = 'flex-end';

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.textContent = tr('Cancel');
          cancelBtn.className = 'secondary';

          const resumeBtn = document.createElement('button');
          resumeBtn.type = 'button';
          resumeBtn.textContent = tr('Continue existing cache');
          resumeBtn.className = 'secondary';

          const replaceBtn = document.createElement('button');
          replaceBtn.type = 'button';
          replaceBtn.textContent = tr('Replace existing cache');
          replaceBtn.className = 'primary';

          const cleanup = () => {
            try {
              window.removeEventListener('keydown', onKey);
              overlay.remove();
            } catch {}
          };

          const done = (result) => {
            cleanup();
            resolve(result);
          };

          const onKey = (ev) => {
            if (ev.key === 'Escape') done(null);
          };

          window.addEventListener('keydown', onKey);
          overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) done(null);
          });
          cancelBtn.addEventListener('click', () => done(null));
          resumeBtn.addEventListener('click', () => done('resume'));
          replaceBtn.addEventListener('click', () => done('replace'));

          actions.appendChild(cancelBtn);
          actions.appendChild(resumeBtn);
          actions.appendChild(replaceBtn);
          card.appendChild(actions);
          document.body.appendChild(overlay);
          resumeBtn.focus();
        });
      }

      async function uploadProjectFile(btn, file) {
        if (!file) return;
        const originalDisabled = btn.disabled;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = tr('Uploading…');
        const ext = String(file.name || '').toLowerCase().split('.').pop();
        if (ext === 'zip') {
          showStatus(tr('Uploading bundle (.zip): {file}', { file: file.name }) + ' · ' + tr('Upload bundle requirement'));
        } else {
          showStatus(tr('Uploading project: {file}', { file: file.name }));
        }
        try {
          const submitUpload = async (options = null) => {
            const form = new FormData();
            form.append('project', file, file.name);
            if (options && typeof options === 'object') {
              if (Object.prototype.hasOwnProperty.call(options, 'replaceExisting')) {
                form.append('replaceExisting', options.replaceExisting ? '1' : '0');
              }
              if (Object.prototype.hasOwnProperty.call(options, 'keepExistingConfig')) {
                form.append('keepExistingConfig', options.keepExistingConfig ? '1' : '0');
              }
              if (Object.prototype.hasOwnProperty.call(options, 'keepExistingCache')) {
                form.append('keepExistingCache', options.keepExistingCache ? '1' : '0');
              }
            }
            const response = await fetch('/projects', { method: 'POST', body: form });
            const payload = await response.json().catch(() => null);
            return { response, payload };
          };

          let { response: res, payload: data } = await submitUpload();

          if (!res.ok && res.status === 409 && (data?.code === 'PROJECT_ALREADY_EXISTS' || data?.error === 'project_already_exists')) {
            const decision = await showProjectReplaceDialog(data || {});
            if (!decision) {
              showStatus(tr('Upload cancelled by user.'));
              return;
            }

            ({ response: res, payload: data } = await submitUpload(decision));
          }

          if (!res.ok) {
            let detail = data?.error || data?.details || res.statusText;
            if (data?.error === 'zip_missing_project') {
              detail = 'ZIP must contain exactly one QGIS project (.qgz or .qgs).';
            } else if (data?.error === 'zip_multiple_projects') {
              detail = 'ZIP contains multiple QGIS projects (.qgz/.qgs). Keep only one.';
            } else if (data?.error === 'project_already_exists') {
              detail = data?.message || 'Project already exists.';
            }
            showStatus(tr('Upload failed: {error}', { error: detail }), true);
            return;
          }
          const projectId = data?.id || null;
          if (projectId) {
            extentStates.delete(projectId);
          }
          showStatus(tr('Project uploaded: {project}', { project: projectId || file.name }));
          try {
            if (projectId) {
              await ensureProjectBlock(projectId, {
                projectMeta: {
                  id: projectId,
                  name: projectId
                },
                forceConfigReload: true
              });
            } else {
              loadLayers({ forceConfigReload: true });
            }
          } catch (refreshErr) {
            console.warn('Targeted refresh failed after upload', refreshErr);
            if (projectId) {
              scheduleProjectRefresh(projectId, { delayMs: 900, forceConfigReload: true });
            } else {
              loadLayers({ forceConfigReload: true });
            }
          }
        } catch (err) {
          showStatus(tr('Network error: {error}', { error: err }), true);
        } finally {
          btn.disabled = originalDisabled;
          btn.textContent = originalText;
        }
      }

      // Gestión de jobs activos (persistencia visual tras recarga)
      const jobMonitors = new Map(); // id -> {timer, inner, txt}
      const abortConfirmedAnnouncements = new Set();
      const inlineJobSlots = new Map(); // key -> { projectId, targetMode, targetName, button, host, stopBtn, progressEl, progressBarEl, progressTextEl, currentJobId }
      const inlineJobMonitors = new Map(); // key -> { jobId, timer }
      const latestInlineJobs = new Map(); // key -> running job snapshot

      function makeInlineJobSlotKey(projectId, targetMode, targetName) {
        return `${projectId || ''}:${targetMode || 'layer'}:${targetName || ''}`;
      }

      function isInlineManagedGenerateJob(job) {
        if (!job || !job.project || !job.targetName) return false;
        const targetMode = job.targetMode || 'layer';
        return targetMode === 'layer' || targetMode === 'theme';
      }

      function parseJobProgress(stdout) {
        if (!stdout) return null;
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        let last = null;
        for (const line of lines) {
          const start = line.indexOf('{');
          const end = line.lastIndexOf('}');
          if (start !== -1 && end !== -1 && end > start) {
            try {
              const obj = JSON.parse(line.slice(start, end + 1));
              if (obj && (obj.progress || obj.status || obj.debug || typeof obj.percent === 'number')) last = obj;
            } catch {}
          }
        }
        return last;
      }

      function restoreInlineSlotButton(slot) {
        if (!slot?.button) return;
        const btn = slot.button;
        btn.disabled = false;
        btn.innerHTML = btn.dataset.iconHtml || btn.innerHTML;
        const originalTitle = btn.dataset.inlineOriginalTitle;
        if (originalTitle) btn.title = originalTitle;
        btn.removeAttribute('aria-busy');
        delete btn.dataset.inlineBusy;
      }

      function clearInlineJobMonitor(slotKey) {
        const monitor = inlineJobMonitors.get(slotKey);
        if (monitor?.timer) {
          try { clearInterval(monitor.timer); } catch {}
        }
        inlineJobMonitors.delete(slotKey);
      }

      function clearInlineJobUi(slot, { restoreButton = true, clearMonitor = true } = {}) {
        if (!slot) return;
        if (clearMonitor) clearInlineJobMonitor(slot.key);
        try { slot.stopBtn?.remove(); } catch {}
        try { slot.progressEl?.remove(); } catch {}
        slot.stopBtn = null;
        slot.progressEl = null;
        slot.progressBarEl = null;
        slot.progressTextEl = null;
        slot.currentJobId = null;
        slot.lastPercent = null;
        slot.lastStatus = null;
        if (restoreButton) restoreInlineSlotButton(slot);
      }

      function ensureInlineJobUi(slot, jobId) {
        if (!slot?.host || !slot?.button) return null;
        if (!slot.button.dataset.inlineOriginalTitle) {
          slot.button.dataset.inlineOriginalTitle = slot.button.title || '';
        }
        slot.button.disabled = true;
        slot.button.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        slot.button.setAttribute('aria-busy', 'true');
        slot.button.dataset.inlineBusy = '1';
        slot.currentJobId = jobId;

        if (!slot.progressEl || !slot.progressEl.isConnected) {
          const progressEl = document.createElement('span');
          progressEl.className = 'progress-pill';
          progressEl.dataset.inlineJob = slot.key;
          const bar = document.createElement('span');
          bar.className = 'progress-bar';
          const barInner = document.createElement('i');
          bar.appendChild(barInner);
          const txt = document.createElement('span');
          txt.textContent = '...';
          progressEl.appendChild(bar);
          progressEl.appendChild(txt);
          slot.host.appendChild(progressEl);
          slot.progressEl = progressEl;
          slot.progressBarEl = barInner;
          slot.progressTextEl = txt;
        }

        if (!slot.stopBtn || !slot.stopBtn.isConnected) {
          const stopBtn = document.createElement('button');
          stopBtn.type = 'button';
          stopBtn.className = 'btn btn-danger';
          stopBtn.dataset.inlineJob = slot.key;
          slot.host.appendChild(stopBtn);
          slot.stopBtn = stopBtn;
        }

        slot.stopBtn.textContent = tr('Abort');
        slot.stopBtn.disabled = false;
        slot.stopBtn.onclick = async () => {
          slot.stopBtn.disabled = true;
          showStatus(tr('Aborting job {id}', { id: jobId }));
          try {
            const r = await fetch('/generate-cache/' + encodeURIComponent(jobId), { method: 'DELETE' });
            const resjson = await r.json().catch(() => null);
            if (!r.ok) {
              showStatus(tr('Abort failed: {error}', { error: resjson?.error || r.statusText }), true);
              slot.stopBtn.disabled = false;
            }
          } catch (err) {
            showStatus(tr('Network error while aborting: {error}', { error: err }), true);
            slot.stopBtn.disabled = false;
          }
        };

        return slot;
      }

      function updateInlineJobUi(slot, { percent = null, status = null } = {}) {
        if (!slot?.progressBarEl || !slot?.progressTextEl) return;
        const pct = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Number(percent))) : null;
        slot.lastPercent = pct;
        slot.lastStatus = status || null;
        if (pct != null) slot.progressBarEl.style.width = pct + '%';
        const statusText = status ? formatJobStatusLabel(status) : '';
        slot.progressTextEl.textContent = (pct != null ? (pct + '%') : '...') + (statusText ? (' · ' + statusText) : '');
      }

      function startInlineJobMonitor(slot, jobId, { onDone } = {}) {
        if (!slot?.key || !jobId) return;
        const existing = inlineJobMonitors.get(slot.key);
        if (existing?.jobId === jobId) {
          ensureInlineJobUi(slot, jobId);
          updateInlineJobUi(slot, { percent: slot.lastPercent, status: slot.lastStatus });
          return;
        }
        if (existing) clearInlineJobMonitor(slot.key);
        ensureInlineJobUi(slot, jobId);
        const timer = setInterval(async () => {
          try {
            if (!slot.host?.isConnected || !slot.button?.isConnected) {
              clearInlineJobMonitor(slot.key);
              return;
            }
            const r = await fetch('/generate-cache/' + encodeURIComponent(jobId) + '?tail=50000');
            if (!r.ok) {
              if (r.status === 404) {
                latestInlineJobs.delete(slot.key);
                clearInlineJobUi(slot, { restoreButton: true, clearMonitor: true });
                if (typeof onDone === 'function') onDone('missing');
              }
              return;
            }
            const job = await r.json().catch(() => null);
            const last = parseJobProgress(job?.stdout || '');
            const pct = last?.percent != null ? Number(last.percent) : (job?.status === 'completed' ? 100 : null);
            updateInlineJobUi(slot, { percent: pct, status: job?.status || null });
            if (job?.status && ['completed', 'error', 'aborted'].includes(job.status)) {
              if (job.status === 'aborted' && !abortConfirmedAnnouncements.has(String(jobId))) {
                abortConfirmedAnnouncements.add(String(jobId));
                showStatus(tr('Abort confirmed by worker for job {id}', { id: jobId }));
              }
              latestInlineJobs.delete(slot.key);
              clearInlineJobUi(slot, { restoreButton: true, clearMonitor: true });
              if (typeof onDone === 'function') onDone(job.status);
            }
          } catch {}
        }, 1200);
        inlineJobMonitors.set(slot.key, { jobId, timer });
      }

      function clearInlineJobSlotsForProject(projectId) {
        const prefix = `${projectId || ''}:`;
        Array.from(inlineJobSlots.entries()).forEach(([key, slot]) => {
          if (!key.startsWith(prefix)) return;
          clearInlineJobUi(slot, { restoreButton: false, clearMonitor: true });
          inlineJobSlots.delete(key);
        });
      }

      function registerInlineJobSlot({ projectId, targetMode = 'layer', targetName, button, host }) {
        if (!projectId || !targetName || !button || !host) return null;
        const key = makeInlineJobSlotKey(projectId, targetMode, targetName);
        const prev = inlineJobSlots.get(key);
        if (prev && prev.button !== button) {
          clearInlineJobUi(prev, { restoreButton: false, clearMonitor: true });
        }
        const slot = {
          key,
          projectId,
          targetMode,
          targetName,
          button,
          host,
          stopBtn: null,
          progressEl: null,
          progressBarEl: null,
          progressTextEl: null,
          currentJobId: null,
          lastPercent: null,
          lastStatus: null
        };
        inlineJobSlots.set(key, slot);
        const runningJob = latestInlineJobs.get(key);
        if (runningJob?.id) {
          startInlineJobMonitor(slot, runningJob.id, {
            onDone: () => scheduleProjectRefresh(projectId, { delayMs: 600, forceConfigReload: true })
          });
        }
        return slot;
      }

      function syncInlineJobSlots(list) {
        const nextJobs = new Map();
        (Array.isArray(list) ? list : []).forEach((job) => {
          if (!isInlineManagedGenerateJob(job)) return;
          nextJobs.set(makeInlineJobSlotKey(job.project, job.targetMode || 'layer', job.targetName), job);
        });

        nextJobs.forEach((job, key) => latestInlineJobs.set(key, job));

        inlineJobSlots.forEach((slot, key) => {
          const job = nextJobs.get(key);
          if (!job?.id) {
            // Keep the inline monitor alive when /generate-cache/running temporarily omits
            // an active job; the per-job endpoint remains the source of truth.
            return;
          }
          startInlineJobMonitor(slot, job.id, {
            onDone: () => scheduleProjectRefresh(slot.projectId, { delayMs: 600, forceConfigReload: true })
          });
        });

        Array.from(latestInlineJobs.keys()).forEach((key) => {
          if (nextJobs.has(key)) return;
          const slot = inlineJobSlots.get(key);
          const monitor = inlineJobMonitors.get(key);
          if (slot?.currentJobId || monitor?.jobId) return;
          latestInlineJobs.delete(key);
        });
      }

      function reapplyInlineJobSlotsFromCache() {
        if (!latestInlineJobs.size) return;
        syncInlineJobSlots(Array.from(latestInlineJobs.values()));
      }

      function renderJobsList(list, onDemandStatus = null){
        jobsList.innerHTML = '';
        const visibleJobs = Array.isArray(list) ? list.filter((job) => !isInlineManagedGenerateJob(job)) : [];
        const hasGenerateJobs = visibleJobs.length > 0;
        const od = onDemandStatus && typeof onDemandStatus === 'object' ? onDemandStatus : null;
        const odActive = od && Number.isFinite(Number(od.active)) ? Number(od.active) : 0;
        const odQueued = od && Number.isFinite(Number(od.queued)) ? Number(od.queued) : 0;
        const odPoolQueued = od && Number.isFinite(Number(od.poolQueued)) ? Number(od.poolQueued) : 0;
        const odPausedMs = od && Number.isFinite(Number(od.pausedMs)) ? Number(od.pausedMs) : 0;
        const hasOnDemandActivity = (odActive + odQueued + odPoolQueued) > 0 || odPausedMs > 0;

        if (!hasGenerateJobs && !hasOnDemandActivity) {
          jobsWrap.style.display = 'none';
          for (const m of jobMonitors.values()) { try { clearInterval(m.timer); } catch{} }
          jobMonitors.clear();
          return;
        }

        jobsWrap.style.display = '';

        if (hasOnDemandActivity) {
          const row = document.createElement('div');
          row.className = 'job';
          row.id = 'job-ondemand';

          const info = document.createElement('div');
          info.className = 'job-info';
          const bits = [];
          bits.push(tr('Active: {count}', { count: odActive }));
          bits.push(tr('Queued: {count}', { count: odQueued }));
          if (odPoolQueued) bits.push(tr('Pool: {count}', { count: odPoolQueued }));
          if (odPausedMs > 0) bits.push(tr('Paused'));
          info.innerHTML = `<div><strong>${escapeHtml(tr('On-demand tiles'))}</strong> <span class="info">· ${bits.map((bit) => escapeHtml(bit)).join(' · ')}</span></div>` +
                           `<div class="info">(${escapeHtml(tr('viewer / WMTS on-demand'))})</div>`;

          const right = document.createElement('div');
          right.style.display = 'flex';
          right.style.alignItems = 'center';
          right.style.gap = '8px';
          const pill = document.createElement('span');
          pill.className = 'progress-pill';
          const bar = document.createElement('span');
          bar.className = 'progress-bar';
          const inner = document.createElement('i');
          bar.appendChild(inner);
          const txt = document.createElement('span');
          txt.textContent = `${odActive}/${odQueued}`;
          pill.appendChild(bar);
          pill.appendChild(txt);
          const pct = odActive > 0 ? 100 : (odQueued > 0 ? 40 : 0);
          inner.style.width = pct + '%';

          const abortBtn = document.createElement('button');
          abortBtn.className = 'btn btn-danger';
          abortBtn.textContent = tr('Abort');
          abortBtn.onclick = async () => {
            abortBtn.disabled = true;
            showStatus(tr('Aborting on-demand rendering…'));
            try {
              const r = await fetch('/on-demand/abort-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              });
              if (!r.ok) showStatus(tr('Failed to abort on-demand rendering'), true);
            } catch (e) {
              showStatus(tr('Network error while aborting on-demand: {error}', { error: e }), true);
            } finally {
              abortBtn.disabled = true;
            }
          };

          right.appendChild(pill);
          right.appendChild(abortBtn);
          row.appendChild(info);
          row.appendChild(right);
          jobsList.appendChild(row);
        }

        const seen = new Set();
        visibleJobs.forEach(j => {
          if (!j || !j.id) return;
          seen.add(j.id);
          const existing = jobMonitors.get(j.id);
          const isNewJob = !existing;
          if (existing && existing.timer) {
            try { clearInterval(existing.timer); } catch {}
          }
          const row = document.createElement('div');
          row.className = 'job';
          row.id = 'job-' + j.id;
          row.dataset.project = j.project || '';
          row.dataset.trigger = j.trigger || '';

          const info = document.createElement('div');
          info.className = 'job-info';
          const detailBits = [];
          detailBits.push('project: ' + escapeHtml(j.project || '-'));
          const triggerToken = j.trigger || '';
          if (triggerToken && triggerToken !== 'manual') detailBits.push('trigger: ' + escapeHtml(formatTriggerLabel(triggerToken)));
          if (typeof j.batchIndex === 'number' && typeof j.batchTotal === 'number' && j.batchTotal > 0) {
            detailBits.push('batch ' + (j.batchIndex + 1) + '/' + j.batchTotal);
          } else if (typeof j.batchTotal === 'number' && j.batchTotal > 0) {
            detailBits.push('batch total ' + j.batchTotal);
          }
          const subtitle = detailBits.length ? ` <span class="info">· ${detailBits.join(' · ')}</span>` : '';
          info.innerHTML = `<div><strong>${escapeHtml(j.layer || j.targetName || 'Job')}</strong>${subtitle}</div>` +
                           `<div class="info">id: ${escapeHtml(String(j.id))}</div>`;

          const right = document.createElement('div');
          right.style.display = 'flex';
          right.style.alignItems = 'center';
          right.style.gap = '8px';
          const pill = document.createElement('span');
          pill.className = 'progress-pill';
          const bar = document.createElement('span');
          bar.className = 'progress-bar';
          const inner = document.createElement('i');
          bar.appendChild(inner);
          const txt = document.createElement('span');
          txt.textContent = '...';
          pill.appendChild(bar);
          pill.appendChild(txt);

          const abortBtn = document.createElement('button');
          abortBtn.className = 'btn btn-danger';
          abortBtn.textContent = tr('Abort');
          abortBtn.onclick = async () => {
            abortBtn.disabled = true;
            showStatus(tr('Aborting job {id}', { id: j.id }));
            try {
              const r = await fetch('/generate-cache/' + encodeURIComponent(j.id), { method: 'DELETE' });
              if (!r.ok) showStatus(tr('Failed to abort job'), true);
            } catch (e) {
              showStatus(tr('Network error while aborting: {error}', { error: e }), true);
            }
          };

          right.appendChild(pill);
          right.appendChild(abortBtn);
          row.appendChild(info);
          row.appendChild(right);
          jobsList.appendChild(row);
          if (isNewJob && j.trigger && String(j.trigger).toLowerCase() === 'timer') {
            const label = j.layer || j.targetName || j.id;
            showStatus(tr('Timer recache started for {name}', { name: label }));
          }
          if (j.project) {
            try { refreshProjectBatchStatus(j.project); } catch {}
          }

          const timer = setInterval(async () => {
            try {
              if (!document.getElementById('job-' + j.id)) {
                clearInterval(timer);
                return;
              }
              const r = await fetch('/generate-cache/' + encodeURIComponent(j.id) + '?tail=50000');
              if (!r.ok) throw new Error('http ' + r.status);
              const det = await r.json();
              let pct = null;
              const status = det.status;
              const last = (function(stdout){
                if (!stdout) return null;
                const lines = stdout.split(/\r?\n/).filter(Boolean);
                let lastLine = null;
                for (const line of lines){
                  const s = line.indexOf('{'), e = line.lastIndexOf('}');
                  if (s !== -1 && e !== -1 && e > s) {
                    try { const o = JSON.parse(line.slice(s, e + 1)); if (o && (o.progress || o.status || o.debug)) lastLine = o; } catch {}
                  }
                }
                return lastLine;
              })(det.stdout || '');
              if (last && typeof last.percent === 'number') pct = Math.max(0, Math.min(100, last.percent));
              if (status === 'completed' && (pct == null || pct < 100)) pct = 100;
              if (pct != null) inner.style.width = pct + '%';
              txt.textContent = (pct != null ? (pct + '%') : '...') + (status ? (' · ' + formatJobStatusLabel(status)) : '');
              if (status && ['completed', 'error', 'aborted'].includes(status)) {
                if (status === 'aborted' && !abortConfirmedAnnouncements.has(String(j.id))) {
                  abortConfirmedAnnouncements.add(String(j.id));
                  showStatus(tr('Abort confirmed by worker for job {id}', { id: j.id }));
                }
                clearInterval(timer);
                jobMonitors.delete(j.id);
                setTimeout(() => {
                  try { row.remove(); } catch {}
                  if (!jobsList.children.length) jobsWrap.style.display = 'none';
                }, 2000);
                if (j.project) {
                  scheduleProjectRefresh(j.project, { forceConfigReload: true });
                } else {
                  try { loadLayers({ forceConfigReload: true }); } catch {}
                }
              }
            } catch {}
          }, 1200);
          jobMonitors.set(j.id, { timer, inner, txt, info });
        });
        for (const id of Array.from(jobMonitors.keys())) {
          if (!seen.has(id)) {
            const monitor = jobMonitors.get(id);
            if (monitor && monitor.timer) { try { clearInterval(monitor.timer); } catch {} }
            jobMonitors.delete(id);
          }
        }
      }

      async function refreshJobs(){
        try{
          // Only admins should poll job endpoints. When auth is enabled and user is not admin,
          // these endpoints return 401/403 and would spam the console.
          const authEnabled = window.appState && typeof window.appState.authEnabled === 'boolean'
            ? window.appState.authEnabled
            : null;
          if (authEnabled == null) return; // appState not ready yet

          const isAdmin = !authEnabled || (window.appState.user && window.appState.user.role === 'admin');
          if (!isAdmin) {
            if (typeof jobsWrap !== 'undefined' && jobsWrap) jobsWrap.style.display = 'none';
            return;
          }

          const [rJobs, rOnDemand] = await Promise.all([
            fetch('/generate-cache/running'),
            fetch('/on-demand/status')
          ]);

          if (rJobs && (rJobs.status === 401 || rJobs.status === 403) || (rOnDemand && (rOnDemand.status === 401 || rOnDemand.status === 403))) {
            // Session expired or no permission; avoid tight 401 loops.
            if (authEnabled) {
              window.location.href = '/login?reason=session_expired';
              return;
            }
            if (typeof jobsWrap !== 'undefined' && jobsWrap) jobsWrap.style.display = 'none';
            return;
          }
          const list = rJobs && rJobs.ok ? await rJobs.json() : [];
          const od = rOnDemand && rOnDemand.ok ? await rOnDemand.json().catch(()=>null) : null;
          syncInlineJobSlots(list);
          renderJobsList(list, od);
        }catch{}
      }

  async function renderProjectLayers(project, payload, targetEl, wrapEl, { forceConfigReload = false, clearProjectInlineSlots = true, skipProjectChrome = false } = {}) {
        const projectMeta = (!Array.isArray(payload) && payload && typeof payload === 'object' && Array.isArray(payload.layers)) ? payload.project : null;
  const layers = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.layers) ? payload.layers : []);
  const themes = payload && Array.isArray(payload.themes) ? payload.themes : [];
        const parent = wrapEl || targetEl.parentElement;
    const state = getProjectState(project.id);
      if (clearProjectInlineSlots) clearInlineJobSlotsForProject(project.id);
    state.projectMeta = projectMeta;
    state.themes = themes;
    state.projectLayers = layers;
    state.layerExtents = new Map();
    state.themeExtents = new Map();
    state.layerExtentUnion = null;

        // Determine user permissions
        const isAdmin = !window.appState.authEnabled || (window.appState.user && window.appState.user.role === 'admin');
        const canView = isAdmin || project.isPublic || (window.appState.user && project.allowedRoles && project.allowedRoles.includes('authenticated')) || (window.appState.user && project.allowedUsers && project.allowedUsers.includes(window.appState.user.id));

        const safeXmlName = (value) => {
          const raw = (value == null ? '' : String(value)).trim();
          if (!raw) return '_';
          let out = raw.replace(/[^A-Za-z0-9_.-]+/g, '_');
          if (!/^[A-Za-z_]/.test(out)) out = '_' + out;
          if (out.toLowerCase().startsWith('xml')) out = '_' + out;
          return out;
        };

        const isVectorLayerLike = (layer) => {
          if (!layer) return false;
          if (layer.kind === 'vector' || layer.kind === 'VectorLayer') return true;
          const typeToken = String(layer.type || '').toUpperCase();
          if (layer.geometry_type && !['XYZ', 'OSM', 'WMS', 'WMTS', 'TILE', 'RASTER'].includes(typeToken)) return true;
          return false;
        };

        const hasVectorLayers = Array.isArray(layers) && layers.some((l) => isVectorLayerLike(l));

        const metaViewExtent = normalizeExtentList(projectMeta && projectMeta.view_extent_wgs84);
        const metaExtentDefault = normalizeExtentList(projectMeta && projectMeta.extent_wgs84);
        state.projectViewExtent = metaViewExtent ? metaViewExtent.slice() : null;
  const projectConfig = await loadProjectConfig(project.id, { force: forceConfigReload });
        let hydratedExtent = null;
        if (projectConfig) {
          state.config = projectConfig;
          const hydration = hydrateStateExtentFromConfig(project.id, projectConfig);
          hydratedExtent = hydration?.wgsExtent || null;
        } else {
          const hydration = hydrateStateExtentFromConfig(project.id, null);
          hydratedExtent = hydration?.wgsExtent || null;
        }
        if (hydratedExtent) {
          state.defaultMapExtent = hydratedExtent.slice();
        } else if (state.projectViewExtent) {
          state.defaultMapExtent = state.projectViewExtent.slice();
        } else if (metaExtentDefault) {
          state.defaultMapExtent = metaExtentDefault.slice();
        } else {
          state.defaultMapExtent = null;
        }

        if (parent && !skipProjectChrome) {
          const existingMeta = parent.querySelector('[data-role="project-meta"]');
          if (existingMeta) existingMeta.remove();
          const existingSettingsHost = parent.querySelector('[data-role="project-settings-host"]');
          if (existingSettingsHost) existingSettingsHost.remove();
          state.metaInfoEl = null;
          const existingBatch = parent.querySelector('[data-role="project-batch"]');
          if (existingBatch) existingBatch.remove();
          state.batchInfoEl = null;
          state.batchButton = null;
          state.batchProgressEl = null;
          state.batchProgressBarEl = null;
          state.batchProgressTextEl = null;
          state.batchAbortBtn = null;
          state.lastBatchStatus = null;
          setProjectBatchPolling(project.id, false);
          const existingExtent = parent.querySelector('[data-role="project-extent"]');
          if (existingExtent) {
            if (state.map) {
              try { state.map.remove(); } catch {}
              state.map = null;
            }
            existingExtent.remove();
          }

          const extentContainer = document.createElement('div');
          extentContainer.dataset.role = 'project-extent';
          extentContainer.dataset.open = '0';
          extentContainer.style.display = 'none';
          extentContainer.style.margin = '0 0 12px 0';


          const metaRow = document.createElement('div');
          metaRow.dataset.role = 'project-meta';
          metaRow.style.display = 'flex';
          metaRow.style.alignItems = 'center';
          metaRow.style.justifyContent = 'space-between';
          metaRow.style.gap = '12px';
          metaRow.style.margin = '6px 0 8px 0';

          const leftMeta = document.createElement('div');
          leftMeta.className = 'meta';
          metaRow.appendChild(leftMeta);
          state.metaInfoEl = leftMeta;
          refreshProjectMetaInfo(project, projectMeta, state.config);

          const controlsBox = document.createElement('div');
          controlsBox.className = 'project-service-boxes';

          // isAdmin and canView already defined at top of function - no need to redefine

          if (canView) {
            // --- Raster group ---
            const rasterGroup = document.createElement('div');
            rasterGroup.className = 'project-service-group';
            const rasterLabel = document.createElement('span');
            rasterLabel.className = 'project-service-group__label';
            rasterLabel.textContent = tr('Raster');
            rasterLabel.setAttribute('data-i18n', 'Raster');
            rasterGroup.appendChild(rasterLabel);

            const copyWmtsBtn = document.createElement('button');
            copyWmtsBtn.className = 'btn btn-outline';
            copyWmtsBtn.type = 'button';
            copyWmtsBtn.textContent = tr('Copy WMTS URL');
            copyWmtsBtn.setAttribute('data-i18n', 'Copy WMTS URL');
            copyWmtsBtn.addEventListener('click', () => {
              const wmtsUrl = withApiKey(`${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}`, project);
              navigator.clipboard.writeText(wmtsUrl).then(() => {
                showStatus('WMTS capabilities URL copied: ' + wmtsUrl);
              }).catch(err => {
                showStatus('Copy failed: ' + String(err), true);
              });
            });
            rasterGroup.appendChild(copyWmtsBtn);

            const copyWmsBtn = document.createElement('button');
            copyWmsBtn.className = 'btn btn-outline';
            copyWmsBtn.type = 'button';
            copyWmsBtn.textContent = tr('Copy WMS URL');
            copyWmsBtn.setAttribute('data-i18n', 'Copy WMS URL');
            copyWmsBtn.addEventListener('click', () => {
              const wmsUrl = withApiKey(`${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}`, project);
              navigator.clipboard.writeText(wmsUrl).then(() => {
                showStatus(tr('WMS URL copied to clipboard'));
              }).catch(err => {
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
            });
            rasterGroup.appendChild(copyWmsBtn);

            // --- Vector group ---
            const vectorGroup = document.createElement('div');
            vectorGroup.className = 'project-service-group';
            vectorGroup.dataset.role = 'vector-controls';
            const vectorLabel = document.createElement('span');
            vectorLabel.className = 'project-service-group__label';
            vectorLabel.textContent = tr('Vector');
            vectorLabel.setAttribute('data-i18n', 'Vector');
            vectorGroup.appendChild(vectorLabel);

            const copyWfsBtn = document.createElement('button');
            copyWfsBtn.className = 'btn btn-outline';
            copyWfsBtn.type = 'button';
            copyWfsBtn.textContent = tr('Copy WFS URL');
            copyWfsBtn.setAttribute('data-i18n', 'Copy WFS URL');
            copyWfsBtn.addEventListener('click', () => {
              const wfsUrl = withApiKey(`${window.location.origin}/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}`, project);
              navigator.clipboard.writeText(wfsUrl).then(() => {
                showStatus(tr('WFS URL copied to clipboard'));
              }).catch(err => {
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
            });
            if (hasVectorLayers) {
              vectorGroup.appendChild(copyWfsBtn);
            } else {
              const noVector = document.createElement('span');
              noVector.className = 'meta';
              noVector.textContent = tr('No vector layers in this project');
              vectorGroup.appendChild(noVector);
            }

            // Keep stable vertical order: Vector on top, Raster below.
            controlsBox.appendChild(vectorGroup);
            controlsBox.appendChild(rasterGroup);
          }

          metaRow.appendChild(controlsBox);

          parent.insertBefore(metaRow, targetEl);
          parent.insertBefore(extentContainer, targetEl);

          const extentToggle = document.createElement('button');
          extentToggle.className = 'btn btn-outline';
          extentToggle.type = 'button';
          const updateToggleLabel = () => {
            extentToggle.textContent = extentContainer.dataset.open === '1' ? tr('Hide extent map') : tr('Show extent map');
          };
          extentToggle.onclick = () => {
            toggleProjectExtentPanel(project, projectMeta, extentContainer)
              .catch(err => console.error('Extent panel error', err))
              .finally(updateToggleLabel);
          };
          updateToggleLabel();

          if (isAdmin) {
            const batchRow = document.createElement('div');
            batchRow.dataset.role = 'project-batch';
            batchRow.style.display = 'flex';
            batchRow.style.alignItems = 'center';
            batchRow.style.justifyContent = 'space-between';
            batchRow.style.gap = '12px';
            batchRow.style.margin = '4px 0 10px 0';
            const batchInfo = document.createElement('div');
            batchInfo.className = 'meta';
            batchInfo.textContent = tr('Project cache idle');
            const batchActions = document.createElement('div');
            batchActions.style.display = 'flex';
            batchActions.style.alignItems = 'center';
            batchActions.style.gap = '8px';

            const batchProgress = document.createElement('span');
            batchProgress.className = 'progress-pill';
            batchProgress.style.display = 'none';
            const batchProgressBar = document.createElement('span');
            batchProgressBar.className = 'progress-bar';
            const batchProgressBarInner = document.createElement('i');
            batchProgressBar.appendChild(batchProgressBarInner);
            const batchProgressText = document.createElement('span');
            batchProgress.appendChild(batchProgressBar);
            batchProgress.appendChild(batchProgressText);

            const batchAbortBtn = document.createElement('button');
            batchAbortBtn.className = 'btn btn-danger';
            batchAbortBtn.type = 'button';
            batchAbortBtn.textContent = tr('Abort');
            batchAbortBtn.style.display = 'none';
            batchAbortBtn.addEventListener('click', async () => {
              batchAbortBtn.disabled = true;
              batchAbortBtn.textContent = tr('Aborting…');
              showStatus(tr('Aborting project cache…'));
              try {
                const res = await fetch('/projects/' + encodeURIComponent(project.id) + '/cache/project', { method: 'DELETE' });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                  const detail = data?.details || data?.error || res.statusText;
                  showStatus(tr('Failed to abort project cache: {error}', { error: detail }), true);
                  batchAbortBtn.disabled = false;
                  batchAbortBtn.textContent = tr('Abort');
                  return;
                }
                showStatus(tr('Project cache abort requested.'));
                refreshProjectBatchStatus(project.id);
              } catch (err) {
                showStatus(tr('Failed to abort project cache: {error}', { error: err }), true);
                batchAbortBtn.disabled = false;
                batchAbortBtn.textContent = tr('Abort');
              }
            });

            batchActions.appendChild(batchProgress);
            batchActions.appendChild(batchAbortBtn);
            batchActions.appendChild(extentToggle);
            batchRow.appendChild(batchInfo);
            batchRow.appendChild(batchActions);
            // Insert the project-wide `Generate Tiles` button in its own batchRow
            // (do not inject into plugin-specific action containers).
            parent.insertBefore(batchRow, targetEl);
            state.batchInfoEl = batchInfo;
            state.batchButton = null;
            state.batchProgressEl = batchProgress;
            state.batchProgressBarEl = batchProgressBarInner;
            state.batchProgressTextEl = batchProgressText;
            state.batchAbortBtn = batchAbortBtn;
            refreshProjectBatchStatus(project.id);
          } else if (canView) {
            // Non-admin: show extent toggle in its own row
            const extentRow = document.createElement('div');
            extentRow.style.cssText = 'display:flex;gap:8px;margin:4px 0 10px 0';
            extentRow.appendChild(extentToggle);
            parent.insertBefore(extentRow, targetEl);
          }

          if (state.open) {
            toggleProjectExtentPanel(project, projectMeta, extentContainer)
              .catch(err => console.error('Extent panel error', err))
              .finally(updateToggleLabel);
          }
        }

        if (!Array.isArray(layers) || layers.length === 0) {
          targetEl.innerHTML = '<div>No layers</div>';
          return;
        }
        targetEl.innerHTML = '';
        // fetch project cache index to know which layers have cached tiles
        let cacheIndex = null; const cachedByKey = new Map();
        let cachedProjectMin = null; let cachedProjectMax = null;
        try {
          const r = await fetch('/cache/' + encodeURIComponent(project.id) + '/index.json');
          if (r.ok) {
            cacheIndex = await r.json();
            for (const e of (cacheIndex.layers||[])) {
              if (!e || !e.name) continue;
              const kind = e.kind || 'layer';
              cachedByKey.set(kind + ':' + e.name, e);
              const entryMinVal = Number(e.zoom_min);
              const entryMaxVal = Number(e.zoom_max);
              const entryMin = Number.isFinite(entryMinVal) ? Math.round(entryMinVal) : null;
              const entryMax = Number.isFinite(entryMaxVal) ? Math.round(entryMaxVal) : null;
              if (entryMin != null) cachedProjectMin = cachedProjectMin == null ? entryMin : Math.min(cachedProjectMin, entryMin);
              if (entryMax != null) cachedProjectMax = cachedProjectMax == null ? entryMax : Math.max(cachedProjectMax, entryMax);
            }
          }
        } catch {}
        const cachePresenceByLayer = new Map();
        let hasVectorTilesProjectCache = false;
        let hasQuantizedMeshProjectCache = false;
        if (isAdmin) {
          try {
            const params = new URLSearchParams();
            for (const layer of layers) {
              if (layer && layer.name) params.append('layer', layer.name);
            }
            const statusRes = await fetch('/cache/' + encodeURIComponent(project.id) + '/status?' + params.toString());
            if (statusRes.ok) {
              const statusJson = await statusRes.json().catch(() => null);
              hasVectorTilesProjectCache = !!statusJson?.vectorTiles;
              hasQuantizedMeshProjectCache = !!statusJson?.quantizedMesh;
              const layerStatus = statusJson?.layers && typeof statusJson.layers === 'object' ? statusJson.layers : {};
              for (const [layerName, state] of Object.entries(layerStatus)) {
                if (!layerName) continue;
                cachePresenceByLayer.set(layerName, state || {});
              }
            }
          } catch {
            // Ignore status fetch errors and keep WMTS-only behavior as fallback.
          }
        }
        const projectState = getProjectState(project.id);
        if (projectState) {
          if (cachedProjectMin != null || cachedProjectMax != null) {
            projectState.cachedZoomRange = {
              min: cachedProjectMin != null ? cachedProjectMin : null,
              max: cachedProjectMax != null ? cachedProjectMax : null
            };
          } else {
            projectState.cachedZoomRange = null;
          }
          if (project.id === activeProjectId) {
            applyCachedZoomRangeToControls(project.id);
          }
        }
        layers.forEach(l => {
          try {
          const d = document.createElement('div');
          d.className = 'layer';
          d.dataset.layerKind = 'layer';
          d.dataset.layerName = l.name;
          const info = document.createElement('div');
          info.className = 'layer-info';
          const provider = (l.provider || '').toLowerCase();
          const remoteSource = l.remote_source || null;
          const cacheable = !!l.cacheable;
          const badges = [];
          if (!cacheable) badges.push('<span class="layer-badge layer-badge-remote">remote</span>');
          const cachedEntry = cachedByKey.get('layer:' + l.name) || null;
          const hasCacheEntry = !!cachedEntry;
          const tileCountRaw = cachedEntry ? (cachedEntry.tile_count ?? cachedEntry.tiles ?? cachedEntry.tileCount) : null;
          const tileCount = Number.isFinite(Number(tileCountRaw)) ? Number(tileCountRaw) : 0;
          const hasTilesFlag = cachedEntry ? (cachedEntry.has_tiles ?? cachedEntry.hasTiles) : null;
          const hasCachedTiles = hasCacheEntry && (tileCount > 0 || hasTilesFlag === true);
          const cacheStatus = String(cachedEntry?.status || '').toLowerCase();
          const partialTileCountRaw = cachedEntry ? (cachedEntry.progress?.totalGenerated ?? cachedEntry.generated_tiles ?? cachedEntry.generatedTiles) : null;
          const partialTileCount = Number.isFinite(Number(partialTileCountRaw)) ? Number(partialTileCountRaw) : 0;
          const hasRecoverablePartialCache = hasCacheEntry && (tileCount > 0 || hasTilesFlag === true || partialTileCount > 0);
          const hasPartialCache = hasRecoverablePartialCache && (cachedEntry?.partial === true || ['aborted', 'error', 'running'].includes(cacheStatus));
          const cachePresence = cachePresenceByLayer.get(l.name) || null;
          const hasWmsCache = !!cachePresence?.wms;
          const hasVectorTilesCache = !!cachePresence?.vectortiles || hasVectorTilesProjectCache;
          const hasMeshCache = !!cachePresence?.mesh || hasQuantizedMeshProjectCache;
          const hasAnyCacheForDelete = hasCachedTiles || hasWmsCache || hasVectorTilesCache || hasMeshCache;
          const configLayer = state.config && state.config.layers ? state.config.layers[l.name] : null;
          const scheduleObj = configLayer && configLayer.schedule ? configLayer.schedule : null;
          const scheduleSummary = describeSchedule(scheduleObj);
          const iconKind = cachedEntry && cachedEntry.scheme === 'wmts' ? 'wmts' : 'layer';
          const iconClass = iconKind === 'layer' ? 'layer-title-icon' : `layer-title-icon ${iconKind}`;
          const layerExtentWgs = normalizeExtentList(l.extent_wgs84);
          if (layerExtentWgs) {
            state.layerExtents.set(l.name, layerExtentWgs);
            state.layerExtentUnion = combineExtentLists(state.layerExtentUnion, layerExtentWgs);
          }
          const titlePieces = [
            `<span class="${iconClass}">${ICONS[iconKind] || ICONS.layer}</span>`,
            `<span>${escapeHtml(l.name)}</span>`
          ];
          if (badges.length) titlePieces.push(badges.join(' '));
          const metaPrimary = [];
          const metaSecondary = [];
          if (l.layer_crs) metaPrimary.push('Layer CRS: ' + l.layer_crs);
          if (l.tile_crs || l.crs) metaPrimary.push('Tile CRS: ' + (l.tile_crs || l.crs));
          if (provider) metaPrimary.push(provider);
          if (Array.isArray(l.extent) && l.extent.length === 4) metaSecondary.push('Layer extent: ' + JSON.stringify(l.extent));
          if (Array.isArray(l.extent_wgs84) && l.extent_wgs84.length === 4) metaSecondary.push('WGS84 extent: ' + JSON.stringify(l.extent_wgs84));
          if (scheduleSummary) metaSecondary.push('Auto: ' + scheduleSummary);
          if (scheduleObj) {
            const history = Array.isArray(scheduleObj.history) ? scheduleObj.history : [];
            const lastHistory = history.length ? history[history.length - 1] : null;
            const lastRunSource = scheduleObj.lastRunAt || (lastHistory && lastHistory.at) || null;
            const lastRunLabel = formatDateTimeLocal(lastRunSource);
            const lastStatusToken = scheduleObj.lastResult || (lastHistory && lastHistory.status) || null;
            if (lastRunLabel && lastStatusToken) {
              metaSecondary.push('Auto last: ' + formatStatusToken(lastStatusToken) + ' @ ' + lastRunLabel);
            } else if (lastRunLabel) {
              metaSecondary.push('Auto last: ' + lastRunLabel);
            }
            const nextRunLabel = formatDateTimeLocal(scheduleObj.nextRunAt);
            if (nextRunLabel) {
              metaSecondary.push('Auto next: ' + nextRunLabel);
            }
          }
          if (cachedEntry) {
            const cachedMinVal = Number(cachedEntry.zoom_min);
            const cachedMaxVal = Number(cachedEntry.zoom_max);
            const cachedMin = Number.isFinite(cachedMinVal) ? Math.round(cachedMinVal) : null;
            const cachedMax = Number.isFinite(cachedMaxVal) ? Math.round(cachedMaxVal) : null;
            const coverageLabel = formatZoomRangeLabel(cachedMin, cachedMax);
            if (coverageLabel && hasCachedTiles) metaSecondary.push('Cached ' + coverageLabel);
          }
          const metaLines = [];
          if (metaPrimary.length) {
            metaLines.push('<div class="meta layer-meta-line">' + metaPrimary.map(escapeHtml).join(' · ') + '</div>');
          }
          if (metaSecondary.length) {
            metaLines.push('<div class="meta layer-meta-line">' + metaSecondary.map(escapeHtml).join(' · ') + '</div>');
          }
          info.innerHTML = `<div class="layer-title">${titlePieces.join(' ')}</div>` + metaLines.join('');

          const tileTemplate = `/wmts/${encodeURIComponent(project.id)}/${encodeURIComponent(l.name)}/{z}/{x}/{y}.png`;
          const xyzTemplateAbsolute = withApiKey(`${window.location.origin}${tileTemplate}`, project);
          const layerCapabilitiesUrl = withApiKey(`${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}&layer=${encodeURIComponent(l.name)}`, project);
          const cachedScheme = cachedEntry && cachedEntry.scheme ? cachedEntry.scheme : null;
          const isCachedXYZ = cachedScheme === 'xyz';
          const xyzEnabled = l.xyz_enabled === true
            || l.xyzEnabled === true
            || ((l.xyz_enabled !== false && l.xyzEnabled !== false) && isXyzCompatibleCrs(l.tile_crs || l.tileCrs || l.crs || project?.crs || null));

          let exampleLink = null;
          if (cachedEntry && isCachedXYZ) {
            exampleLink = document.createElement('a');
            exampleLink.href = tileTemplate.replace('{z}', String(cachedEntry.zoom_min ?? 0)).replace('{x}', '0').replace('{y}', '0');
            exampleLink.target = '_blank';
            exampleLink.style.display = 'block';
            exampleLink.style.fontSize = '12px';
            exampleLink.style.marginTop = '6px';
            exampleLink.textContent = tr('View sample tile');
          }

          const copyXyzBtn = xyzEnabled ? makeIconButton(tr('Copy XYZ URL'), 'tiles', () => {
            navigator.clipboard.writeText(xyzTemplateAbsolute).then(() => {
              showStatus(tr('Tile template copied to clipboard: {url}', { url: xyzTemplateAbsolute }));
            }).catch(err => {
              showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
            });
          }) : null;

          const copyWmtsBtn = makeIconButton(tr('Copy WMTS URL'), 'wmts', () => {
            navigator.clipboard.writeText(layerCapabilitiesUrl).then(() => {
              showStatus('WMTS capabilities URL copied: ' + layerCapabilitiesUrl);
            }).catch(err => {
              showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
            });
          });

          const wmsCapabilitiesUrl = withApiKey(`${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}&layer=${encodeURIComponent(l.name)}`, project);
          const copyWmsBtn = makeIconButton(tr('Copy WMS URL'), 'wms', () => {
            navigator.clipboard.writeText(wmsCapabilitiesUrl).then(() => {
              showStatus(tr('WMS URL copied to clipboard'));
            }).catch(err => {
              showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
            });
          });

          const isVectorLayer = isVectorLayerLike(l);
          const wfsCapabilitiesUrl = withApiKey(`${window.location.origin}/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}&TYPENAME=${encodeURIComponent(safeXmlName(l.name))}`, project);
          const copyWfsBtn = makeIconButton(tr('Copy WFS URL'), 'wfs', () => {
            navigator.clipboard.writeText(wfsCapabilitiesUrl).then(() => {
              showStatus(tr('WFS URL copied to clipboard'));
            }).catch(err => {
              showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
            });
          });

          const controls = document.createElement('div');
          controls.className = 'actions';
          controls.setAttribute('role', 'group');
          controls.addEventListener('click', (event) => event.stopPropagation());

          const actionBox = document.createElement('div');
          actionBox.className = 'layer-actions-box';

          const rowMap = document.createElement('div');
          rowMap.className = 'layer-actions-row';
          rowMap.dataset.row = 'map';

          const rowFlags = document.createElement('div');
          rowFlags.className = 'layer-actions-row';
          rowFlags.dataset.row = 'flags';

          const rowCache = document.createElement('div');
          rowCache.className = 'layer-actions-row';
          rowCache.dataset.row = 'cache';

          const rowCopy = document.createElement('div');
          rowCopy.className = 'layer-actions-row';
          rowCopy.dataset.row = 'copy';

          const rowView = document.createElement('div');
          rowView.className = 'layer-actions-row';
          rowView.dataset.row = 'view';

          const layerExtentContainer = document.createElement('div');
          layerExtentContainer.className = 'layer-extent-container';
          layerExtentContainer.style.display = 'none';

          const showLayerExtentBtn = document.createElement('button');
          showLayerExtentBtn.type = 'button';
          showLayerExtentBtn.className = 'btn btn-secondary';
          showLayerExtentBtn.textContent = tr('Show extent map');
          showLayerExtentBtn.addEventListener('click', () => {
            toggleLayerExtentPanel(project, l, configLayer || null, layerExtentContainer, showLayerExtentBtn)
              .catch((err) => {
                console.error('Layer extent panel error', err);
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
          });
          rowMap.appendChild(showLayerExtentBtn);

          const reloadLayerBtn = makeIconButton(tr('Reload layer'), 'reload', () => reloadLayerRow(reloadLayerBtn, project, l.name), 'btn-secondary');
          rowMap.appendChild(reloadLayerBtn);

          if (isAdmin && l && (l.kind === 'vector' || l.kind === 'VectorLayer' || l.geometry_type)) {
            const editableWrap = document.createElement('label');
            editableWrap.style.display = 'inline-flex';
            editableWrap.style.alignItems = 'center';
            editableWrap.style.gap = '6px';
            editableWrap.style.padding = '0 6px';
            editableWrap.style.height = '32px';
            editableWrap.style.border = '1px solid var(--border)';
            editableWrap.style.borderRadius = '8px';
            editableWrap.style.background = 'var(--card)';
            editableWrap.title = tr('Enable editing over WFS');

            const editableInput = document.createElement('input');
            editableInput.type = 'checkbox';
            editableInput.checked = !(configLayer && configLayer.wfsEditable === false);
            editableInput.addEventListener('click', (event) => event.stopPropagation());
            editableInput.addEventListener('change', () => {
              const next = !!editableInput.checked;
              queueProjectConfigSave(project.id, {
                layers: {
                  [l.name]: {
                    wfsEditable: next
                  }
                }
              }, { immediate: true });
              showStatus(next ? tr('Layer marked editable') : tr('Layer marked read-only'));
            });

            const editableText = document.createElement('span');
            editableText.setAttribute('data-i18n', 'Editable');
            editableText.textContent = tr('Editable');

            editableWrap.appendChild(editableInput);
            editableWrap.appendChild(editableText);
            rowFlags.appendChild(editableWrap);

            const qrigoEnabled = Array.isArray(window.qtilerPluginsEnabled)
              ? window.qtilerPluginsEnabled.includes('Qrigo')
              : false;
            if (qrigoEnabled) {
              const searchableWrap = document.createElement('label');
              searchableWrap.style.display = 'inline-flex';
              searchableWrap.style.alignItems = 'center';
              searchableWrap.style.gap = '6px';
              searchableWrap.style.padding = '0 6px';
              searchableWrap.style.height = '32px';
              searchableWrap.style.border = '1px solid var(--border)';
              searchableWrap.style.borderRadius = '8px';
              searchableWrap.style.background = 'var(--card)';
              searchableWrap.title = tr('Enable searching over WFS');

              const searchableInput = document.createElement('input');
              searchableInput.type = 'checkbox';
              searchableInput.checked = !(configLayer && configLayer.wfsSearchable === false);
              searchableInput.addEventListener('click', (event) => event.stopPropagation());
              searchableInput.addEventListener('change', () => {
                const next = !!searchableInput.checked;
                queueProjectConfigSave(project.id, {
                  layers: {
                    [l.name]: {
                      wfsSearchable: next
                    }
                  }
                }, { immediate: true });
                showStatus(next ? tr('Layer marked searchable') : tr('Layer marked not searchable'));
              });

              const searchableText = document.createElement('span');
              searchableText.setAttribute('data-i18n', 'Searchable');
              searchableText.textContent = tr('Searchable');

              searchableWrap.appendChild(searchableInput);
              searchableWrap.appendChild(searchableText);
              rowFlags.appendChild(searchableWrap);
            }
          }

          if (exampleLink && !hasCachedTiles) {
            // Index can contain bootstrap placeholders; only show sample link when tiles exist.
            exampleLink = null;
          }

          // Always show the manual cache button so operators can trigger caching.
          const genBtn = makeIconButton((hasCachedTiles || hasPartialCache) ? tr('Recache layer') : tr('Generate Tiles'), 'play', null, 'btn-primary');
          if (hasPartialCache) {
            genBtn.title = tr('Recache layer');
            genBtn.addEventListener('click', async () => {
              const decision = await showPartialCacheResumeDialog({ targetName: l.name, cachedEntry });
              if (!decision) return;
              const resumeRange = decision === 'resume' ? deriveCachedZoomRange(cachedEntry) : null;
              try {
                await generateCache(genBtn, project.id, l.name, l, {
                  recache: false,
                  cachedEntry,
                  zoomOverride: decision === 'resume' ? resumeRange : null,
                  forcePurgeBeforeStart: decision === 'replace'
                });
              } catch (err) {
                console.error('Partial cache restart failed', err);
              }
            });
          } else if (hasCachedTiles) {
            genBtn.title = tr('Recache layer');
            genBtn.addEventListener('click', async () => {
              const selection = await openRecacheDialog({ projectId: project.id, layerName: l.name, cachedEntry });
              if (!selection) return;
              try {
                await generateCache(genBtn, project.id, l.name, l, { recache: true, cachedEntry, zoomOverride: selection });
              } catch (err) {
                console.error('Recache request failed', err);
              }
            });
          } else {
            genBtn.addEventListener('click', () => generateCache(genBtn, project.id, l.name, l, { recache: false, cachedEntry }));
          }
          if (l.cacheable === false) {
            genBtn.dataset.remote = '1';
            const isAdminUser = !window.appState?.authEnabled || (window.appState.user && window.appState.user.role === 'admin');
            const cfgAllowRemote = (() => {
              try {
                const cfg = projectConfigs.get(project.id);
                return cfg && cfg.cachePreferences && cfg.cachePreferences.allowRemote === true;
              } catch (e) {
                return false;
              }
            })();
            const allowRemoteActive = (allowRemoteCheckbox ? !!allowRemoteCheckbox.checked : cfgAllowRemote) || isAdminUser;
            genBtn.disabled = !allowRemoteActive;
            genBtn.title = allowRemoteActive
              ? (isAdminUser && allowRemoteCheckbox && !allowRemoteCheckbox.checked ? tr('Generate Tiles (admin override)') : tr('Generate Tiles'))
              : tr('Remote layer. Enable "Allow remote" to cache.');
          }

          if (isAdmin) {
            const scheduleBtn = makeIconButton(tr('Configure auto cache'), 'calendar', () => openScheduleDialog({ projectId: project.id, targetType: 'layer', targetName: l.name, configEntry: configLayer || null }));
            const cacheRunHost = document.createElement('span');
            cacheRunHost.style.display = 'inline-flex';
            cacheRunHost.style.alignItems = 'center';
            cacheRunHost.style.gap = '8px';
            rowCache.appendChild(scheduleBtn);
            cacheRunHost.appendChild(genBtn);
            rowCache.appendChild(cacheRunHost);
            registerInlineJobSlot({ projectId: project.id, targetMode: 'layer', targetName: l.name, button: genBtn, host: cacheRunHost });

            if (hasAnyCacheForDelete) {
              const delBtn = makeIconButton(tr('Delete cache'), 'trash', null, 'btn-danger');
              delBtn.addEventListener('click', () => deleteCache(delBtn, project.id, l.name, { hasMeshCache }));
              const delWrap = document.createElement('span');
              delWrap.className = 'delete-cache-container has-cache';
              delWrap.appendChild(delBtn);
              rowCache.appendChild(delWrap);
            }
          }

          // Copy URLs row (only when the user can view the project)
          if (canView) {
            rowCopy.appendChild(copyWmtsBtn);
            rowCopy.appendChild(copyWmsBtn);
            if (isVectorLayer) rowCopy.appendChild(copyWfsBtn);
            if (copyXyzBtn) rowCopy.appendChild(copyXyzBtn);
          }

          // Viewers row
          if (canView) {
            const viewerUrl = '/viewer.html?project=' + encodeURIComponent(project.id) + '&layer=' + encodeURIComponent(l.name);
            const viewWmtsBtn = makeLabeledIconButton(tr('Open map viewer'), 'map', 'WMTS', () => {
              window.open(viewerUrl, '_blank', 'noopener');
            });
            rowView.appendChild(viewWmtsBtn);

            const viewerWmsUrl = '/viewer.html?project=' + encodeURIComponent(project.id)
              + '&layer=' + encodeURIComponent(l.name)
              + '&service=wms';
            const viewWmsBtn = makeLabeledIconButton(tr('Open WMS viewer'), 'map', 'WMS', () => {
              window.open(viewerWmsUrl, '_blank', 'noopener');
            });
            rowView.appendChild(viewWmsBtn);

            if (isVectorLayer) {
              const viewerWfsUrl = '/viewer.html?project=' + encodeURIComponent(project.id)
                + '&layer=' + encodeURIComponent(l.name)
                + '&service=wfs';
              const viewWfsBtn = makeLabeledIconButton(tr('Open WFS viewer'), 'map', 'WFS', () => {
                window.open(viewerWfsUrl, '_blank', 'noopener');
              });
              rowView.appendChild(viewWfsBtn);
            }
          }

          // Plugin-provided layer action buttons (e.g. Qrigo "Open in Origo")
          if (canView) {
            const pluginActionBtns = Array.isArray(window.qtilerPluginHooks?.layerActionButtons)
              ? window.qtilerPluginHooks.layerActionButtons
              : [];
            const seenPluginActionIds = new Set();
            for (const hook of pluginActionBtns) {
              try {
                const hookId = String(hook?.id || '').trim();
                if (hookId) {
                  if (seenPluginActionIds.has(hookId)) continue;
                  seenPluginActionIds.add(hookId);
                }
                if (typeof hook.shouldShow === 'function' && !hook.shouldShow({ layerData: l, projectId: project.id, isAdmin })) continue;
                const btn = hook.create({ layerData: l, projectId: project.id, isAdmin, makeLabeledIconButton, tr });
                if (btn instanceof HTMLElement) rowView.appendChild(btn);
              } catch (e) { console.warn('[pluginActionBtn]', e); }
            }
          }

          // Layer details button
          let detailsBtn = null;
          detailsBtn = makeIconButton(tr('Layer Details'), 'info', () => {
            toggleLayerDetails(d, { 
              projectId: project.id, 
              layerData: l, 
              cachedEntry, 
              isAdmin,
              configLayer,
              project
            });
          }, 'btn-secondary');

          if (canView && detailsBtn) rowView.appendChild(detailsBtn);

          // Assemble box rows (cache actions are admin-only)
          if (canView) actionBox.appendChild(rowMap);
          if (rowFlags.childElementCount > 0) actionBox.appendChild(rowFlags);
          if (isAdmin) actionBox.appendChild(rowCache);
          if (canView) actionBox.appendChild(rowCopy);
          if (canView) actionBox.appendChild(rowView);
          controls.appendChild(actionBox);
          

          d.appendChild(info);
          info.appendChild(layerExtentContainer);
          if (exampleLink) d.appendChild(exampleLink);
          d.appendChild(controls);
          targetEl.appendChild(d);
          } catch (err) { console.error('Error rendering layer', l, err); }
        });
        if (themes && themes.length) {
          const themeHeader = document.createElement('h3');
          themeHeader.textContent = 'Map themes';
          themeHeader.style.margin = '18px 0 8px 0';
          themeHeader.style.fontSize = '16px';
          themeHeader.style.fontWeight = '600';
          targetEl.appendChild(themeHeader);
          themes.forEach(theme => {
            try {
            if (!theme || !theme.name) return;
            const themeRow = document.createElement('div');
            themeRow.className = 'layer';
            themeRow.dataset.layerKind = 'theme';
            themeRow.dataset.layerName = theme.name;
            const infoBox = document.createElement('div');
            infoBox.className = 'layer-info';
            const themeHeaderPieces = [
              `<span class="layer-title-icon theme">${ICONS.theme}</span>`,
              `<span>${escapeHtml(theme.name)}</span>`,
              '<span class="layer-badge layer-badge-theme">theme</span>'
            ];
            infoBox.innerHTML = `<div class="layer-title">${themeHeaderPieces.join(' ')}</div>`;
            const metaBox = document.createElement('div');
            metaBox.className = 'meta';
            const configTheme = state.config && state.config.themes ? state.config.themes[theme.name] : null;
            const cachedTheme = cachedByKey.get('theme:' + theme.name) || null;
            const cachedSources = cachedTheme && Array.isArray(cachedTheme.source_layers) ? cachedTheme.source_layers : [];
            const sources = Array.isArray(theme.layers) && theme.layers.length ? theme.layers : (configTheme && Array.isArray(configTheme.sourceLayers) ? configTheme.sourceLayers : cachedSources);
            const metaParts = [];
            if (sources.length) metaParts.push('Layers: ' + sources.join(', '));
            if (configTheme && configTheme.lastRunAt) {
              const when = new Date(configTheme.lastRunAt);
              if (!Number.isNaN(when.getTime())) metaParts.push('Last run: ' + when.toLocaleString());
            }
            if (configTheme && configTheme.lastResult) metaParts.push('Status: ' + configTheme.lastResult);
            const themeScheduleSummary = describeSchedule(configTheme && configTheme.schedule);
            if (themeScheduleSummary) metaParts.push('Auto: ' + themeScheduleSummary);
            metaBox.textContent = metaParts.join(' · ') || 'No runs yet';
            infoBox.appendChild(metaBox);
            themeRow.appendChild(infoBox);

            let themeExtent = null;
            if (Array.isArray(sources)) {
              for (const sourceName of sources) {
                const ex = state.layerExtents ? state.layerExtents.get(sourceName) : null;
                if (ex) themeExtent = combineExtentLists(themeExtent, ex);
              }
            }
            if (themeExtent) {
              state.themeExtents.set(theme.name, themeExtent);
            }

            const controls = document.createElement('div');
            controls.className = 'actions';
            controls.setAttribute('role', 'group');
            controls.addEventListener('click', (event) => event.stopPropagation());

            const actionBox = document.createElement('div');
            actionBox.className = 'layer-actions-box';

            const rowCache = document.createElement('div');
            rowCache.className = 'layer-actions-row';
            rowCache.dataset.row = 'cache';

            const rowCopy = document.createElement('div');
            rowCopy.className = 'layer-actions-row';
            rowCopy.dataset.row = 'copy';

            const rowView = document.createElement('div');
            rowView.className = 'layer-actions-row';
            rowView.dataset.row = 'view';

            const themeObj = { name: theme.name, layers: sources };
            
            if (isAdmin) {
              const cacheBtn = makeIconButton('Generate theme cache', 'play', () => generateCache(cacheBtn, project.id, theme.name, themeObj, { kind: 'theme', recache: false, cachedEntry: cachedTheme }), 'btn-primary');
              const scheduleThemeBtn = makeIconButton(tr('Configure auto cache'), 'calendar', () => openScheduleDialog({ projectId: project.id, targetType: 'theme', targetName: theme.name, configEntry: configTheme || null }));
              const cacheRunHost = document.createElement('span');
              cacheRunHost.style.display = 'inline-flex';
              cacheRunHost.style.alignItems = 'center';
              cacheRunHost.style.gap = '8px';
              rowCache.appendChild(scheduleThemeBtn);
              cacheRunHost.appendChild(cacheBtn);
              rowCache.appendChild(cacheRunHost);
              registerInlineJobSlot({ projectId: project.id, targetMode: 'theme', targetName: theme.name, button: cacheBtn, host: cacheRunHost });
            }

            const themeCapabilitiesUrl = withApiKey(`${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}&layer=${encodeURIComponent(theme.name)}`, project);
            const themeXyzTemplate = withApiKey(`${window.location.origin}/wmts/${encodeURIComponent(project.id)}/themes/${encodeURIComponent(theme.name)}/{z}/{x}/{y}.png`, project);
            const themeXyzEnabled = theme.xyz_enabled === true
              || theme.xyzEnabled === true
              || ((theme.xyz_enabled !== false && theme.xyzEnabled !== false) && isXyzCompatibleCrs(
                (cachedTheme && (cachedTheme.tile_crs || cachedTheme.tileCrs || cachedTheme.crs))
                || theme.tile_crs
                || theme.tileCrs
                || theme.crs
                || project?.crs
                || null
              ));

            const copyThemeWmtsBtn = makeIconButton(tr('Copy WMTS URL'), 'wmts', () => {
              navigator.clipboard.writeText(themeCapabilitiesUrl).then(() => {
                showStatus(tr('WMTS URL copied to clipboard'));
              }).catch(err => {
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
            });

            const themeWmsCapabilitiesUrl = withApiKey(`${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(project.id)}&layer=${encodeURIComponent(theme.name)}`, project);
            const copyThemeWmsBtn = makeIconButton(tr('Copy WMS URL'), 'wms', () => {
              navigator.clipboard.writeText(themeWmsCapabilitiesUrl).then(() => {
                showStatus(tr('WMS URL copied to clipboard'));
              }).catch(err => {
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
            });

            const copyThemeXyzBtn = themeXyzEnabled ? makeIconButton(tr('Copy XYZ URL'), 'tiles', () => {
              navigator.clipboard.writeText(themeXyzTemplate).then(() => {
                showStatus(tr('Tile template copied to clipboard: {url}', { url: themeXyzTemplate }));
              }).catch(err => {
                showStatus(tr('Copy failed: {error}', { error: String(err) }), true);
              });
            }) : null;

            if (canView) {
              rowCopy.appendChild(copyThemeWmtsBtn);
              rowCopy.appendChild(copyThemeWmsBtn);
              if (copyThemeXyzBtn) rowCopy.appendChild(copyThemeXyzBtn);
            }

            if (canView) {
              const viewThemeBtn = makeLabeledIconButton(tr('Open map viewer'), 'map', 'WMTS', () => {
                const url = '/viewer.html?project=' + encodeURIComponent(project.id) + '&theme=' + encodeURIComponent(theme.name);
                window.open(url, '_blank', 'noopener');
              }, 'btn-secondary');
              rowView.appendChild(viewThemeBtn);

              const viewThemeWmsBtn = makeLabeledIconButton(tr('Open WMS viewer'), 'map', 'WMS', () => {
                const url = '/viewer.html?project=' + encodeURIComponent(project.id)
                  + '&theme=' + encodeURIComponent(theme.name)
                  + '&layer=' + encodeURIComponent(theme.name)
                  + '&service=wms';
                window.open(url, '_blank', 'noopener');
              }, 'btn-secondary');
              rowView.appendChild(viewThemeWmsBtn);

              const qrigoEnabled = Array.isArray(window.qtilerPluginsEnabled) && window.qtilerPluginsEnabled.includes('Qrigo');
              if (qrigoEnabled) {
                const openOrigoThemeBtn = makeLabeledIconButton(tr('Open in Origo'), 'map', 'Origo', () => {
                  const openModal = window.qtilerOpenOrigoServiceModal;
                  if (typeof openModal === 'function') {
                    openModal({
                      hasWfs: false,
                      hasVectorTiles: false,
                      tr,
                      onConfirm: (selectedServices) => {
                        const selected = Array.isArray(selectedServices)
                          ? selectedServices.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
                          : [];
                        if (!selected.length) return;
                        const url = '/qrigo/preview2?project=' + encodeURIComponent(project.id)
                          + '&layer=' + encodeURIComponent(theme.name)
                          + '&mode=theme&service=' + encodeURIComponent(selected.join(','))
                          + '&_ts=' + encodeURIComponent(String(Date.now()));
                        window.open(url, '_blank', 'noopener');
                      }
                    });
                    return;
                  }

                  const fallbackUrl = '/qrigo/preview2?project=' + encodeURIComponent(project.id)
                    + '&layer=' + encodeURIComponent(theme.name)
                    + '&mode=theme&service=wmts'
                    + '&_ts=' + encodeURIComponent(String(Date.now()));
                  window.open(fallbackUrl, '_blank', 'noopener');
                }, 'btn-secondary');
                rowView.appendChild(openOrigoThemeBtn);
              }

              const themeDetailsBtn = makeIconButton(tr('Layer Details'), 'info', () => {
                toggleLayerDetails(themeRow, { 
                  projectId: project.id, 
                  layerData: themeObj, 
                  cachedEntry: cachedTheme || null, 
                  isAdmin,
                  configLayer: null,
                  project
                });
              }, 'btn-secondary');
              rowView.appendChild(themeDetailsBtn);
            }

            if (isAdmin && rowCache.childElementCount > 0) actionBox.appendChild(rowCache);
            if (canView && rowCopy.childElementCount > 0) actionBox.appendChild(rowCopy);
            if (canView && rowView.childElementCount > 0) actionBox.appendChild(rowView);
            controls.appendChild(actionBox);
            themeRow.appendChild(controls);
            targetEl.appendChild(themeRow);
            } catch (err) {
              console.error('Error rendering theme:', theme, err);
            }
          });
        }
        syncRemoteButtons();
      }

      function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

      async function generateCache(btn, projectId, layerName, layerObj, options = {}) {
        const { recache = false, cachedEntry = null, kind = 'layer', zoomOverride = null, forcePurgeBeforeStart = false } = options || {};
        const isTheme = kind === 'theme';
        const targetLabel = isTheme ? `theme "${layerName}"` : layerName;
        // IMPORTANT: don't call setActiveProject() here; it rewrites the left-panel
        // controls (zoom etc) from config/defaults, which would override Leaflet-picked values.
        if (projectId && activeProjectId !== projectId) {
          activeProjectId = projectId;
        }
        const initialDisabled = btn.disabled;
        const originalHtml = btn.innerHTML;
        const originalTitle = btn.title;
        const restoreButton = () => {
          btn.disabled = initialDisabled;
          btn.innerHTML = btn.dataset.iconHtml || originalHtml;
          btn.title = originalTitle;
          btn.removeAttribute('aria-busy');
        };
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
  btn.title = recache ? 'Recaching tiles…' : 'Generating cache…';
        btn.setAttribute('aria-busy', 'true');
  showStatus((recache ? 'Starting recache for: ' : 'Starting generation for: ') + targetLabel);
        try {
          let zoom_min = null;
          let zoom_max = null;
          if (zoomOverride && typeof zoomOverride === 'object') {
            const overrideMin = parseZoomNumber(zoomOverride.min);
            const overrideMax = parseZoomNumber(zoomOverride.max);
            if (overrideMin != null && overrideMax != null) {
              zoom_min = overrideMin;
              zoom_max = overrideMax;
            }
          }
          if (zoom_min == null || zoom_max == null) {
            const layerZoom = !isTheme ? getLayerZoomRange(projectId, layerName) : null;
            if (layerZoom) {
              zoom_min = layerZoom.min;
              zoom_max = layerZoom.max;
            } else {
              const projectZoom = getProjectZoomRange(projectId);
              if (projectZoom) {
                zoom_min = projectZoom.min;
                zoom_max = projectZoom.max;
              } else {
                const controlMin = Number.parseInt(zoomMinInput ? zoomMinInput.value : '0', 10);
                const controlMax = Number.parseInt(zoomMaxInput ? zoomMaxInput.value : '0', 10);
                zoom_min = Number.isFinite(controlMin) ? controlMin : 0;
                zoom_max = Number.isFinite(controlMax) ? controlMax : 0;
              }
            }
          }
          if (zoom_min < 0) zoom_min = 0; if (zoom_max < 0) zoom_max = 0;
          if (zoom_min > MAX_ZOOM_LEVEL) zoom_min = MAX_ZOOM_LEVEL;
          if (zoom_max > MAX_ZOOM_LEVEL) zoom_max = MAX_ZOOM_LEVEL;
          if (zoom_min > zoom_max && !(zoom_min === 0 && zoom_max === 0)) {
            // intercambiar para ser amigables
            const tmp = zoom_min; zoom_min = zoom_max; zoom_max = tmp;
          }
          enforceCacheControls();
          const mode = 'wmts';
          const rawTileCrs = 'AUTO';
          const body = { project: projectId, zoom_min, zoom_max };
          if (isTheme) {
            body.theme = layerName;
          } else {
            body.layer = layerName;
          }
          let recacheMode = null;
          if (recache && cachedEntry) {
            const lastRunMinVal = Number(cachedEntry.last_zoom_min);
            const lastRunMaxVal = Number(cachedEntry.last_zoom_max);
            const coverageMinVal = Number(cachedEntry.zoom_min);
            const coverageMaxVal = Number(cachedEntry.zoom_max);
            const prevMin = Number.isFinite(lastRunMinVal) ? Math.round(lastRunMinVal)
              : (Number.isFinite(coverageMinVal) ? Math.round(coverageMinVal) : null);
            const prevMax = Number.isFinite(lastRunMaxVal) ? Math.round(lastRunMaxVal)
              : (Number.isFinite(coverageMaxVal) ? Math.round(coverageMaxVal) : null);
            const overlapMinRaw = prevMin != null ? Math.max(prevMin, zoom_min) : zoom_min;
            const overlapMaxRaw = prevMax != null ? Math.min(prevMax, zoom_max) : zoom_max;
            const overlapExists = overlapMinRaw <= overlapMaxRaw;
            if (prevMin != null && prevMax != null && overlapExists) {
              recacheMode = prevMin === zoom_min && prevMax === zoom_max ? 'full' : 'incremental';
            } else if (overlapExists) {
              recacheMode = 'incremental';
            } else {
              recacheMode = 'full';
            }
            body.recache = {
              mode: recacheMode,
              previous_zoom_min: prevMin,
              previous_zoom_max: prevMax
            };
            if (overlapExists) {
              body.recache.overlap = { min: overlapMinRaw, max: overlapMaxRaw };
            }
            if (cachedEntry && Array.isArray(cachedEntry.extent) && cachedEntry.extent.length === 4) {
              body.recache.previous_extent = cachedEntry.extent.slice();
            }
            if (cachedEntry && typeof cachedEntry.tile_crs === 'string') {
              body.recache.previous_tile_crs = cachedEntry.tile_crs;
            }
          }
          // Forced: WMTS automatic (native CRS)
          body.scheme = 'auto';
          body.wmts = true;
          // agregar extent capturado por proyecto (si existe) como project_extent transformable luego
          const state = extentStates.get(projectId);
          const layerExtentPayload = !isTheme ? getLayerProjectedExtentPayload(projectId, layerName, layerObj?.tile_crs || layerObj?.crs || null) : null;
          const extentPayload = layerExtentPayload || getProjectedExtentPayload(projectId);
          if (extentPayload) {
            body.project_extent = extentPayload.extentString;
            body.extent_crs = extentPayload.crs;
          }
          body.allow_remote = true;
          body.throttle_ms = Math.max(300, parseInt(throttleInput ? throttleInput.value : '300') || 300);
          const runReason = recache ? 'manual-recache' : (isTheme ? 'manual-theme' : 'manual');
          body.run_reason = runReason;
          body.trigger = 'manual';
          const nowIso = new Date().toISOString();
          const targetConfigPatch = {
            lastParams: { ...body },
            lastRequestedAt: nowIso
          };
          if (isTheme && layerObj && Array.isArray(layerObj.layers)) {
            targetConfigPatch.sourceLayers = layerObj.layers.slice(0, 64);
          }
          const projectPatch = {
            zoom: { min: zoom_min, max: zoom_max, updatedAt: nowIso },
            cachePreferences: {
              mode,
              tileCrs: null,
              allowRemote: true,
              throttleMs: Math.max(300, parseInt(throttleInput ? throttleInput.value : '300') || 300),
              updatedAt: nowIso
            }
          };
          if (isTheme) {
            projectPatch.themes = { [layerName]: targetConfigPatch };
          } else {
            projectPatch.layers = { [layerName]: targetConfigPatch };
          }
          queueProjectConfigSave(projectId, projectPatch);

          if (forcePurgeBeforeStart) {
            if (isTheme) {
              showStatus(tr('Replacing partial theme cache is not supported yet.'), true);
              restoreButton();
              return;
            }
            try {
              const delRes = await fetch('/cache/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(layerName) + '?force=1', { method: 'DELETE' });
              if (!delRes.ok && delRes.status !== 404) {
                const delData = await delRes.json().catch(()=>null);
                throw new Error(delData?.error || delData?.details || delRes.statusText || 'Failed to purge old cache');
              }
            } catch (delErr) {
              showStatus(tr('Cache restart aborted (purge failed): {error}', { error: delErr }), true);
              restoreButton();
              return;
            }
          }

          if (recache) {
            if (isTheme) {
              showStatus('Recache for themes is not supported yet.', true);
              restoreButton();
              return;
            }
            const needsFullPurge = !body.recache || body.recache.mode !== 'incremental';
            try {
              if (needsFullPurge) {
                const delRes = await fetch('/cache/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(layerName) + '?force=1', { method: 'DELETE' });
                if (!delRes.ok && delRes.status !== 404) {
                  const delData = await delRes.json().catch(()=>null);
                  throw new Error(delData?.error || delData?.details || delRes.statusText || 'Failed to purge old cache');
                }
              } else {
                showStatus('Incremental recache: keeping existing tiles.', false);
              }
            } catch (delErr) {
              showStatus('Recache aborted (purge failed): ' + delErr, true);
              restoreButton();
              return;
            }
          }

          // Debug: log request body for admin users to help diagnose unexpected tile generation
          try {
            if (!window.appState || !window.appState.authEnabled || (window.appState.user && window.appState.user.role === 'admin')) {
              console.debug('generate-cache request body:', JSON.parse(JSON.stringify(body)));
            }
          } catch (e) {}

          // --- NUEVO FLUJO: intentar generar, si ya existe mesh, preguntar si reemplazar ---
          let res = await fetch('/generate-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          let data = await res.json().catch(()=>null);
          if (!res.ok && (data?.error === 'mesh_exists' || data?.error === 'tileset_exists' || data?.details?.includes('already exists'))) {
            const confirmed = await confirmActionModal({
              title: 'Mesh existente',
              message: 'Ya existe un mesh generado para este proyecto/capa. ¿Deseas reemplazarlo?',
              confirmLabel: 'Reemplazar',
              cancelLabel: 'Cancelar',
              isDanger: true
            });
            if (!confirmed) {
              restoreButton();
              return;
            }
            // reintentar con overwrite
            body.overwrite = true;
            res = await fetch('/generate-cache', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            data = await res.json().catch(()=>null);
          }
          if (res.status === 401) {
            window.location.href = '/login?reason=session_expired';
            return;
          }
          if (!res.ok) {
            showStatus('Error: ' + (data?.details || res.statusText || JSON.stringify(data)), true);
            restoreButton();
            return;
          }

          showStatus((recache ? 'Recache' : 'Generation') + ' started for ' + targetLabel + ': job id ' + data.id);
          const inlineKey = makeInlineJobSlotKey(projectId, isTheme ? 'theme' : 'layer', layerName);
          latestInlineJobs.set(inlineKey, {
            id: data.id,
            project: projectId,
            targetMode: isTheme ? 'theme' : 'layer',
            targetName: layerName,
            status: 'running'
          });
          const inlineSlot = inlineJobSlots.get(inlineKey);
          if (inlineSlot) {
            startInlineJobMonitor(inlineSlot, data.id, {
              onDone: () => {
                restoreButton();
                scheduleProjectRefresh(projectId, { delayMs: 600, forceConfigReload: true });
              }
            });
            return;
          }
          // crear botón detener junto al botón original
          const stopBtn = document.createElement('button');
          stopBtn.className = 'btn btn-danger';
          stopBtn.textContent = tr('Abort');
          stopBtn.onclick = async () => {
            stopBtn.disabled = true;
            showStatus(tr('Aborting job {id}', { id: data.id }));
            try {
              const r = await fetch('/generate-cache/' + encodeURIComponent(data.id), { method: 'DELETE' });
              const resjson = await r.json().catch(()=>null);
              if (!r.ok) {
                showStatus(tr('Abort failed: {error}', { error: resjson?.error || r.statusText }), true);
              } else {
                showStatus(tr('Job aborted: {id}', { id: data.id }));
              }
            } catch (err) {
              showStatus(tr('Network error while aborting: {error}', { error: err }), true);
            } finally {
              // dejamos que el polling detecte el estado y cierre UI
              stopBtn.disabled = true;
            }
          };
          // insertar stopBtn después del botón que inició la generación
          btn.parentNode && btn.parentNode.appendChild(stopBtn);

          // crear indicador de progreso
          const progressEl = document.createElement('span');
          progressEl.className = 'progress-pill';
          const bar = document.createElement('span');
          bar.className = 'progress-bar';
          const barInner = document.createElement('i');
          bar.appendChild(barInner);
          const txt = document.createElement('span');
          txt.textContent = '0%';
          progressEl.appendChild(bar);
          progressEl.appendChild(txt);
          btn.parentNode && btn.parentNode.appendChild(progressEl);

          // polling de estado
          let polling = true;
          const parseProgress = (stdout) => {
            if (!stdout) return null;
            const lines = stdout.split(/\r?\n/).filter(Boolean);
            let last = null;
            for (const line of lines) {
              const start = line.indexOf('{');
              const end = line.lastIndexOf('}');
              if (start !== -1 && end !== -1 && end > start) {
                try {
                  const obj = JSON.parse(line.slice(start, end+1));
                  if (obj && (obj.progress || obj.status || obj.debug)) last = obj;
                } catch {}
              }
            }
            return last;
          };

          let lastPct = 0;
          const clamp = (v) => Math.max(0, Math.min(100, Number(v)));
          const timer = setInterval(async () => {
            if (!polling) return;
            try {
              const r = await fetch('/generate-cache/' + encodeURIComponent(data.id) + '?tail=50000');
              if (!r.ok) {
                // si 404, es probable que el job haya expirado/limpiado
                if (r.status === 404) {
                  txt.textContent = 'not found';
                  clearInterval(timer);
                  polling = false;
                  restoreButton();
                }
                return;
              }
              const j = await r.json().catch(()=>null);
              const last = parseProgress(j?.stdout || '');
              if (last?.percent != null) {
                lastPct = clamp(last.percent);
                barInner.style.width = lastPct + '%';
                txt.textContent = lastPct + '%';
              }
              if (j?.status && ["completed","error","aborted"].includes(j.status)) {
                if (j.status === 'completed' && lastPct < 100) {
                  lastPct = 100;
                  barInner.style.width = '100%';
                  txt.textContent = '100%';
                }
                if (j.status === 'aborted') {
                  showStatus(tr('Abort confirmed by worker for job {id}', { id: data.id }));
                }
                txt.textContent += ` · ${formatJobStatusLabel(j.status)}`;
                clearInterval(timer);
                polling = false;
                // limpiar UI y reactivar botón
                try { stopBtn.remove(); } catch {}
                restoreButton();
                // refresh layer list after foreground job completes
                scheduleProjectRefresh(projectId, { delayMs: 600, forceConfigReload: true });
              }
            } catch (e) {
              // ignorar fallos de red puntuales
            }
          }, 1000);

          // al salir de la página o recargar, limpiar el polling
          window.addEventListener('beforeunload', () => { try { clearInterval(timer); } catch {} });
          // --- FIN NUEVO FLUJO ---
        } catch (err) {
          showStatus(tr('Network error: {error}', { error: err }), true);
          restoreButton();
        }
      }

      function chooseCacheDeleteType({ allowMesh = false } = {}) {
        return new Promise((resolve) => {
          const backdrop = document.createElement('div');
          backdrop.className = 'schedule-backdrop';
          backdrop.dataset.open = '1';

          const dialog = document.createElement('div');
          dialog.className = 'schedule-dialog';
          dialog.style.maxWidth = '460px';

          const title = document.createElement('h3');
          title.textContent = tr('Delete cache');
          title.style.marginBottom = '8px';

          const subtitle = document.createElement('p');
          subtitle.className = 'dialog-description';
          subtitle.textContent = tr('Choose which cache type you want to delete for this layer.');

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.flexWrap = 'wrap';
          actions.style.gap = '10px';
          actions.style.marginTop = '14px';

          const btnWmts = document.createElement('button');
          btnWmts.type = 'button';
          btnWmts.className = 'btn btn-secondary';
          btnWmts.textContent = tr('Delete WMTS cache');

          const btnWms = document.createElement('button');
          btnWms.type = 'button';
          btnWms.className = 'btn btn-secondary';
          btnWms.textContent = tr('Delete WMS cache');

          const btnVector = document.createElement('button');
          btnVector.type = 'button';
          btnVector.className = 'btn btn-secondary';
          btnVector.textContent = tr('Delete VectorTiles cache');

          const btnMesh = document.createElement('button');
          btnMesh.type = 'button';
          btnMesh.className = 'btn btn-secondary';
          btnMesh.textContent = tr('Delete Mesh cache');

          const btnCancel = document.createElement('button');
          btnCancel.type = 'button';
          btnCancel.className = 'btn btn-primary';
          btnCancel.textContent = tr('Cancel');

          actions.append(btnWmts, btnWms, btnVector);
          if (allowMesh) actions.appendChild(btnMesh);
          actions.appendChild(btnCancel);
          dialog.append(title, subtitle, actions);
          backdrop.appendChild(dialog);
          document.body.appendChild(backdrop);

          const cleanup = (value) => {
            try { document.removeEventListener('keydown', onKeyDown); } catch {}
            try { backdrop.remove(); } catch {}
            resolve(value || null);
          };

          const onKeyDown = (event) => {
            if (event.key === 'Escape') cleanup(null);
          };

          backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) cleanup(null);
          });
          btnCancel.addEventListener('click', () => cleanup(null));
          btnWmts.addEventListener('click', () => cleanup('wmts'));
          btnWms.addEventListener('click', () => cleanup('wms'));
          btnVector.addEventListener('click', () => cleanup('vectortiles'));
          btnMesh.addEventListener('click', () => cleanup('mesh'));
          document.addEventListener('keydown', onKeyDown);
        });
      }

      function confirmActionModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', isDanger = false } = {}) {
        return new Promise((resolve) => {
          const backdrop = document.createElement('div');
          backdrop.className = 'schedule-backdrop';
          backdrop.dataset.open = '1';

          const dialog = document.createElement('div');
          dialog.className = 'schedule-dialog';
          dialog.style.maxWidth = '520px';

          const titleEl = document.createElement('h3');
          titleEl.textContent = String(title || 'Confirm action');
          titleEl.style.marginBottom = '8px';

          const messageEl = document.createElement('p');
          messageEl.className = 'dialog-description';
          messageEl.style.whiteSpace = 'pre-line';
          messageEl.textContent = String(message || '');

          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '10px';
          actions.style.marginTop = '14px';
          actions.style.justifyContent = 'flex-end';

          const btnCancel = document.createElement('button');
          btnCancel.type = 'button';
          btnCancel.className = 'btn btn-secondary';
          btnCancel.textContent = String(cancelLabel || 'Cancel');

          const btnConfirm = document.createElement('button');
          btnConfirm.type = 'button';
          btnConfirm.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
          btnConfirm.textContent = String(confirmLabel || 'Confirm');

          actions.append(btnCancel, btnConfirm);
          dialog.append(titleEl, messageEl, actions);
          backdrop.appendChild(dialog);
          document.body.appendChild(backdrop);

          const cleanup = (value) => {
            try { document.removeEventListener('keydown', onKeyDown); } catch {}
            try { backdrop.remove(); } catch {}
            resolve(value === true);
          };

          const onKeyDown = (event) => {
            if (event.key === 'Escape') cleanup(false);
          };

          backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) cleanup(false);
          });
          btnCancel.addEventListener('click', () => cleanup(false));
          btnConfirm.addEventListener('click', () => cleanup(true));
          document.addEventListener('keydown', onKeyDown);
          btnConfirm.focus();
        });
      }

      async function deleteCache(btn, projectId, layerName, options = {}) {
        const allowMesh = !!options?.hasMeshCache || (Array.isArray(window.qtilerPluginsEnabled) && window.qtilerPluginsEnabled.includes('QuantizedMesh'));
        const cacheType = await chooseCacheDeleteType({ allowMesh });
        if (!cacheType) return;

        const initialDisabled = btn.disabled;
        const originalHtml = btn.innerHTML;
        const originalTitle = btn.title;
        const restoreButton = () => {
          btn.disabled = initialDisabled;
          btn.innerHTML = btn.dataset.iconHtml || originalHtml;
          btn.title = originalTitle;
          btn.removeAttribute('aria-busy');
        };
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        btn.title = tr('Deleting {type} cache...', { type: cacheType.toUpperCase() });
        btn.setAttribute('aria-busy', 'true');
        try {
          const endpoint = cacheType === 'vectortiles'
            ? '/plugins/VectorTiles/api/tilesets/' + encodeURIComponent(projectId)
            : (cacheType === 'mesh'
              ? '/plugins/QuantizedMesh/api/terrains/' + encodeURIComponent(projectId)
              : '/cache/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(layerName) + '?force=1&type=' + encodeURIComponent(cacheType));
          const res = await fetch(endpoint, { method: 'DELETE' });
          const data = await res.json().catch(()=>null);
          if (!res.ok) {
            showStatus(tr('Failed to delete cache: {error}', { error: data?.error || data?.details || res.statusText }), true);
            console.error('cache DELETE non-ok', res.status, data);
          } else {
            if (cacheType === 'vectortiles') {
              showStatus(tr('VectorTiles cache deleted for project: {projectId}', { projectId }));
            } else if (cacheType === 'mesh') {
              showStatus(tr('Mesh cache deleted for project: {projectId}', { projectId }));
            } else {
              showStatus(tr('{type} cache deleted: {layer}', { type: cacheType.toUpperCase(), layer: layerName }));
            }
            if (cacheType === 'wmts' || cacheType === 'wms') {
              await reloadLayerRowSilent(projectId, layerName, { forceConfigReload: true });
            } else {
              scheduleProjectRefresh(projectId, { forceConfigReload: true });
            }
          }
        } catch (err) {
          showStatus(tr('Failed to delete cache: {error}', { error: err }), true);
          console.error('deleteCache failed', err);
        } finally {
          restoreButton();
        }
      }

      async function deleteProject(btn, project) {
        if (!project || !project.id) return;
        const message = `The project "${project.name || project.id}" and any uploaded data will be removed from the server. Do you want to continue?`;
        const confirmedDelete = await confirmActionModal({
          title: tr('Delete project'),
          message,
          confirmLabel: tr('Remove project and data'),
          cancelLabel: tr('Cancel'),
          isDanger: true
        });
        if (!confirmedDelete) return;
        const initialDisabled = btn.disabled;
        const originalHtml = btn.innerHTML;
        const originalTitle = btn.title;
        const restoreButton = () => {
          btn.disabled = initialDisabled;
          btn.innerHTML = btn.dataset.iconHtml || originalHtml;
          btn.title = originalTitle;
          btn.removeAttribute('aria-busy');
        };
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        btn.title = 'Deleting project…';
        btn.setAttribute('aria-busy', 'true');
        showStatus('Deleting project: ' + (project.name || project.id));
        try {
          const requestDelete = async (retry = false) => {
            const suffix = retry ? '?retry=1' : '';
            const response = await fetch('/projects/' + encodeURIComponent(project.id) + suffix, { method: 'DELETE' });
            const payload = await response.json().catch(() => null);
            return { response, payload };
          };

          let { response: res, payload: data } = await requestDelete(false);

          if (!res.ok && data?.error === 'project_delete_partial') {
            const paths = Array.isArray(data?.remainingPaths) ? data.remainingPaths : [];
            const errSummary = Array.isArray(data?.cleanupErrors)
              ? data.cleanupErrors.map((item) => `${item.scope}: ${item.message}`).join('\n')
              : '';
            const detailText = [
              'No se pudo eliminar completamente el proyecto.',
              paths.length ? `Pendiente:\n- ${paths.join('\n- ')}` : '',
              errSummary ? `Errores:\n${errSummary}` : '',
              '',
              'Quieres reintentar ahora?'
            ].filter(Boolean).join('\n\n');

            showStatus('Project deleted partially. Some files are still present.', true);
            const confirmedRetry = await confirmActionModal({
              title: 'Partial delete',
              message: detailText,
              confirmLabel: 'Retry delete',
              cancelLabel: tr('Cancel'),
              isDanger: true
            });
            if (confirmedRetry) {
              ({ response: res, payload: data } = await requestDelete(true));
            }
          }

          if (!res.ok) {
            const detail = data?.error || data?.details || res.statusText;
            showStatus('Delete project failed: ' + detail, true);
            return;
          }
          extentStates.delete(project.id);
          projectConfigs.delete(project.id);
          removeStoredCollapse(project.id);
          showStatus('Project deleted: ' + (project.name || project.id));
          const wrap = findProjectWrap(project.id);
          if (wrap) {
            try { wrap.remove(); } catch {}
          }
          if (activeProjectId === project.id) {
            activeProjectId = null;
            const firstWrap = layersEl.querySelector('[data-project-id]');
            if (firstWrap && firstWrap.dataset.projectId) {
              setActiveProject(firstWrap.dataset.projectId);
            }
          }
          if (!layersEl.querySelector('[data-project-id]')) {
            loadLayers({ forceConfigReload: true });
          }
        } catch (err) {
          showStatus('Network error: ' + err, true);
        } finally {
          restoreButton();
        }
      }

      async function downloadProjectBundle(btn, project) {
        if (!project || !project.id) return;
        const initialDisabled = btn.disabled;
        const originalHtml = btn.innerHTML;
        const originalTitle = btn.title;
        const restoreButton = () => {
          btn.disabled = initialDisabled;
          btn.innerHTML = btn.dataset.iconHtml || originalHtml;
          btn.title = originalTitle;
          btn.removeAttribute('aria-busy');
        };
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
        btn.title = tr('Preparing project download...');
        btn.setAttribute('aria-busy', 'true');
        showStatus(tr('Preparing project download: {project}', { project: project.name || project.id }));
        try {
          const res = await fetch('/projects/' + encodeURIComponent(project.id) + '/download', {
            method: 'GET',
            credentials: 'include'
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            const detail = data?.error || data?.details || res.statusText;
            showStatus(tr('Project download failed: {error}', { error: detail }), true);
            return;
          }
          const blob = await res.blob();
          const disposition = String(res.headers.get('content-disposition') || '');
          const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
          const fallbackName = (project.id || 'project') + '.zip';
          const fileName = nameMatch && nameMatch[1]
            ? decodeURIComponent(nameMatch[1].replace(/^\"|\"$/g, '').trim())
            : fallbackName;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          showStatus(tr('Project download ready: {project}', { project: project.name || project.id }));
        } catch (err) {
          showStatus(tr('Project download failed: {error}', { error: String(err) }), true);
        } finally {
          restoreButton();
        }
      }

  reloadBtn.onclick = async () => {
    showStatus(tr('Reloading…'));
    try { await refreshJobs(); } catch {}
    reapplyInlineJobSlotsFromCache();
    loadLayers({ forceConfigReload: true });
  };
      loadLayers({ forceConfigReload: true });
      // arrancar polling de jobs para persistir estado entre recargas
      refreshJobs();
      const jobsTicker = setInterval(refreshJobs, 2000);
      window.addEventListener('beforeunload', ()=>{ try{ clearInterval(jobsTicker);}catch{} });
      // dynamic remote enable toggle
      if (allowRemoteCheckbox) {
        allowRemoteCheckbox.addEventListener('change', () => {
          syncRemoteButtons();
          emitControlConfigChange();
        });
        syncRemoteButtons();
      }

  // dynamic mode/CRS UI
      function applyModeUI(){
        if (!modeSelect || !tileCrsInput) return;
        const m = modeSelect.value;
        if (m === 'xyz') {
          tileCrsInput.value = 'EPSG:3857';
          tileCrsInput.disabled = true;
          tileCrsInput.title = 'Fixed to EPSG:3857 for standard XYZ scheme';
        } else if (m === 'wmts') {
          tileCrsInput.disabled = false;
          if (!tileCrsInput.value || tileCrsInput.value === 'EPSG:3857') tileCrsInput.value = '';
          tileCrsInput.placeholder = 'auto (layer CRS)';
          tileCrsInput.title = 'Empty = use layer native CRS';
        } else {
          tileCrsInput.disabled = false;
          if (!tileCrsInput.value) tileCrsInput.placeholder = 'auto';
          tileCrsInput.title = 'Empty = use layer CRS';
        }
      }
      if (modeSelect) {
        modeSelect.addEventListener('change', () => {
          applyModeUI();
          emitControlConfigChange();
        });
        applyModeUI();
      }