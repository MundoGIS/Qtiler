param(
  [Parameter(Mandatory = $true)] [string] $Root,
  [Parameter(Mandatory = $true)] [string] $OutputPath,
  [string] $DefaultPreviousRoot = '',
  [string] $ProgressLog = '',
  [string] $InstallLog = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if (-not [string]::IsNullOrWhiteSpace($ProgressLog)) {
  $logoPath = Join-Path $Root 'public\css\images\MGIS-logo_azul.png'
  $progressForm = New-Object System.Windows.Forms.Form
  $progressForm.Text = 'Qtiler Installer - MundoGIS'
  $progressForm.StartPosition = 'CenterScreen'
  $progressForm.Size = New-Object System.Drawing.Size(690, 430)
  $progressForm.FormBorderStyle = 'FixedDialog'
  $progressForm.MaximizeBox = $false
  $progressForm.BackColor = [System.Drawing.Color]::White

  $progressHeader = New-Object System.Windows.Forms.Panel
  $progressHeader.Dock = 'Top'
  $progressHeader.Height = 106
  $progressHeader.BackColor = [System.Drawing.Color]::FromArgb(238, 246, 252)
  $progressForm.Controls.Add($progressHeader)
  if (Test-Path -LiteralPath $logoPath) {
    $progressLogo = New-Object System.Windows.Forms.PictureBox
    $progressLogo.Image = [System.Drawing.Image]::FromFile($logoPath)
    $progressLogo.SizeMode = 'Zoom'
    $progressLogo.Location = New-Object System.Drawing.Point(24, 18)
    $progressLogo.Size = New-Object System.Drawing.Size(190, 70)
    $progressHeader.Controls.Add($progressLogo)
  }
  $progressTitle = New-Object System.Windows.Forms.Label
  $progressTitle.Text = 'Installing Qtiler'
  $progressTitle.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
  $progressTitle.ForeColor = [System.Drawing.Color]::FromArgb(25, 71, 111)
  $progressTitle.Location = New-Object System.Drawing.Point(245, 18)
  $progressTitle.AutoSize = $true
  $progressHeader.Controls.Add($progressTitle)
  $progressSubtitle = New-Object System.Windows.Forms.Label
  $progressSubtitle.Text = 'Please keep this window open while Qtiler is configured.'
  $progressSubtitle.ForeColor = [System.Drawing.Color]::FromArgb(70, 90, 105)
  $progressSubtitle.Location = New-Object System.Drawing.Point(248, 58)
  $progressSubtitle.AutoSize = $true
  $progressHeader.Controls.Add($progressSubtitle)

  $progressPhase = New-Object System.Windows.Forms.Label
  $progressPhase.Text = 'Preparing installation...'
  $progressPhase.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
  $progressPhase.Location = New-Object System.Drawing.Point(42, 136)
  $progressPhase.Size = New-Object System.Drawing.Size(590, 30)
  $progressForm.Controls.Add($progressPhase)
  $progressDetail = New-Object System.Windows.Forms.Label
  $progressDetail.Text = 'Checking installer status.'
  $progressDetail.ForeColor = [System.Drawing.Color]::FromArgb(80, 95, 105)
  $progressDetail.Location = New-Object System.Drawing.Point(42, 174)
  $progressDetail.Size = New-Object System.Drawing.Size(590, 45)
  $progressForm.Controls.Add($progressDetail)
  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.Minimum = 0
  $progressBar.Maximum = 100
  $progressBar.Value = 1
  $progressBar.Style = 'Continuous'
  $progressBar.Location = New-Object System.Drawing.Point(42, 232)
  $progressBar.Size = New-Object System.Drawing.Size(590, 24)
  $progressForm.Controls.Add($progressBar)
  $progressPercent = New-Object System.Windows.Forms.Label
  $progressPercent.Text = '1%'
  $progressPercent.TextAlign = 'MiddleRight'
  $progressPercent.Location = New-Object System.Drawing.Point(42, 262)
  $progressPercent.Size = New-Object System.Drawing.Size(590, 24)
  $progressForm.Controls.Add($progressPercent)
  $progressClose = New-Object System.Windows.Forms.Button
  $progressClose.Text = 'Close'
  $progressClose.Enabled = $false
  $progressClose.Location = New-Object System.Drawing.Point(532, 328)
  $progressClose.Size = New-Object System.Drawing.Size(100, 32)
  $progressForm.Controls.Add($progressClose)
  $progressClose.Add_Click({ $progressForm.Close() })

  $script:installLogPosition = 0
  if ($InstallLog -and (Test-Path -LiteralPath $InstallLog)) {
    $script:installLogPosition = (Get-Item -LiteralPath $InstallLog).Length
  }
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 350
  $timer.Add_Tick({
    if (Test-Path -LiteralPath $ProgressLog) {
      $line = Get-Content -LiteralPath $ProgressLog -Tail 1 -ErrorAction SilentlyContinue
      if ($line) {
        $parts = $line -split '\|', 3
        if ($parts.Count -eq 3 -and $parts[1] -match '^\d+$') {
          $value = [Math]::Max(0, [Math]::Min(100, [int]$parts[1]))
          $progressBar.Value = $value
          $progressPercent.Text = "$value%"
          $progressPhase.Text = $parts[0]
          $progressDetail.Text = $parts[2]
          if ($parts[0] -eq 'Completed' -or $parts[0] -eq 'Error') {
            $progressClose.Enabled = $true
            $progressClose.Focus()
            $timer.Stop()
            $progressTitle.Text = if ($parts[0] -eq 'Completed') { 'Qtiler is ready' } else { 'Installation needs attention' }
            $progressPhase.ForeColor = if ($parts[0] -eq 'Completed') { [System.Drawing.Color]::FromArgb(30, 125, 75) } else { [System.Drawing.Color]::FromArgb(180, 45, 45) }
          }
        }
      }
    }
    if ($InstallLog -and (Test-Path -LiteralPath $InstallLog)) {
      $logLength = (Get-Item -LiteralPath $InstallLog -ErrorAction SilentlyContinue).Length
      if ($logLength -lt $script:installLogPosition) { $script:installLogPosition = 0 }
      $errorLine = $null
      if ($logLength -gt $script:installLogPosition) {
        $stream = [System.IO.File]::Open($InstallLog, 'Open', 'Read', 'ReadWrite')
        try {
          [void]$stream.Seek($script:installLogPosition, 'Begin')
          $reader = New-Object System.IO.StreamReader($stream)
          try { $newLogText = $reader.ReadToEnd() } finally { $reader.Dispose() }
          $script:installLogPosition = $logLength
          $errorLine = $newLogText -split '\r?\n' | Where-Object { $_ -match 'ERROR:' } | Select-Object -Last 1
        } finally {
          $stream.Dispose()
        }
      }
      if ($errorLine -and $progressClose.Enabled -eq $false) {
        $progressPhase.Text = 'Installation needs attention'
        $progressDetail.Text = $errorLine.Trim()
        $progressPhase.ForeColor = [System.Drawing.Color]::FromArgb(180, 45, 45)
        $progressClose.Enabled = $true
        $timer.Stop()
      }
    }
  })
  $progressForm.Add_Shown({ $timer.Start() })
  [void]$progressForm.ShowDialog()
  exit 0
}

$logoPath = Join-Path $Root 'public\css\images\MGIS-logo_azul.png'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Qtiler Installer - MundoGIS'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(690, 690)
$form.MinimumSize = $form.Size
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
$form.BackColor = [System.Drawing.Color]::White

$header = New-Object System.Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = 106
$header.BackColor = [System.Drawing.Color]::FromArgb(238, 246, 252)
$form.Controls.Add($header)

if (Test-Path -LiteralPath $logoPath) {
  $logo = New-Object System.Windows.Forms.PictureBox
  $logo.Image = [System.Drawing.Image]::FromFile($logoPath)
  $logo.SizeMode = 'Zoom'
  $logo.Location = New-Object System.Drawing.Point(24, 18)
  $logo.Size = New-Object System.Drawing.Size(190, 70)
  $header.Controls.Add($logo)
}
$title = New-Object System.Windows.Forms.Label
$title.Text = 'Qtiler'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(25, 71, 111)
$title.Location = New-Object System.Drawing.Point(245, 18)
$title.AutoSize = $true
$header.Controls.Add($title)
$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'MundoGIS installation wizard'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(70, 90, 105)
$subtitle.Location = New-Object System.Drawing.Point(248, 58)
$subtitle.AutoSize = $true
$header.Controls.Add($subtitle)

$panel = New-Object System.Windows.Forms.Panel
$panel.Location = New-Object System.Drawing.Point(26, 124)
$panel.Size = New-Object System.Drawing.Size(620, 460)
$form.Controls.Add($panel)

function Add-Label([string] $text, [int] $x, [int] $y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size(190, 24)
  $panel.Controls.Add($label)
}
function Add-TextBox([string] $value, [int] $x, [int] $y, [int] $width = 390) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Text = $value
  $box.Location = New-Object System.Drawing.Point($x, $y)
  $box.Size = New-Object System.Drawing.Size($width, 26)
  $panel.Controls.Add($box)
  return $box
}

