$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'out'))
$stageRoot = [IO.Path]::GetFullPath((Join-Path $outRoot 'wasa-weather-builder-windows'))
$downloadRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'downloads'))
$zipPath = [IO.Path]::GetFullPath((Join-Path $downloadRoot 'wasa-weather-builder-windows.zip'))

foreach ($path in @($outRoot, $stageRoot, $downloadRoot, $zipPath)) {
    if (-not $path.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output path is outside the repository: $path"
    }
}

if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$files = @(
    'start-weather-builder.bat',
    'scripts/weather-builder/app.js',
    'scripts/weather-builder/build.cjs',
    'scripts/weather-builder/convert.py',
    'scripts/weather-builder/index.html',
    'scripts/weather-builder/plan.cjs',
    'scripts/weather-builder/requirements.txt',
    'scripts/weather-builder/server.cjs',
    'scripts/weather-builder/suggest.cjs',
    'js/pred/weather-package.js',
    'poc/browser-predictor/fixtures/terrain.json',
    'poc/browser-predictor/fixtures/terrain.bin'
)

foreach ($relative in $files) {
    $source = Join-Path $projectRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required file is missing: $relative" }
    $destination = Join-Path $stageRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

$readme = @(
    '# WASA Weather Builder for Windows',
    '',
    '## Requirements',
    '',
    '- Windows 11',
    '- Node.js 20.3 or later',
    '- Docker Desktop (WSL2 backend)',
    '',
    '## Usage',
    '',
    '1. Extract this ZIP.',
    '2. Double-click start-weather-builder.bat.',
    '3. Choose the date, location, duration, and region in the opened page.',
    '4. Review the suggested range and start the build.',
    '5. Import the generated .wasawx file into the simulator.',
    '',
    'Weather Builder downloads a regional subset of NOAA GFS. It does not call a flight prediction API.'
) -join [Environment]::NewLine
Set-Content -LiteralPath (Join-Path $stageRoot 'README.md') -Value $readme -Encoding utf8

New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
$stream = [IO.File]::OpenRead($zipPath)
try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha256.Dispose() }
}
finally { $stream.Dispose() }
$size = (Get-Item -LiteralPath $zipPath).Length
Write-Output "Created $zipPath"
Write-Output "Size: $size bytes"
Write-Output "SHA256: $hash"
