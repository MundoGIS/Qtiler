import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('installer GUI reads bundled license documents without Windows file associations', () => {
  const gui = fs.readFileSync('tools/qtiler-installer-gui.ps1', 'utf8');
  assert.ok(fs.existsSync('LICENSE'));
  assert.ok(fs.existsSync('THIRD-PARTY-LICENSES.txt'));
  assert.ok(gui.includes("@('LICENSE', 'THIRD-PARTY-LICENSES.txt')"));
  assert.ok(gui.includes('[IO.File]::ReadAllText($document)'));
  assert.ok(!gui.includes('Start-Process -FilePath $licenseFile'));
  assert.ok(gui.includes('$qgisReady -and $documentsReady -and $licenseAccepted.Checked'));
});

test('single-window entry point launches a hidden worker and embeds its logs', () => {
  const launcher = fs.readFileSync('install.vbs', 'utf8');
  const batch = fs.readFileSync('install.bat', 'utf8');
  const gui = fs.readFileSync('tools/qtiler-installer-gui.ps1', 'utf8');
  assert.ok(launcher.includes('shell.Run command, 0, False'));
  assert.ok(launcher.includes('-RunInstaller'));
  assert.ok(batch.includes('if not defined QTILER_GUI_WORKER'));
  assert.ok(batch.includes('if defined QTILER_GUI_WORKER goto progress_window_ready'));
  assert.ok(gui.includes('$startInfo.CreateNoWindow = $true'));
  assert.ok(gui.includes('$startInfo.RedirectStandardOutput = $true'));
  assert.ok(gui.includes('$startInfo.RedirectStandardError = $true'));
  assert.ok(gui.includes('$logViewer.AppendText'));
  assert.ok(gui.includes('$drainedLines -lt 100'));
  assert.ok(gui.includes('$1=[REDACTED]'));
});