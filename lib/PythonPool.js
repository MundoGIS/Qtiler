/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

/* lib/PythonPool.js */
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import EventEmitter from 'events';
import fs from 'fs';
import { recordProjectDiagnostic } from './projectDiagnostics.js';

const lastQueueDiagnosticAt = new Map();

// Configuración del entorno QGIS para Windows (basado en tu .env)
const makeQgisEnv = () => {
  const env = { ...process.env };
  const qgisRoot = env.QGIS_PREFIX || process.env.QGIS_PREFIX;
  const appsRoot = path.resolve(qgisRoot, '..');
  const pythonHome = env.PYTHONHOME || fs.readdirSync(appsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^Python\d+$/i.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
    .map(entry => path.join(appsRoot, entry.name))[0];
  if (!pythonHome) throw new Error(`No QGIS Python runtime found below ${appsRoot}`);
  const pythonLib = path.join(pythonHome, 'Lib');
  const qgisPy = path.join(qgisRoot, 'python');                // C:\QGIS_344\apps\qgis\python
  const qgisBin = path.join(qgisRoot, '..', '..', 'bin');      // C:\QGIS_344\bin
  const qgisAppBin = path.join(qgisRoot, 'bin');               // C:\QGIS_344\apps\qgis\bin
  const qt6Bin = path.join(qgisRoot, '..', 'Qt6', 'bin');      // C:\QGIS_344\apps\Qt6\bin
  const qt5Bin = path.join(qgisRoot, '..', 'Qt5', 'bin');      // C:\QGIS_344\apps\Qt5\bin

  // PATH: anteponer bin y apps\qgis\bin
  const pathParts = (env.PATH || '').split(';').filter(Boolean);
  const prepend = [qgisBin, qt6Bin, qt5Bin, qgisAppBin];
  env.PATH = [...new Set([...prepend, ...pathParts])].join(';');

  // PYTHONHOME y PYTHONPATH
  env.PYTHONHOME = pythonHome;
  env.PYTHONPATH = [pythonLib, qgisPy].join(';');

  // Otros flags
  env.PYTHONNOUSERSITE = '1';
  env.PYTHONUTF8 = '1';
  env.QGIS_PREFIX = qgisRoot;
  env.PYTHONUNBUFFERED = "1";

  // PROJ / GDAL data (needed for SRS, transformations)
  const qgisInstall = path.join(qgisRoot, '..', '..'); // C:\GIS\QGIS 3.44.6
  const projShare = path.join(qgisInstall, 'share', 'proj');
  const gdalShare = path.join(qgisInstall, 'share', 'gdal');
  if (!env.PROJ_LIB && fs.existsSync(projShare)) env.PROJ_LIB = projShare;
  if (!env.PROJ_DATA && fs.existsSync(projShare)) env.PROJ_DATA = projShare;
  if (!env.GDAL_DATA && fs.existsSync(gdalShare)) env.GDAL_DATA = gdalShare;
  
  const qt6Plugins = path.join(qgisRoot, '..', 'Qt6', 'plugins');
  const qgisPlugins = path.join(qgisRoot, 'qtplugins');
  env.QT_PLUGIN_PATH = env.QT_PLUGIN_PATH || `${qgisPlugins};${qt6Plugins}`;
  env.QT_QPA_PLATFORM_PLUGIN_PATH = env.QT_QPA_PLATFORM_PLUGIN_PATH || `${qt6Plugins}\\platforms`;

  return env;
};

export { makeQgisEnv };

class PythonWorker extends EventEmitter {
  constructor(id, scriptPath, poolRef) {
    super();
    this.id = id;
    this.scriptPath = scriptPath;
    this.poolRef = poolRef || null;
    this.process = null;
    this.busy = false;
    this.suspendRestart = false;
    this.expectedAbort = false;
    this.start();
  }

  start() {
    this.expectedAbort = false;
    const pythonExe = process.env.PYTHON_EXE || 'python';
    
    // Lanzamos el proceso persistente
    this.process = spawn(pythonExe, [this.scriptPath], {
      env: makeQgisEnv(),
      stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    console.log(`[Worker ${this.id}] Iniciado (PID: ${this.process.pid})`);
    recordProjectDiagnostic('info', 'qgis-worker', 'Worker started', { workerId: this.id, workerPid: this.process.pid });
    this.process.once('spawn', () => this.poolRef?.processQueue());

    // Leer stdout línea por línea (JSON responses)
    const rl = readline.createInterface({ input: this.process.stdout });
    
    rl.on('line', (line) => {
      try {
        if (!line.trim()) return;
        const result = JSON.parse(line);
        this.emit('success', result);
      } catch (err) {
        console.error(`[Worker ${this.id}] JSON Error:`, err, "Raw:", line);
        recordProjectDiagnostic('error', 'qgis-worker', 'Worker returned invalid JSON', {
          workerId: this.id,
          message: err?.message || String(err),
          responsePreview: line.slice(0, 1200)
        });
        this.emit('error', new Error("Respuesta inválida del worker: " + line));
      }
    });

    // Capturar errores de stderr (logs de Python/QGIS)
    this.process.stderr.on('data', (data) => {
      // Opcional: filtrar warnings de Qt irrelevantes
      const message = data.toString().trim();
      if (!message) return;
      console.warn(`[Worker ${this.id} LOG] ${message}`);
      if (/traceback|\b(error|exception|fatal)\b|failed to|could not|cannot /i.test(message)) {
        recordProjectDiagnostic('error', 'qgis-worker', 'QGIS worker reported an error', {
          workerId: this.id,
          message: message.slice(0, 1800)
        });
      }
    });

    this.process.on('exit', (code) => {
      const expectedAbort = this.expectedAbort || this.suspendRestart || Boolean(this.poolRef?.suspended);
      console.warn(`[Worker ${this.id}] Murió con código ${code}. Reiniciando...`);
      recordProjectDiagnostic(expectedAbort ? 'info' : 'error', 'qgis-worker', expectedAbort ? 'Worker stopped intentionally' : 'Worker process exited unexpectedly', {
        workerId: this.id,
        exitCode: code,
        expectedAbort,
        action: this.currentTask?.action || null,
        taskDurationMs: this.currentStartedAt ? Date.now() - this.currentStartedAt : null
      });
      this.lastExitExpectedAbort = expectedAbort;
      this.expectedAbort = false;
      this.emit('crash', code);
      this.process = null;
      // If the pool requested suspension, don't auto-restart
      const poolSuspended = this.poolRef && this.poolRef.suspended;
      if (this.suspendRestart || poolSuspended) {
        console.warn(`[Worker ${this.id}] Restart suppressed (suspendRestart=${this.suspendRestart}, poolSuspended=${poolSuspended})`);
        return;
      }
      // Reinicio automático simple
      setTimeout(() => this.start(), 2000);
    });
  }

  run(task) {
    if (this.busy) return false;
    this.busy = true;
    this.currentTask = task;
    this.currentStartedAt = Date.now();
    
    // Enviar tarea a Python como una línea JSON
    try {
      this.process.stdin.write(JSON.stringify(task) + '\n');
      return true;
    } catch (e) {
      this.busy = false;
      this.currentTask = null;
      this.emit('error', e);
      return false;
    }
  }

  // Request the worker to stop and suppress automatic restart
  stopAndSuppressRestart() {
    try {
      this.suspendRestart = true;
      if (this.process) {
        this.expectedAbort = true;
        try { this.process.kill(); } catch {};
      }
    } catch (e) {
      // ignore
    }
  }
}

export class PythonPool {
  constructor(scriptPath, size = 4) {
    this.scriptPath = scriptPath;
    this.size = size;
    const configuredQueueSize = Number.parseInt(process.env.PY_WORKER_MAX_QUEUE || '', 10);
    this.maxQueueSize = Number.isFinite(configuredQueueSize) && configuredQueueSize > 0
      ? Math.min(configuredQueueSize, 4096)
      : size * 8;
    this.suppressedActions = new Map();
    this.workers = [];
    this.queue = [];
    this.suspended = false;
    this.init();
  }

  taskPriority(params) {
    if (['feature_info', 'getfeatureinfo'].includes(params?.action)) return 0;
    if (params?.priority === 'background') return 1;
    if (params?.action === 'legend') return 3;
    return 2;
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      const worker = new PythonWorker(i + 1, this.scriptPath, this);
      this.attachListeners(worker);
      this.workers.push(worker);
    }
  }

  // Suspend the pool: abort queued tasks, stop workers and prevent auto-restart
  suspend() {
    try {
      this.suspended = true;
      // reject queued
      if (Array.isArray(this.queue)) {
        for (const item of this.queue) {
          try { item?.callback?.reject?.(new Error('pool_suspended')); } catch {}
        }
      }
      this.queue = [];
      for (const w of this.workers) {
        try { w.stopAndSuppressRestart(); } catch {}
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Resume the pool: clear suspended flag and start workers that are not running
  resume() {
    try {
      this.suspended = false;
      for (const w of this.workers) {
        try {
          w.suspendRestart = false;
          if (!w.process) {
            w.start();
          }
        } catch (e) {
          // ignore per-worker errors
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  attachListeners(worker) {
    worker.on('crash', (code) => {
      const failedTask = worker.currentTask;
      const unexpectedLegendCrash = failedTask?.action === 'legend' && !worker.lastExitExpectedAbort;
      if (unexpectedLegendCrash) {
        const cooldownMsRaw = Number(process.env.QTILER_WMS_LEGEND_FAILURE_COOLDOWN_MS || 120000);
        const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(10000, cooldownMsRaw) : 120000;
        this.suppressedActions.set('legend', Date.now() + cooldownMs);
        const cancelledLegends = this.cancelQueued((params) => params?.action === 'legend');
        recordProjectDiagnostic('warn', 'qgis-legend', 'Legend rendering paused after a native worker crash', {
          cooldownMs,
          cancelledQueuedLegends: cancelledLegends
        });
      }
      worker.currentCallback?.reject(Object.assign(new Error(`QGIS worker exited (${code})`), { code: 'WORKER_CRASHED' }));
      worker.busy = false;
      worker.currentCallback = null;
      worker.currentTask = null;
      worker.currentStartedAt = null;
      worker.lastExitExpectedAbort = false;
      if (unexpectedLegendCrash) {
        recordProjectDiagnostic('warn', 'qgis-legend', 'Legend renderer paused after a native worker crash', { exitCode: code });
      }
      setImmediate(() => this.processQueue());
    });
    worker.on('success', (result) => {
      // Recuperar la promesa pendiente de este worker
      const taskCallback = worker.currentCallback;
      const durationMs = worker.currentStartedAt ? Date.now() - worker.currentStartedAt : null;
      if (result?.status !== 'success' || (durationMs != null && durationMs >= 10000)) {
        const task = worker.currentTask || {};
        const projectFile = path.basename(String(task.project_path || '')).slice(0, 160);
        const requestedLayers = Array.isArray(task.layers)
          ? task.layers.slice(0, 20).map((layer) => String(layer || '').slice(0, 100))
          : [task.layer || task.type_name || task.typename].filter(Boolean).map((layer) => String(layer).slice(0, 100));
        recordProjectDiagnostic(result?.status === 'success' ? 'warn' : 'error', 'qgis-task', result?.status === 'success' ? 'Slow task completed' : 'Task returned an error', {
          workerId: worker.id,
          action: task.action || null,
          projectFile,
          requestedLayers,
          durationMs,
          errorCode: result?.code || null,
          errorMessage: result?.message || result?.error || null
        });
      }
      if (taskCallback) {
        if (result.error) taskCallback.reject(new Error(result.error));
        else taskCallback.resolve(result);
      }
      
      worker.busy = false;
      worker.currentCallback = null;
      worker.currentTask = null;
      worker.currentStartedAt = null;
      this.processQueue(); // Ver si hay más trabajo
    });

    worker.on('error', (err) => {
      const taskCallback = worker.currentCallback;
      recordProjectDiagnostic('error', 'qgis-worker', 'Worker communication failed', {
        workerId: worker.id,
        action: worker.currentTask?.action || null,
        message: err?.message || String(err)
      });
      if (taskCallback) taskCallback.reject(err);
      
      worker.busy = false;
      worker.currentCallback = null;
      worker.currentTask = null;
      worker.currentStartedAt = null;
      this.processQueue();
    });
  }

  processQueue() {
    if (this.queue.length === 0) return;

    const freeWorker = this.workers.find(w => !w.busy && w.process);
    if (!freeWorker) return;
    const hasBusyLegend = this.workers.some((worker) => worker?.busy && worker.currentTask?.action === 'legend');
    const foregroundIndex = this.queue.reduce((bestIndex, entry, index, queue) => {
      if (hasBusyLegend && entry.params?.action === 'legend') return bestIndex;
      return bestIndex < 0 || this.taskPriority(entry.params) < this.taskPriority(queue[bestIndex].params) ? index : bestIndex;
    }, -1);
    if (foregroundIndex < 0) return;
    const taskIndex = foregroundIndex;
    const [taskData] = this.queue.splice(taskIndex, 1);
    freeWorker.currentCallback = taskData.callback;
    freeWorker.run(taskData.params);
  }

  isActionSuppressed(action) {
    const key = String(action || '');
    const until = Number(this.suppressedActions?.get(key) || 0);
    if (!until) return false;
    if (until > Date.now()) return true;
    this.suppressedActions.delete(key);
    return false;
  }

  // Método público para pedir un render
  renderTile(params) {
    return new Promise((resolve, reject) => {
      // Cap the queue to prevent a burst of requests (e.g. from QWC2 layer
      // toggle) from monopolising all workers and starving other clients.
      // Increased from size*4 to size*8 to handle concurrent WFS layer loading.
      const maxQueued = typeof this.maxQueueSize === 'number' ? this.maxQueueSize : this.size * 8;
      const interactive = ['feature_info', 'getfeatureinfo'].includes(params?.action);
      const background = params?.action === 'legend';
      if (this.isActionSuppressed(params?.action)) {
        return reject(Object.assign(new Error('action_temporarily_suppressed'), { code: 'ACTION_COOLDOWN' }));
      }
      const backgroundLimit = Math.max(1, Math.min(maxQueued, this.size));
      const backgroundQueued = this.queue.filter((entry) => entry.params?.action === 'legend').length;
      const queueFull = background
        ? backgroundQueued >= backgroundLimit
        : this.queue.length >= maxQueued + (interactive ? Math.max(1, this.size) : 0);
      const limit = background ? backgroundLimit : maxQueued + (interactive ? Math.max(1, this.size) : 0);
      if (queueFull) {
        const action = String(params?.action || 'unknown');
        const lastAt = lastQueueDiagnosticAt.get(action) || 0;
        if (Date.now() - lastAt >= 5000) {
          lastQueueDiagnosticAt.set(action, Date.now());
          recordProjectDiagnostic('error', 'qgis-queue', 'Task rejected because the worker queue is full', {
            action,
            queuedTasks: this.queue.length,
            queueLimit: limit,
            workers: this.size
          });
        }
        return reject(Object.assign(new Error('queue_full'), { code: 'QUEUE_FULL' }));
      }
      const task = {
        params,
        callback: { resolve, reject }
      };
      if (interactive) {
        const firstLowerPriority = this.queue.findIndex((entry) => this.taskPriority(entry.params) > this.taskPriority(params));
        this.queue.splice(firstLowerPriority < 0 ? this.queue.length : firstLowerPriority, 0, task);
      } else {
        const firstLowerPriority = this.queue.findIndex((entry) => this.taskPriority(entry.params) > this.taskPriority(params));
        this.queue.splice(firstLowerPriority < 0 ? this.queue.length : firstLowerPriority, 0, task);
      }
      this.processQueue();
    });
  }

  // Cancel queued (not yet started) tasks that match a predicate.
  // Note: running tasks cannot be cancelled with the current persistent-worker design.
  cancelQueued(predicate) {
    if (typeof predicate !== 'function') return 0;
    if (!Array.isArray(this.queue) || this.queue.length === 0) return 0;
    const kept = [];
    let cancelled = 0;
    for (const item of this.queue) {
      try {
        if (item && predicate(item.params)) {
          cancelled += 1;
          try { item.callback && item.callback.reject && item.callback.reject(new Error('aborted')); } catch {}
          continue;
        }
      } catch {
        // ignore predicate errors
      }
      kept.push(item);
    }
    this.queue = kept;
    return cancelled;
  }

  // Abort queued + running tasks that match a predicate.
  // Running tasks are aborted by killing the worker process; it auto-restarts.
  abortMatching(predicate, { reason = 'aborted' } = {}) {
    if (typeof predicate !== 'function') {
      return { cancelledQueued: 0, abortedRunning: 0 };
    }

    let cancelledQueued = 0;
    try {
      if (Array.isArray(this.queue) && this.queue.length) {
        const kept = [];
        for (const item of this.queue) {
          let shouldAbort = false;
          try {
            shouldAbort = !!predicate(item?.params);
          } catch {
            shouldAbort = false;
          }
          if (shouldAbort) {
            cancelledQueued += 1;
            try { item?.callback?.reject?.(new Error(reason)); } catch {}
            continue;
          }
          kept.push(item);
        }
        this.queue = kept;
      }
    } catch {}

    let abortedRunning = 0;
    try {
      for (const worker of this.workers) {
        if (!worker || !worker.busy) continue;
        let shouldAbort = false;
        try {
          shouldAbort = !!predicate(worker.currentTask);
        } catch {
          shouldAbort = false;
        }
        if (!shouldAbort) continue;

        abortedRunning += 1;
        worker.expectedAbort = true;
        try { worker.currentCallback?.reject?.(new Error(reason)); } catch {}
        try { worker.busy = false; } catch {}
        try { worker.currentCallback = null; } catch {}
        try { worker.currentTask = null; } catch {}
        try { if (worker.process) worker.process.kill(); } catch {}
      }
    } catch {}

    return { cancelledQueued, abortedRunning };
  }

  // Abort all queued + currently running tasks.
  // This is a best-effort "stop now" control meant for admin use.
  // Running tasks are stopped by killing the worker process; it will auto-restart.
  abortAll({ reason = 'aborted' } = {}) {
    let cancelledQueued = 0;
    let abortedRunning = 0;
    try {
      if (Array.isArray(this.queue) && this.queue.length) {
        cancelledQueued = this.queue.length;
        for (const item of this.queue) {
          try { item?.callback?.reject?.(new Error(reason)); } catch {}
        }
        this.queue = [];
      }
    } catch {}

    try {
      for (const worker of this.workers) {
        if (!worker) continue;
        try {
          if (worker.currentCallback) {
            abortedRunning += 1;
            try { worker.currentCallback.reject(new Error(reason)); } catch {}
          }
        } catch {}
        try {
          worker.busy = false;
          worker.currentCallback = null;
          worker.currentTask = null;
        } catch {}
        try {
          if (worker.process) {
            worker.expectedAbort = true;
            worker.process.kill();
          }
        } catch {}
      }
    } catch {}

    return { cancelledQueued, abortedRunning };
  }
  
  // Método para cerrar todo suavemente (shutdown)
  close() {
    this.workers.forEach(w => w.process && w.process.kill());
  }
}