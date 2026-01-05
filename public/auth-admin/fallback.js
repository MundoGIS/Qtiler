/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

const form = document.getElementById("upload-form");
const statusEl = document.getElementById("status");

const setStatus = (message, tone = "info") => {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

const resetStatus = () => {
  statusEl.textContent = "";
  delete statusEl.dataset.tone;
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetStatus();

  const fileInput = document.getElementById("plugin-file");
  const file = fileInput?.files?.[0] || null;
  if (!file) {
    setStatus("Selecciona un archivo ZIP del plugin", "error");
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  setStatus("Subiendo plugin…", "pending");

  try {
    const body = new FormData(form);
    const response = await fetch("/plugins/upload", {
      method: "POST",
      body
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = json?.error || response.statusText || "Error desconocido";
      throw new Error(detail);
    }
    setStatus("Plugin instalado correctamente. Redirigiendo…", "success");
    setTimeout(() => {
      window.location.href = "/plugins/auth-admin?justInstalled=1";
    }, 1200);
  } catch (err) {
    console.error("Plugin upload failed", err);
    setStatus(`No se pudo instalar el plugin: ${err.message || err}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
});
