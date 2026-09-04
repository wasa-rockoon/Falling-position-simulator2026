param(
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [Parameter(Mandatory = $true)][int]$Size,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    try {
        $canvas = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
        $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            $canvas,
            [System.Drawing.Color]::FromArgb(255, 8, 55, 102),
            [System.Drawing.Color]::FromArgb(255, 0, 163, 166),
            55
        )
        $graphics.FillRectangle($background, $canvas)
        $background.Dispose()

        $scale = $Size / 512.0
        function Point([double]$x, [double]$y) {
            return [System.Drawing.PointF]::new([float]($x * $scale), [float]($y * $scale))
        }

        $wavePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(125, 230, 252, 255), [float](10 * $scale))
        $wavePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $wavePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        foreach ($offset in 0, 52, 104) {
            $points = @(
                (Point -48 (370 + $offset)),
                (Point 72 (336 + $offset)),
                (Point 192 (370 + $offset)),
                (Point 312 (336 + $offset)),
                (Point 432 (370 + $offset)),
                (Point 560 (336 + $offset))
            )
            $graphics.DrawCurve($wavePen, $points, 0.55)
        }
        $wavePen.Dispose()

        $pathPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(215, 255, 255, 255), [float](7 * $scale))
        $pathPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
        $pathPen.DashCap = [System.Drawing.Drawing2D.DashCap]::Round
        $graphics.DrawBezier($pathPen, (Point 263 278), (Point 310 300), (Point 333 330), (Point 356 366))
        $pathPen.Dispose()

        $balloonPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $balloonPath.AddBezier((Point 256 78), (Point 170 78), (Point 142 166), (Point 194 241))
        $balloonPath.AddBezier((Point 194 241), (Point 218 273), (Point 235 285), (Point 256 298))
        $balloonPath.AddBezier((Point 256 298), (Point 277 285), (Point 294 273), (Point 318 241))
        $balloonPath.AddBezier((Point 318 241), (Point 370 166), (Point 342 78), (Point 256 78))
        $balloonPath.CloseFigure()
        $balloonFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(248, 255, 255, 255))
        $balloonOutline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 223, 242, 250), [float](7 * $scale))
        $graphics.FillPath($balloonFill, $balloonPath)
        $graphics.DrawPath($balloonOutline, $balloonPath)
        $balloonFill.Dispose()
        $balloonOutline.Dispose()
        $balloonPath.Dispose()

        $highlight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(90, 38, 151, 190))
        $graphics.FillEllipse($highlight, [float](198 * $scale), [float](112 * $scale), [float](36 * $scale), [float](118 * $scale))
        $highlight.Dispose()

        $ropePen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [float](5 * $scale))
        $graphics.DrawLine($ropePen, (Point 239 286), (Point 235 318))
        $graphics.DrawLine($ropePen, (Point 273 286), (Point 277 318))
        $ropePen.Dispose()

        $basketBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 179, 71))
        $graphics.FillRectangle($basketBrush, [float](231 * $scale), [float](316 * $scale), [float](50 * $scale), [float](34 * $scale))
        $basketBrush.Dispose()

        $targetCenterX = 369 * $scale
        $targetCenterY = 376 * $scale
        $outer = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 124, 67))
        $middle = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        $inner = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 124, 67))
        $graphics.FillEllipse($outer, [float]($targetCenterX - 58 * $scale), [float]($targetCenterY - 58 * $scale), [float](116 * $scale), [float](116 * $scale))
        $graphics.FillEllipse($middle, [float]($targetCenterX - 38 * $scale), [float]($targetCenterY - 38 * $scale), [float](76 * $scale), [float](76 * $scale))
        $graphics.FillEllipse($inner, [float]($targetCenterX - 18 * $scale), [float]($targetCenterY - 18 * $scale), [float](36 * $scale), [float](36 * $scale))
        $outer.Dispose()
        $middle.Dispose()
        $inner.Dispose()

        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-AppIcon -Size 192 -Path (Join-Path $OutputDirectory 'app-icon-192.png')
New-AppIcon -Size 512 -Path (Join-Path $OutputDirectory 'app-icon-512.png')
Write-Output "Generated PWA icons in $OutputDirectory"
