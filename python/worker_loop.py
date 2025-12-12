#!/usr/bin/env python3
"""
Persistent worker loop that accepts JSON lines on stdin describing jobs
and runs `generate_cache.py` for each job, streaming back JSON events.

Protocol (JSON lines):
  From master -> worker: {"cmd":"run","jobId":"<id>","args": ["--layer","...", ...]}

  From worker -> master: JSON lines with at least {"jobId":"<id>","event":"...", "data": ...}
Events: "started", "stdout", "stderr", "exit"

This is a minimal shim that keeps the worker process alive between tasks.
"""
import sys
import os
import json
import shlex
import subprocess
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_SCRIPT = os.path.join(ROOT, 'python', 'generate_cache.py')

def forward_stream(pipe, jobId, ev):
    try:
        for line in iter(pipe.readline, b''):
            try:
                text = line.decode('utf8', errors='replace') if isinstance(line, bytes) else str(line)
            except Exception:
                text = str(line)
            payload = {"jobId": jobId, "event": ev, "data": text.rstrip('\n')}
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    except Exception:
        pass

def run_job(jobId, args):
    cmd = [sys.executable, PY_SCRIPT] + args
    # Prefer to run with shell=FALSE so args are passed cleanly
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # notify started
    sys.stdout.write(json.dumps({"jobId": jobId, "event": "started"}) + "\n")
    sys.stdout.flush()

    t_out = threading.Thread(target=forward_stream, args=(proc.stdout, jobId, 'stdout'), daemon=True)
    t_err = threading.Thread(target=forward_stream, args=(proc.stderr, jobId, 'stderr'), daemon=True)
    t_out.start(); t_err.start()
    code = proc.wait()
    t_out.join(timeout=0.1)
    t_err.join(timeout=0.1)
    sys.stdout.write(json.dumps({"jobId": jobId, "event": "exit", "code": code}) + "\n")
    sys.stdout.flush()

def main_loop():
    # Read JSON lines from stdin
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            # ignore
            continue
        cmd = obj.get('cmd')
        if cmd == 'run':
            jobId = obj.get('jobId')
            args = obj.get('args') or []
            # Run job in background so loop can accept new commands
            t = threading.Thread(target=run_job, args=(jobId, args), daemon=True)
            t.start()
        elif cmd == 'ping':
            sys.stdout.write(json.dumps({"event":"pong"}) + "\n")
            sys.stdout.flush()

if __name__ == '__main__':
    try:
        main_loop()
    except KeyboardInterrupt:
        pass