Add-Label 'Installation mode' 8 8
$mode = New-Object System.Windows.Forms.ComboBox
$mode.DropDownStyle = 'DropDownList'
$mode.Items.AddRange(@('New installation', 'Update existing installation'))
$mode.SelectedIndex = 0
$mode.Location = New-Object System.Drawing.Point(205, 5)
$mode.Size = New-Object System.Drawing.Size(390, 26)
$panel.Controls.Add($mode)

Add-Label 'Profile' 8 48
$deploymentType = New-Object System.Windows.Forms.ComboBox
$deploymentType.DropDownStyle = 'DropDownList'
$deploymentType.Items.AddRange(@('Test', 'Production'))
$deploymentType.SelectedIndex = 0
$deploymentType.Location = New-Object System.Drawing.Point(205, 45)
$deploymentType.Size = New-Object System.Drawing.Size(390, 26)
$panel.Controls.Add($deploymentType)

Add-Label 'Existing Qtiler folder' 8 88
$previousRoot = Add-TextBox $DefaultPreviousRoot 205 85
$previousRoot.Enabled = $false

Add-Label 'Windows service name' 8 128
$serviceName = Add-TextBox 'QTiler' 205 125

function Find-QgisInstallation {
  $searchRoots = New-Object System.Collections.Generic.List[string]
  foreach ($knownRoot in @($env:QGIS_ROOT, 'C:\OSGeo4W', 'C:\OSGeo4W64')) {
    if (-not [string]::IsNullOrWhiteSpace($knownRoot)) { $searchRoots.Add($knownRoot) }
  }
  foreach ($parent in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\')) {
    if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(QGIS( |_)\d|OSGeo4W)' } |
      ForEach-Object { $searchRoots.Add($_.FullName) }
  }
  foreach ($candidate in ($searchRoots | Select-Object -Unique)) {
    $resolverOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\resolve-qgis-installation.ps1') -Path $candidate 2>$null
    foreach ($line in $resolverOutput) {
      if ($line -match '^QGIS_ROOT=(.+)$') { return $Matches[1] }
    }
  }
  return ''
}

