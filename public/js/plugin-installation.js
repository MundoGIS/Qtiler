const installationMessages = {
  en: {
    exists: '{plugin} already exists', choose: 'Choose how to replace this plugin.', preserve: 'Update and keep all data', preserveHelp: 'Replace the code and keep maps, settings and assets.', reset: 'Clean installation', resetHelp: 'Reset only this plugin\'s data. An automatic server backup is kept.', protected: 'Qtiler users, permissions and licenses are preserved. The shared QtilerAuth database is not reset.', acknowledge: 'I confirm that this plugin\'s data will be reset.', cancel: 'Cancel', replace: 'Replace plugin', cancelled: 'Installation cancelled. Nothing was changed.', busy: 'Another plugin installation is still being confirmed. Wait before retrying.', failed: 'The plugin could not be loaded by all server workers. Check the server log.', restored: 'Installation failed. The previous package and data were restored.', timeout: 'Installation has not been confirmed yet. Check the server log before retrying.', invalidArchive: 'The plugin archive is invalid or incomplete.', network: 'Network error during plugin upload.', unsupported: 'The server does not support installation confirmation. Update Qtiler and retry.', statusUnavailable: 'Installation status unavailable.', title: 'Installing plugin', uploading: 'Uploading package', preparing: 'Validating and preparing package', starting: 'Starting and verifying server workers'
  },
  es: {
    exists: '{plugin} ya existe', choose: 'Elige cómo reemplazar este plugin.', preserve: 'Actualizar y conservar todos los datos', preserveHelp: 'Reemplaza el código y conserva mapas, ajustes y archivos.', reset: 'Instalación desde cero', resetHelp: 'Reinicia solo los datos de este plugin. Se conserva una copia automática en el servidor.', protected: 'Se conservan los usuarios, permisos y licencias de Qtiler. No se reinicia la base compartida de QtilerAuth.', acknowledge: 'Confirmo que se reiniciarán los datos de este plugin.', cancel: 'Cancelar', replace: 'Reemplazar plugin', cancelled: 'Instalación cancelada. No se cambió nada.', busy: 'Otra instalación de plugin sigue pendiente de confirmación. Espera antes de reintentar.', failed: 'El plugin no pudo cargarse en todos los workers. Revisa el registro del servidor.', restored: 'La instalación falló. Se restauraron el paquete y los datos anteriores.', timeout: 'La instalación aún no está confirmada. Revisa el registro antes de reintentar.', invalidArchive: 'El paquete del plugin es inválido o está incompleto.', network: 'Error de red al subir el plugin.', unsupported: 'El servidor no admite la confirmación de instalación. Actualiza Qtiler y vuelve a intentar.', statusUnavailable: 'No se puede consultar el estado de instalación.', title: 'Instalando plugin', uploading: 'Subiendo paquete', preparing: 'Validando y preparando el paquete', starting: 'Iniciando y verificando los workers del servidor'
  },
  sv: {
    exists: '{plugin} finns redan', choose: 'Välj hur detta plugin ska ersättas.', preserve: 'Uppdatera och behåll alla data', preserveHelp: 'Ersätt koden och behåll kartor, inställningar och filer.', reset: 'Ren installation', resetHelp: 'Återställ endast detta plugins data. En automatisk säkerhetskopia sparas på servern.', protected: 'Qtilers användare, behörigheter och licenser behålls. QtilerAuths gemensamma databas återställs inte.', acknowledge: 'Jag bekräftar att detta plugins data ska återställas.', cancel: 'Avbryt', replace: 'Ersätt plugin', cancelled: 'Installationen avbröts. Inget ändrades.', busy: 'En annan plugininstallation väntar på bekräftelse. Vänta innan du försöker igen.', failed: 'Pluginet kunde inte laddas i alla serverprocesser. Kontrollera serverloggen.', restored: 'Installationen misslyckades. Tidigare paket och data har återställts.', timeout: 'Installationen är ännu inte bekräftad. Kontrollera serverloggen innan du försöker igen.', invalidArchive: 'Pluginpaketet är ogiltigt eller ofullständigt.', network: 'Nätverksfel vid uppladdning av plugin.', unsupported: 'Servern stöder inte installationsbekräftelse. Uppdatera Qtiler och försök igen.', statusUnavailable: 'Installationsstatus är inte tillgänglig.', title: 'Installerar plugin', uploading: 'Laddar upp paket', preparing: 'Kontrollerar och förbereder paketet', starting: 'Startar och verifierar serverprocesser'
  },
  no: {
    exists: '{plugin} finnes allerede', choose: 'Velg hvordan dette programtillegget skal erstattes.', preserve: 'Oppdater og behold alle data', preserveHelp: 'Erstatt koden og behold kart, innstillinger og filer.', reset: 'Ren installasjon', resetHelp: 'Tilbakestill bare dataene til dette programtillegget. En automatisk sikkerhetskopi lagres på serveren.', protected: 'Qtilers brukere, tillatelser og lisenser beholdes. Den delte QtilerAuth-databasen tilbakestilles ikke.', acknowledge: 'Jeg bekrefter at dataene til dette programtillegget skal tilbakestilles.', cancel: 'Avbryt', replace: 'Erstatt programtillegg', cancelled: 'Installasjonen ble avbrutt. Ingenting ble endret.', busy: 'En annen installasjon venter på bekreftelse. Vent før du prøver igjen.', failed: 'Programtillegget kunne ikke lastes i alle serverprosesser. Se serverloggen.', restored: 'Installasjonen mislyktes. Forrige pakke og data er gjenopprettet.', timeout: 'Installasjonen er ennå ikke bekreftet. Se serverloggen før du prøver igjen.', invalidArchive: 'Pakken er ugyldig eller ufullstendig.', network: 'Nettverksfeil ved opplasting av programtillegget.', unsupported: 'Serveren støtter ikke installasjonsbekreftelse. Oppdater Qtiler og prøv igjen.', statusUnavailable: 'Installasjonsstatus er ikke tilgjengelig.', title: 'Installerer programtillegg', uploading: 'Laster opp pakke', preparing: 'Kontrollerer og klargjør pakken', starting: 'Starter og bekrefter serverprosesser'
  },
  da: {
    exists: '{plugin} findes allerede', choose: 'Vælg, hvordan dette plugin skal erstattes.', preserve: 'Opdater og behold alle data', preserveHelp: 'Erstat koden, og behold kort, indstillinger og filer.', reset: 'Ren installation', resetHelp: 'Nulstil kun dette plugins data. En automatisk sikkerhedskopi gemmes på serveren.', protected: 'Qtilers brugere, rettigheder og licenser bevares. Den delte QtilerAuth-database nulstilles ikke.', acknowledge: 'Jeg bekræfter, at dette plugins data skal nulstilles.', cancel: 'Annuller', replace: 'Erstat plugin', cancelled: 'Installationen blev annulleret. Intet blev ændret.', busy: 'En anden installation afventer bekræftelse. Vent, før du prøver igen.', failed: 'Pluginet kunne ikke indlæses i alle serverprocesser. Se serverloggen.', restored: 'Installationen mislykkedes. Den tidligere pakke og data er gendannet.', timeout: 'Installationen er endnu ikke bekræftet. Se serverloggen, før du prøver igen.', invalidArchive: 'Pluginpakken er ugyldig eller ufuldstændig.', network: 'Netværksfejl under upload af plugin.', unsupported: 'Serveren understøtter ikke installationsbekræftelse. Opdater Qtiler, og prøv igen.', statusUnavailable: 'Installationsstatus er ikke tilgængelig.', title: 'Installerer plugin', uploading: 'Uploader pakke', preparing: 'Kontrollerer og klargør pakken', starting: 'Starter og verificerer serverprocesser'
  },
  fi: {
    exists: '{plugin} on jo asennettu', choose: 'Valitse, miten tämä lisäosa korvataan.', preserve: 'Päivitä ja säilytä kaikki tiedot', preserveHelp: 'Korvaa koodi ja säilytä kartat, asetukset ja tiedostot.', reset: 'Puhdas asennus', resetHelp: 'Nollaa vain tämän lisäosan tiedot. Automaattinen varmuuskopio säilytetään palvelimella.', protected: 'Qtilerin käyttäjät, käyttöoikeudet ja lisenssit säilytetään. QtilerAuthin yhteistä tietokantaa ei nollata.', acknowledge: 'Vahvistan tämän lisäosan tietojen nollaamisen.', cancel: 'Peruuta', replace: 'Korvaa lisäosa', cancelled: 'Asennus peruutettiin. Mitään ei muutettu.', busy: 'Toisen lisäosan asennuksen vahvistus on kesken. Odota ennen uutta yritystä.', failed: 'Lisäosaa ei voitu ladata kaikissa palvelinprosesseissa. Tarkista palvelimen loki.', restored: 'Asennus epäonnistui. Edellinen paketti ja tiedot palautettiin.', timeout: 'Asennusta ei ole vielä vahvistettu. Tarkista palvelimen loki ennen uutta yritystä.', invalidArchive: 'Lisäosan paketti on virheellinen tai puutteellinen.', network: 'Verkkovirhe lisäosan latauksen aikana.', unsupported: 'Palvelin ei tue asennuksen vahvistamista. Päivitä Qtiler ja yritä uudelleen.', statusUnavailable: 'Asennuksen tila ei ole saatavilla.', title: 'Asennetaan lisäosaa', uploading: 'Ladataan pakettia', preparing: 'Tarkistetaan ja valmistellaan pakettia', starting: 'Käynnistetään ja tarkistetaan palvelinprosessit'
  }
};

