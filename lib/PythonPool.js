/* lib/PythonPool.js */
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import EventEmitter from 'events';
import fs from 'fs';

// Configuración del entorno QGIS para Windows (basado en tu .env)
const makeQgisEnv = () => {
  const env = { ...process.env };
  // Rutas reales según tu instalación
  const qgisRoot = env.QGIS_PREFIX || process.env.QGIS_PREFIX; // C:\QGIS_344\apps\qgis
  const pythonHome = path.join(qgisRoot, '..', 'Python312');   // C:\QGIS_344\apps\Python312
  const pythonLib = path.join(pythonHome, 'Lib');              // C:\QGIS_344\apps\Python312\Lib
  const qgisPy = path.join(qgisRoot, 'python');                // C:\QGIS_344\apps\qgis\python
  const qgisBin = path.join(qgisRoot, '..', '..', 'bin');      // C:\QGIS_344\bin
  const qgisAppBin = path.join(qgisRoot, 'bin');               // C:\QGIS_344\apps\qgis\bin

  // PATH: anteponer bin y apps\qgis\bin
  const pathParts = (env.PATH || '').split(';').filter(Boolean);
  const prepend = [qgisBin, qgisAppBin];
  env.PATH = [...new Set([...prepend, ...pathParts])].join(';');

  // PYTHONHOME y PYTHONPATH
  env.PYTHONHOME = pythonHome;
  env.PYTHONPATH = [pythonLib, qgisPy].join(';');

  // Otros flags
  env.PYTHONNOUSERSITE = '1';
  env.PYTHONUTF8 = '1';
  env.QGIS_PREFIX = qgisRoot;
  env.PYTHONUNBUFFERED = "1";
  if (env.QT_PLUGIN_PATH) env.QT_PLUGIN_PATH = env.QT_PLUGIN_PATH;
  return env;
};

class PythonWorker extends EventEmitter {
  constructor(id, scriptPath) {
    super();
    this.id = id;
    this.scriptPath = scriptPath;
    this.process = null;
    this.busy = false;
    this.start();
  }

  start() {
    const pythonExe = process.env.PYTHON_EXE || 'python';
    
    // Lanzamos el proceso persistente
    this.process = spawn(pythonExe, [this.scriptPath], {
      env: makeQgisEnv(),
      stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    console.log(`[Worker ${this.id}] Iniciado (PID: ${this.process.pid})`);

    // Leer stdout línea por línea (JSON responses)
    const rl = readline.createInterface({ input: this.process.stdout });
    
    rl.on('line', (line) => {
      try {
        if (!line.trim()) return;
        const result = JSON.parse(line);
        this.emit('success', result);
      } catch (err) {
        console.error(`[Worker ${this.id}] JSON Error:`, err, "Raw:", line);
        this.emit('error', new Error("Respuesta inválida del worker: " + line));
      }
    });

    // Capturar errores de stderr (logs de Python/QGIS)
    this.process.stderr.on('data', (data) => {
      // Opcional: filtrar warnings de Qt irrelevantes
      console.warn(`[Worker ${this.id} LOG] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      console.warn(`[Worker ${this.id}] Murió con código ${code}. Reiniciando...`);
      this.emit('crash', code);
      this.process = null;
      // Reinicio automático simple
      setTimeout(() => this.start(), 2000);
    });
  }

  run(task) {
    if (this.busy) return false;
    this.busy = true;
    
    // Enviar tarea a Python como una línea JSON
    try {
      this.process.stdin.write(JSON.stringify(task) + '\n');
      return true;
    } catch (e) {
      this.busy = false;
      this.emit('error', e);
      return false;
    }
  }
}

export class PythonPool {
  constructor(scriptPath, size = 4) {
    this.scriptPath = scriptPath;
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.init();
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      const worker = new PythonWorker(i + 1, this.scriptPath);
      this.attachListeners(worker);
      this.workers.push(worker);
    }
  }

  attachListeners(worker) {
    worker.on('success', (result) => {
      // Recuperar la promesa pendiente de este worker
      const taskCallback = worker.currentCallback;
      if (taskCallback) {
        if (result.error) taskCallback.reject(new Error(result.error));
        else taskCallback.resolve(result);
      }
      
      worker.busy = false;
      worker.currentCallback = null;
      this.processQueue(); // Ver si hay más trabajo
    });

    worker.on('error', (err) => {
      const taskCallback = worker.currentCallback;
      if (taskCallback) taskCallback.reject(err);
      
      worker.busy = false;
      worker.currentCallback = null;
      this.processQueue();
    });
  }

  processQueue() {
    if (this.queue.length === 0) return;

    // Buscar worker libre
    const freeWorker = this.workers.find(w => !w.busy && w.process);
    
    if (freeWorker) {
      const taskData = this.queue.shift();
      freeWorker.currentCallback = taskData.callback;
      freeWorker.run(taskData.params);
    }
  }

  // Método público para pedir un render
  renderTile(params) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        params,
        callback: { resolve, reject }
      });
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
        } catch {}
        try {
          if (worker.process) {
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