Add-Label 'QGIS Desktop folder' 8 168
$qgisRoot = Add-TextBox (Find-QgisInstallation) 205 165 315
$browseQgis = New-Object System.Windows.Forms.Button
$browseQgis.Text = 'Browse...'
$browseQgis.Location = New-Object System.Drawing.Point(525, 164)
$browseQgis.Size = New-Object System.Drawing.Size(70, 27)
$browseQgis.UseVisualStyleBackColor = $true
$browseQgis.AccessibleName = 'Browse for the QGIS Desktop folder'
$panel.Controls.Add($browseQgis)
$qgisStatus = New-Object System.Windows.Forms.Label
$qgisStatus.Text = 'Select a QGIS 3.x installation folder.'
$qgisStatus.Location = New-Object System.Drawing.Point(205, 194)
$qgisStatus.Size = New-Object System.Drawing.Size(390, 22)
$panel.Controls.Add($qgisStatus)
$browseQgis.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select the QGIS Desktop installation folder.'
  $dialog.ShowNewFolderButton = $false
  if (-not [string]::IsNullOrWhiteSpace($qgisRoot.Text)) { $dialog.SelectedPath = $qgisRoot.Text.Trim() }
  if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
    $qgisRoot.Text = $dialog.SelectedPath.TrimEnd('\')
    Update-InstallerState
  }
})

Add-Label 'HTTP port' 8 232
$port = Add-TextBox '3000' 205 229 120

Add-Label 'Public HTTPS URL' 8 272
$publicUrl = Add-TextBox '' 205 269