Object.assign(installationMessages.en, {
  uninstallWaiting: 'Stopping {plugin} safely and removing its files…',
  uninstallFailed: 'Could not remove plugin files. The plugin package has been kept. Check the server log for details.',
  uninstallTimeout: 'Uninstallation has not been confirmed. Check the server log before retrying.'
});
Object.assign(installationMessages.es, {
  uninstallWaiting: 'Deteniendo {plugin} de forma segura y eliminando sus archivos…',
  uninstallFailed: 'No se pudieron eliminar los archivos del plugin. El paquete se conservó. Consulta el registro del servidor.',
  uninstallTimeout: 'La desinstalación no está confirmada. Revisa el registro antes de reintentar.'
});
Object.assign(installationMessages.sv, {
  uninstallWaiting: 'Stoppar {plugin} säkert och tar bort filerna…',
  uninstallFailed: 'Pluginfilerna kunde inte tas bort. Paketet har behållits. Kontrollera serverloggen.',
  uninstallTimeout: 'Avinstallationen är ännu inte bekräftad. Kontrollera serverloggen innan du försöker igen.'
});
Object.assign(installationMessages.no, {
  uninstallWaiting: 'Stopper {plugin} trygt og fjerner filene…',
  uninstallFailed: 'Programtilleggets filer kunne ikke fjernes. Pakken er beholdt. Se serverloggen.',
  uninstallTimeout: 'Avinstalleringen er ikke bekreftet ennå. Se serverloggen før du prøver igjen.'
});
Object.assign(installationMessages.da, {
  uninstallWaiting: 'Stopper {plugin} sikkert og fjerner filerne…',
  uninstallFailed: 'Pluginfilerne kunne ikke fjernes. Pakken er bevaret. Se serverloggen.',
  uninstallTimeout: 'Afinstallationen er endnu ikke bekræftet. Se serverloggen, før du prøver igen.'
});
Object.assign(installationMessages.fi, {
  uninstallWaiting: 'Pysäytetään {plugin} turvallisesti ja poistetaan tiedostot…',
  uninstallFailed: 'Lisäosan tiedostoja ei voitu poistaa. Paketti säilytettiin. Tarkista palvelimen loki.',
  uninstallTimeout: 'Poistoa ei ole vielä vahvistettu. Tarkista palvelimen loki ennen uutta yritystä.'
});

