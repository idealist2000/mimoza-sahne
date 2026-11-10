$ErrorActionPreference = 'Stop'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node -or [int]((& $node.Source --version).TrimStart('v').Split('.')[0]) -lt 22) {
    throw 'Install Node.js 22 or newer before installing Mimoza Sahne.'
}
$target = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MimozaSahne'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$null = New-Item -Path $target -ItemType Directory -Force
$archive = Join-Path $env:TEMP ('MimozaSahne-' + [guid]::NewGuid() + '.zip')
try {
    $content = [IO.File]::ReadAllText($env:MIMOZA_SETUP_FILE)
    $marker = ':MIMOZA_PAYLOAD'
    $start = $content.LastIndexOf($marker) + $marker.Length
    [IO.File]::WriteAllBytes($archive, [Convert]::FromBase64String($content.Substring($start)))
    Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop 'Mimoza Sahne.lnk'))
    $shortcut.TargetPath = Join-Path $target 'baslat.cmd'
    $shortcut.WorkingDirectory = $target
    $shortcut.Description = 'Mimoza Sahne'
    $shortcut.Save()
    Write-Host 'Mimoza Sahne is ready. Open the Mimoza Sahne desktop shortcut.'
} finally {
    Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue
}