Add-Label 'Admin password' 8 312
$password = Add-TextBox '' 205 309 315
$password.UseSystemPasswordChar = $true
$showPassword = New-Object System.Windows.Forms.Button
$showPassword.Text = 'Show'
$showPassword.Location = New-Object System.Drawing.Point(525, 308)
$showPassword.Size = New-Object System.Drawing.Size(70, 27)
$showPassword.UseVisualStyleBackColor = $true
$showPassword.AccessibleName = 'Show or hide administrator password'
$panel.Controls.Add($showPassword)
$showPassword.Add_Click({
  $password.UseSystemPasswordChar = -not $password.UseSystemPasswordChar
  $showPassword.Text = if ($password.UseSystemPasswordChar) { 'Show' } else { 'Hide' }
})

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Production can use a public HTTPS URL. Leave it blank for local HTTP.'
$hint.ForeColor = [System.Drawing.Color]::FromArgb(80, 95, 105)
$hint.Location = New-Object System.Drawing.Point(205, 344)
$hint.Size = New-Object System.Drawing.Size(390, 42)
$panel.Controls.Add($hint)

$licenseLink = New-Object System.Windows.Forms.LinkLabel
$licenseLink.Text = 'Read the Qtiler license terms'
$licenseLink.Location = New-Object System.Drawing.Point(205, 390)
$licenseLink.Size = New-Object System.Drawing.Size(240, 22)
$licenseLink.LinkColor = [System.Drawing.Color]::FromArgb(0, 102, 204)
$licenseLink.ActiveLinkColor = [System.Drawing.Color]::FromArgb(0, 71, 145)
$licenseLink.VisitedLinkColor = [System.Drawing.Color]::FromArgb(0, 102, 204)
$licenseLink.Add_LinkClicked({
  $licenseFile = Join-Path $Root 'LICENSE'
  if (Test-Path -LiteralPath $licenseFile) {
    Start-Process -FilePath $licenseFile | Out-Null
  } else {
    Start-Process -FilePath 'https://www.mozilla.org/en-US/MPL/2.0/' | Out-Null
  }
})
$panel.Controls.Add($licenseLink)

$licenseAccepted = New-Object System.Windows.Forms.CheckBox
$licenseAccepted.Text = 'I accept the Qtiler license terms and third-party notices.'
$licenseAccepted.Location = New-Object System.Drawing.Point(205, 418)
$licenseAccepted.Size = New-Object System.Drawing.Size(390, 36)
$licenseAccepted.Checked = $false
$panel.Controls.Add($licenseAccepted)

function Update-InstallerState {
  $selectedQgis = $qgisRoot.Text.Trim().TrimEnd('\\')
  $qgisReady = $false
  if (-not [string]::IsNullOrWhiteSpace($selectedQgis)) {
    $resolverOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\resolve-qgis-installation.ps1') -Path $selectedQgis 2>$null
    $resolved = @{}
    foreach ($line in $resolverOutput) {
      $parts = $line -split '=', 2
      if ($parts.Count -eq 2) { $resolved[$parts[0]] = $parts[1] }
    }
    $qgisReady = $resolved.ContainsKey('QGIS_ROOT') -and $resolved.ContainsKey('PYTHON_EXE')
  }

  $serviceName.Enabled = $qgisReady
  $port.Enabled = $qgisReady
  $publicUrl.Enabled = $qgisReady
  $password.Enabled = $qgisReady
  $showPassword.Enabled = $qgisReady
  $licenseLink.Enabled = $qgisReady
  $licenseAccepted.Enabled = $qgisReady

  if (-not $qgisReady) {
    $licenseAccepted.Checked = $false
    $qgisStatus.Text = 'No compatible QGIS 3.x runtime was found in this folder.'
    $qgisStatus.ForeColor = [System.Drawing.Color]::FromArgb(180, 45, 45)
  } else {
    $qgisStatus.Text = 'QGIS 3.x and its Python runtime are ready.'
    $qgisStatus.ForeColor = [System.Drawing.Color]::FromArgb(30, 125, 75)
  }

  $ok.Enabled = $qgisReady -and $licenseAccepted.Checked
}

$qgisRoot.Add_TextChanged({ Update-InstallerState })
$mode.Add_SelectedIndexChanged({
  $previousRoot.Enabled = ($mode.SelectedIndex -eq 1)
  Update-InstallerState
})
$licenseAccepted.Add_CheckedChanged({ Update-InstallerState })

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.Location = New-Object System.Drawing.Point(430, 605)
$cancel.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($cancel)
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Continue'
$ok.Location = New-Object System.Drawing.Point(540, 605)
$ok.Size = New-Object System.Drawing.Size(105, 32)
$ok.Enabled = $false
$form.Controls.Add($ok)
$form.CancelButton = $cancel
$form.AcceptButton = $ok