export function pluginInstallationText(key, values = {}, language = globalThis.document?.documentElement.lang || 'en') {
  const messages = installationMessages[String(language).split('-')[0]] || installationMessages.en;
  return String(messages[key] || installationMessages.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function confirmPluginReplacement(plugin) {
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'plugin-replacement-dialog modal-card';
    dialog.setAttribute('aria-labelledby', 'plugin-replacement-title');
    dialog.innerHTML = '<header class="modal-card-head"><p id="plugin-replacement-title" class="modal-card-title"></p><button type="button" class="delete"></button></header><section class="modal-card-body"><p class="plugin-replacement-intro"></p><div class="plugin-replacement-options"></div><p class="notification is-info is-light plugin-replacement-protected"></p><label class="checkbox plugin-replacement-acknowledge" hidden><input type="checkbox"><span></span></label></section><footer class="modal-card-foot"><button type="button" class="button is-light" data-action="cancel"></button><button type="button" class="button is-primary" data-action="replace"></button></footer>';
    dialog.querySelector('.modal-card-title').textContent = pluginInstallationText('exists', { plugin: plugin.name });
    dialog.querySelector('.plugin-replacement-intro').textContent = pluginInstallationText('choose');
    dialog.querySelector('.plugin-replacement-protected').textContent = pluginInstallationText('protected');
    const options = dialog.querySelector('.plugin-replacement-options');
    for (const mode of ['preserve', 'reset']) {
      const label = document.createElement('label');
      label.className = 'plugin-replacement-option';
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'plugin-replacement-mode'; input.value = mode; input.checked = mode === 'preserve';
      const text = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = pluginInstallationText(mode);
      const description = document.createElement('p'); description.textContent = pluginInstallationText(`${mode}Help`);
      text.append(title, description); label.append(input, text); options.appendChild(label);
    }
    const acknowledge = dialog.querySelector('.plugin-replacement-acknowledge');
    acknowledge.querySelector('span').textContent = pluginInstallationText('acknowledge');
    const cancel = dialog.querySelector('[data-action="cancel"]');
    const replace = dialog.querySelector('[data-action="replace"]');
    const close = dialog.querySelector('.delete');
    cancel.textContent = pluginInstallationText('cancel'); close.setAttribute('aria-label', pluginInstallationText('cancel'));
    close.textContent = '\u00d7';
    replace.textContent = pluginInstallationText('replace');
    const finish = mode => { dialog.close(); dialog.remove(); previousFocus?.focus?.(); resolve(mode); };
    dialog.addEventListener('change', () => {
      const reset = dialog.querySelector('input[type="radio"]:checked').value === 'reset';
      acknowledge.hidden = !reset;
      replace.disabled = reset && !acknowledge.querySelector('input').checked;
      replace.classList.toggle('is-danger', reset); replace.classList.toggle('is-primary', !reset);
    });
    cancel.addEventListener('click', () => finish(null)); close.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    replace.addEventListener('click', () => finish(dialog.querySelector('input[type="radio"]:checked').value));
    document.body.appendChild(dialog); dialog.showModal();
    dialog.querySelector('input[type="radio"]:checked').focus();
  });
}

