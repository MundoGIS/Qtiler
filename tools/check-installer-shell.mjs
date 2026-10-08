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

test('service readiness retries startup and reports an unavailable QtilerAuth route', () => {
  const batch = fs.readFileSync('install.bat', 'utf8');
  const probe = fs.readFileSync('tools/wait-qtiler-readiness.ps1', 'utf8');
  assert.equal((batch.match(/wait-qtiler-readiness\.ps1/g) || []).length, 2);
  assert.ok(batch.includes('-TimeoutSeconds 300 %QTILER_READINESS_AUTH_SWITCH%'));
  assert.ok(batch.includes('-TimeoutSeconds 300 -RequireAuth'));
  assert.ok(probe.includes("-Method Post"));
  assert.ok(probe.includes("$lastAuthStatus -eq 429"));
  assert.ok(probe.includes('Last QtilerAuth HTTP status: $lastAuthStatus'));
  assert.ok(probe.includes('The Auth route is not registered'));
  assert.ok(probe.includes('Failed to load plugin QtilerAuth'));
});

test('installation result is shown in the progress window and failure includes support contact', () => {
  const batch = fs.readFileSync('install.bat', 'utf8');
  const gui = fs.readFileSync('tools/qtiler-installer-gui.ps1', 'utf8');
  assert.ok(!batch.includes('Qtiler Installation Complete'));
  assert.ok(batch.includes('Admin password: stored in .env'));
  assert.ok(gui.includes('$script:installWorker.ExitCode -eq 0'));
  assert.ok(gui.includes('Installation completed successfully'));
  assert.ok(gui.includes('For help with this installation, contact support@mundogis.se.'));
  assert.ok(gui.includes("$progressResult.Visible = $true"));
  assert.ok(batch.includes('if not defined QTILER_GUI_WORKER powershell') && batch.includes('Service Readiness Failed'));
});