$ok.Add_Click({
  $errors = @()
  $selectedQgis = $qgisRoot.Text.Trim().TrimEnd('\\')
  $resolvedQgis = @{}
  if (-not [string]::IsNullOrWhiteSpace($selectedQgis)) {
    $resolverOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\resolve-qgis-installation.ps1') -Path $selectedQgis 2>$null
    foreach ($line in $resolverOutput) {
      $parts = $line -split '=', 2
      if ($parts.Count -eq 2) { $resolvedQgis[$parts[0]] = $parts[1] }
    }
  }
  if (-not $resolvedQgis.ContainsKey('QGIS_ROOT')) { $errors += 'QGIS Python was not found. Select the QGIS root, its apps\qgis-ltr folder, or an OSGeo4W root.' }
  if (-not $licenseAccepted.Checked) { $errors += 'You must accept the Qtiler license terms before continuing.' }
  if ($port.Text -notmatch '^\d+$' -or [int]$port.Text -lt 1 -or [int]$port.Text -gt 65535) { $errors += 'HTTP port must be between 1 and 65535.' }
  if ($serviceName.Text -notmatch '^[A-Za-z0-9._ -]{1,80}$') { $errors += 'Service name contains invalid characters.' }
  if ($mode.SelectedIndex -eq 1 -and [string]::IsNullOrWhiteSpace($previousRoot.Text)) { $errors += 'An existing Qtiler folder is required for update mode.' }
  if ($deploymentType.SelectedIndex -eq 1 -and $publicUrl.Text -and $publicUrl.Text -notmatch '^https://') { $errors += 'Production public URL must start with https://.' }
  if ($mode.SelectedIndex -eq 0 -and ($password.Text -notmatch '^[A-Za-z0-9._@#+=-]{8,128}$')) { $errors += 'New installations require an admin password of 8-128 allowed characters.' }
  if ($mode.SelectedIndex -eq 0 -and (Get-NetTCPConnection -LocalPort ([int]$port.Text) -State Listen -ErrorAction SilentlyContinue)) { $errors += 'The selected HTTP port is already in use. Choose another port.' }
  if ($errors.Count -gt 0) {
    [System.Windows.Forms.MessageBox]::Show(($errors -join [Environment]::NewLine), 'Qtiler Installer - Check settings', 'OK', 'Error') | Out-Null
    return
  }
  $lines = @(
    ('QTILER_SETUP_MODE=' + $(if ($mode.SelectedIndex -eq 1) { 'update' } else { 'new' }))
    ('QTILER_INSTALL_MODE=' + $(if ($deploymentType.SelectedIndex -eq 1) { 'production' } else { 'test' }))
    ('QTILER_PREVIOUS_ROOT=' + $previousRoot.Text.Trim())
    ('QTILER_SERVICE_NAME=' + $serviceName.Text.Trim())
    ('QGIS_ROOT=' + $resolvedQgis['QGIS_ROOT'])
    ('QGIS_PREFIX_DIR=' + $resolvedQgis['QGIS_PREFIX'])
    ('QGIS_PYTHON_EXE=' + $resolvedQgis['PYTHON_EXE'])
    ('OSGEO4W_BIN=' + $resolvedQgis['OSGEO4W_BIN'])
    ('QTILER_PORT=' + $port.Text.Trim())
    ('QTILER_PUBLIC_URL=' + $publicUrl.Text.Trim())
    ('QTILER_ADMIN_PASSWORD=' + $password.Text)
    'QTILER_LICENSE_ACCEPTED=1'
  )
  [System.IO.File]::WriteAllLines($OutputPath, [string[]]$lines, [System.Text.Encoding]::ASCII)
  $writtenLines = [System.IO.File]::ReadAllLines($OutputPath, [System.Text.Encoding]::ASCII)
  if ($writtenLines.Count -ne $lines.Count -or
      -not ($writtenLines -match '^QTILER_SETUP_MODE=(new|update)$') -or
      -not ($writtenLines -contains 'QTILER_LICENSE_ACCEPTED=1')) {
    [System.Windows.Forms.MessageBox]::Show('The installer could not save a valid configuration file. No changes were made to the system.', 'Qtiler Installer - Configuration Error', 'OK', 'Error') | Out-Null
    Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
    return
  }
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

Update-InstallerState

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
exit 0
