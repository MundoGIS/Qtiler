import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PythonPool } from '../lib/PythonPool.js';

test('GetFeatureInfo has bounded reserved capacity and precedes queued tiles', async () => {
  const pool = Object.create(PythonPool.prototype);
  pool.size = 1;
  pool.maxQueueSize = 1;
  pool.queue = [{ params: { layers: ['fixture'] }, callback: {} }];
  pool.processQueue = () => {};
  const pending = pool.renderTile({ action: 'feature_info' });
  assert.equal(pool.queue[0].params.action, 'feature_info');
  assert.equal(pool.queue.length, 2);
  await assert.rejects(pool.renderTile({ action: 'feature_info' }), (err) => err.code === 'QUEUE_FULL');
  await assert.rejects(pool.renderTile({ layers: ['other'] }), (err) => err.code === 'QUEUE_FULL');
  pool.queue[0].callback.resolve({ status: 'success' });
  assert.equal((await pending).status, 'success');
});

test('a crashed worker rejects its current task and releases the busy state', async () => {
  const pool = Object.create(PythonPool.prototype);
  const worker = new EventEmitter();
  worker.busy = true;
  worker.currentTask = { action: 'feature_info' };
  const pending = new Promise((_resolve, reject) => { worker.currentCallback = { reject }; });
  pool.attachListeners(worker);
  worker.emit('crash', 1);
  await assert.rejects(pending, (err) => err.code === 'WORKER_CRASHED');
  assert.equal(worker.busy, false);
  assert.equal(worker.currentCallback, null);
  assert.equal(worker.currentTask, null);
});