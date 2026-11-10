$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot 'dist'
$null = New-Item -ItemType Directory -Force -Path $dist
$names = @('app.js', 'capture.js', 'workspace.js', 'lesson.js', 'profiles.js', 'publish.js', 'ai-draft.mjs', 'live.mjs', 'transcribe.mjs', 'youtube.mjs', 'index.html', 'style.css', 'server.mjs', 'baslat.cmd', 'README.md', 'LICENSE')
$archive = Join-Path $dist ('payload-' + [guid]::NewGuid() + '.zip')
try {
    Compress-Archive -LiteralPath ($names | ForEach-Object { Join-Path $PSScriptRoot $_ }) -DestinationPath $archive
    $payload = [Convert]::ToBase64String([IO.File]::ReadAllBytes($archive), [Base64FormattingOptions]::InsertLineBreaks)
    $script = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'install-windows.ps1')
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    $lines = @(
        '@echo off',
        'setlocal',
        'set "MIMOZA_SETUP_FILE=%~f0"',
        ('powershell.exe -NoProfile -EncodedCommand ' + $encoded),
        'set "MIMOZA_SETUP_RESULT=%errorlevel%"',
        'pause',
        'exit /b %MIMOZA_SETUP_RESULT%',
        ':MIMOZA_PAYLOAD',
        $payload
    )
    $path = Join-Path $dist 'Mimoza-Sahne-Kurulum.cmd'
    [IO.File]::WriteAllLines($path, $lines, [Text.Encoding]::ASCII)
    Write-Host $path
} finally {
    Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue
}