function sendPluginArchive(body, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/plugins/upload');
    request.withCredentials = true;
    request.timeout = 300000;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener('load', () => {
      let payload;
      try { payload = JSON.parse(request.responseText); }
      catch { reject(Object.assign(new Error('Invalid server response'), { status: request.status })); return; }
      if (request.status >= 200 && request.status < 300) { resolve(payload); return; }
      const messageKey = payload.error === 'PLUGIN_OPERATION_BUSY' ? 'busy' : ['plugin_archive_invalid', 'plugin_entry_missing', 'plugin_archive_required'].includes(payload.error) ? 'invalidArchive' : null;
      reject(Object.assign(new Error(messageKey ? pluginInstallationText(messageKey) : payload.details || payload.message || payload.error || 'Upload failed'), { code: payload.error, status: request.status, payload }));
    });
    request.addEventListener('error', () => reject(new Error(pluginInstallationText('network'))));
    request.addEventListener('abort', () => reject(Object.assign(new Error(pluginInstallationText('cancelled')), { code: 'installation_cancelled' })));
    request.addEventListener('timeout', () => reject(Object.assign(new Error(pluginInstallationText('timeout')), { code: 'installation_timeout' })));
    request.send(body);
  });
}

export async function uploadPluginArchive(body, onProgress = () => {}, { confirmReplacement = confirmPluginReplacement, send = sendPluginArchive } = {}) {
  try { return await send(body, onProgress); }
  catch (error) {
    if (error.code !== 'plugin_exists' || !error.payload?.plugin?.name) throw error;
    const mode = await confirmReplacement(error.payload.plugin);
    if (!mode) throw Object.assign(new Error(pluginInstallationText('cancelled')), { code: 'installation_cancelled' });
    if (!['preserve', 'reset'].includes(mode)) throw new Error('Invalid replacement choice');
    body.set('installMode', mode);
    return send(body, onProgress);
  }
}

