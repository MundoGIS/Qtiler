param(
  [Parameter(Mandatory = $true)] [string] $Root,
  [Parameter(Mandatory = $true)] [string] $OutputPath,
  [string] $DefaultPreviousRoot = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$logoPath = Join-Path $Root 'public\css\images\MGIS-logo_azul.png'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Qtiler Installer - MundoGIS'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(690, 650)
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
$panel.Size = New-Object System.Drawing.Size(620, 420)
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

Add-Label 'QGIS Desktop folder' 8 168
$qgisRoot = Add-TextBox 'C:\Program Files\QGIS 3.40' 205 165

Add-Label 'HTTP port' 8 208
$port = Add-TextBox '3000' 205 205 120

Add-Label 'Public HTTPS URL' 8 248
$publicUrl = Add-TextBox '' 205 245

Add-Label 'Admin password' 8 288
$password = Add-TextBox '' 205 285
$password.UseSystemPasswordChar = $true

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Production can use a public HTTPS URL. Leave it blank for local HTTP.'
$hint.ForeColor = [System.Drawing.Color]::FromArgb(80, 95, 105)
$hint.Location = New-Object System.Drawing.Point(205, 320)
$hint.Size = New-Object System.Drawing.Size(390, 42)
$panel.Controls.Add($hint)

$mode.Add_SelectedIndexChanged({ $previousRoot.Enabled = ($mode.SelectedIndex -eq 1) })

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancel.Location = New-Object System.Drawing.Point(430, 565)
$cancel.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($cancel)
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Continue'
$ok.Location = New-Object System.Drawing.Point(540, 565)
$ok.Size = New-Object System.Drawing.Size(105, 32)
$form.Controls.Add($ok)
$form.CancelButton = $cancel
$form.AcceptButton = $ok

$ok.Add_Click({
  $errors = @()
  $selectedQgis = $qgisRoot.Text.Trim().TrimEnd('\')
  $hasQgisPython = (Test-Path (Join-Path $selectedQgis 'bin\python.exe')) -or (Test-Path (Join-Path $selectedQgis 'bin\python3.exe')) -or (@(Get-ChildItem (Join-Path $selectedQgis 'apps\Python*\python.exe') -ErrorAction SilentlyContinue).Count -gt 0)
  $hasQgisPrefix = (Test-Path (Join-Path $selectedQgis 'apps\qgis\python')) -or (Test-Path (Join-Path $selectedQgis 'apps\qgis-ltr\python'))
  if ([string]::IsNullOrWhiteSpace($selectedQgis) -or -not $hasQgisPython -or -not $hasQgisPrefix) { $errors += 'Select a valid QGIS 3.x folder containing Python and apps\qgis or apps\qgis-ltr.' }
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
    'QTILER_SETUP_MODE=' + $(if ($mode.SelectedIndex -eq 1) { 'update' } else { 'new' }),
    'QTILER_INSTALL_MODE=' + $(if ($deploymentType.SelectedIndex -eq 1) { 'production' } else { 'test' }),
    'QTILER_PREVIOUS_ROOT=' + $previousRoot.Text.Trim(),
    'QTILER_SERVICE_NAME=' + $serviceName.Text.Trim(),
    'QGIS_ROOT=' + $qgisRoot.Text.Trim(),
    'QTILER_PORT=' + $port.Text.Trim(),
    'QTILER_PUBLIC_URL=' + $publicUrl.Text.Trim(),
    'QTILER_ADMIN_PASSWORD=' + $password.Text
  )
  Set-Content -LiteralPath $OutputPath -Value $lines -Encoding UTF8
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
exit 0
