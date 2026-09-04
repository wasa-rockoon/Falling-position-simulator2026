param(
    [string]$CssImageDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'css\images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $CssImageDirectory 'ui-icons_444444_256x240.png'
if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Source sprite not found: $sourcePath"
}

function New-RecoloredSprite {
    param(
        [Parameter(Mandatory = $true)][string]$TargetName,
        [Parameter(Mandatory = $true)][string]$HexColor
    )

    $red = [Convert]::ToInt32($HexColor.Substring(0, 2), 16)
    $green = [Convert]::ToInt32($HexColor.Substring(2, 2), 16)
    $blue = [Convert]::ToInt32($HexColor.Substring(4, 2), 16)
    $source = [System.Drawing.Bitmap]::new($sourcePath)
    $target = [System.Drawing.Bitmap]::new($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

    try {
        for ($y = 0; $y -lt $source.Height; $y += 1) {
            for ($x = 0; $x -lt $source.Width; $x += 1) {
                $pixel = $source.GetPixel($x, $y)
                $target.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($pixel.A, $red, $green, $blue))
            }
        }
        $target.Save((Join-Path $CssImageDirectory $TargetName), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $source.Dispose()
        $target.Dispose()
    }
}

New-RecoloredSprite -TargetName 'ui-icons_ffffff_256x240.png' -HexColor 'ffffff'
New-RecoloredSprite -TargetName 'ui-icons_777620_256x240.png' -HexColor '777620'
New-RecoloredSprite -TargetName 'ui-icons_cc0000_256x240.png' -HexColor 'cc0000'
Write-Output "Generated missing jQuery UI sprites in $CssImageDirectory"