export async function waitForPluginInstallation(statusUrl, {
  read = async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Object.assign(new Error(pluginInstallationText('statusUnavailable')), { status: response.status });
    return response.json();
  },
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now, timeoutMs = 180000
} = {}) {
  if (!/^\/plugins\/installations\/[a-f0-9-]{36}$/i.test(statusUrl || '')) throw Object.assign(new Error(pluginInstallationText('unsupported')), { code: 'installation_unsupported' });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let status;
    try { status = await read(statusUrl); }
    catch (err) { if (err.status >= 400 && err.status < 500) throw err; }
    if (status?.state === 'ready') return status;
    if (status?.state === 'failed') throw Object.assign(new Error(pluginInstallationText(status.rolledBack ? 'restored' : 'failed')), { code: 'installation_failed' });
    await delay(1000);
  }
  throw Object.assign(new Error(pluginInstallationText('timeout')), { code: 'installation_timeout' });
}

export async function waitForPluginUninstallation(statusUrl, {
  read = async url => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Object.assign(new Error(pluginInstallationText('statusUnavailable')), { status: response.status });
    return response.json();
  },
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = Date.now, timeoutMs = 180000
} = {}) {
  if (!/^\/plugins\/uninstallations\/[a-f0-9-]{36}$/i.test(statusUrl || '')) throw Object.assign(new Error(pluginInstallationText('unsupported')), { code: 'installation_unsupported' });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let status;
    try { status = await read(statusUrl); }
    catch (error) { if (error.status >= 400 && error.status < 500) throw error; }
    if (status?.state === 'ready') return status;
    if (status?.state === 'failed') throw Object.assign(new Error(pluginInstallationText('uninstallFailed')), { code: 'uninstallation_failed' });
    await delay(1000);
  }
  throw Object.assign(new Error(pluginInstallationText('uninstallTimeout')), { code: 'installation_timeout' });
}

export function beginViewerInstallation(name) {
  const messages = {
    en: ['Installing', 'Downloading and preparing viewer'],
    es: ['Instalando', 'Descargando y preparando visor'],
    sv: ['Installerar', 'Laddar ner och förbereder kartvisare']
  };
  const [title, phase] = messages[document.documentElement.lang.split('-')[0]] || messages.en;
  const root = document.querySelector('main');
  const originalInert = root?.inert;
  const dialog = document.createElement('dialog');
  dialog.className = 'plugin-installation-dialog';
  const heading = document.createElement('h2');
  heading.textContent = `${title} ${name}`;
  const status = document.createElement('p');
  status.textContent = phase;
  status.setAttribute('role', 'status');
  dialog.setAttribute('aria-label', heading.textContent);
  dialog.append(heading, status, document.createElement('progress'));
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  if (root) { root.inert = true; root.dataset.viewerInstalling = 'true'; }
  dialog.showModal();
  if (window.parent !== window) window.parent.postMessage({ type: 'qtiler:viewer-installation', busy: true, phase: `${heading.textContent}: ${phase}` }, window.location.origin);
  return () => {
    dialog.close();
    dialog.remove();
    if (root) { root.inert = originalInert; delete root.dataset.viewerInstalling; }
    if (window.parent !== window) window.parent.postMessage({ type: 'qtiler:viewer-installation', busy: false }, window.location.origin);
  };
}