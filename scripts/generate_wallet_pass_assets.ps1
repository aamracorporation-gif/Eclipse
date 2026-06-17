param(
  [string]$OutputDir = "assets\wallet-pass"
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

function New-Color([int]$A, [int]$R, [int]$G, [int]$B) {
  [System.Drawing.Color]::FromArgb($A, $R, $G, $B)
}

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return ,$path
}

function Draw-GlowCircle {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$CenterX,
    [int]$CenterY,
    [int]$Radius,
    [System.Drawing.Color]$Color,
    [int]$Steps = 6
  )

  for ($i = $Steps; $i -ge 1; $i--) {
    $scale = 1 + ($i * 0.28)
    $alpha = [Math]::Max(8, 24 - ($i * 3))
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, $Color.R, $Color.G, $Color.B))
    $size = [int]($Radius * 2 * $scale)
    $x = [int]($CenterX - ($size / 2))
    $y = [int]($CenterY - ($size / 2))
    $Graphics.FillEllipse($brush, $x, $y, $size, $size)
    $brush.Dispose()
  }
}

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-Strip {
  param(
    [string]$Path,
    [string]$Theme
  )

  $width = 1125
  $height = 294
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  switch ($Theme) {
    "music" {
      $label = "CONCERT"
      $bgA = New-Color 255 11 11 16
      $bgB = New-Color 255 20 11 31
      $accent = New-Color 255 255 179 107
      $accentSoft = New-Color 255 111 73 42
      $glow = New-Color 255 255 179 107
    }
    "sports" {
      $label = "SPORT"
      $bgA = New-Color 255 10 16 28
      $bgB = New-Color 255 8 10 16
      $accent = New-Color 255 125 211 255
      $accentSoft = New-Color 255 36 88 131
      $glow = New-Color 255 125 211 255
    }
    "corporate" {
      $label = "CONFERENCE"
      $bgA = New-Color 255 17 17 24
      $bgB = New-Color 255 10 10 16
      $accent = New-Color 255 182 187 198
      $accentSoft = New-Color 255 89 94 105
      $glow = New-Color 255 182 187 198
    }
    "art" {
      $label = "EXHIBITION"
      $bgA = New-Color 255 18 12 31
      $bgB = New-Color 255 10 10 16
      $accent = New-Color 255 199 178 255
      $accentSoft = New-Color 255 98 78 142
      $glow = New-Color 255 199 178 255
    }
    default {
      $label = "EVENT"
      $bgA = New-Color 255 11 11 16
      $bgB = New-Color 255 17 17 24
      $accent = New-Color 255 154 135 255
      $accentSoft = New-Color 255 77 60 124
      $glow = New-Color 255 154 135 255
    }
  }

  $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($width, $height)),
    $bgA,
    $bgB
  )
  $graphics.FillRectangle($background, 0, 0, $width, $height)
  $background.Dispose()

  $verticalOverlay = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $height)),
    (New-Color 0 255 255 255),
    (New-Color 120 0 0 0)
  )
  $graphics.FillRectangle($verticalOverlay, 0, 0, $width, $height)
  $verticalOverlay.Dispose()

  Draw-GlowCircle -Graphics $graphics -CenterX 770 -CenterY 88 -Radius 82 -Color $glow -Steps 7
  $spotBrush = New-Object System.Drawing.SolidBrush (New-Color 22 $accent.R $accent.G $accent.B)
  $graphics.FillEllipse($spotBrush, 500, 10, 420, 200)
  $spotBrush.Dispose()

  $pillPath = New-RoundedPath -X 38 -Y 32 -Width 222 -Height 56 -Radius 18
  $pillFill = New-Object System.Drawing.SolidBrush (New-Color 18 255 255 255)
  $pillStroke = New-Object System.Drawing.Pen ((New-Color 38 255 255 255), 1.5)
  $accentBar = New-Object System.Drawing.SolidBrush ($accent)
  $graphics.FillPath($pillFill, $pillPath)
  $graphics.DrawPath($pillStroke, $pillPath)
  $graphics.FillRectangle($accentBar, 52, 45, 4, 30)
  $pillFont = New-Object System.Drawing.Font("Segoe UI Semibold", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $pillBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $graphics.DrawString($label, $pillFont, $pillBrush, 70, 43)
  $pillBrush.Dispose()
  $pillFont.Dispose()
  $accentBar.Dispose()
  $pillStroke.Dispose()
  $pillFill.Dispose()
  $pillPath.Dispose()

  $mistBrush = New-Object System.Drawing.SolidBrush (New-Color 36 $accent.R $accent.G $accent.B)
  foreach ($ellipse in @(
    @(48, 196, 180, 72), @(138, 204, 210, 66), @(848, 192, 190, 72), @(940, 202, 150, 62)
  )) {
    $graphics.FillEllipse($mistBrush, $ellipse[0], $ellipse[1], $ellipse[2], $ellipse[3])
  }
  $mistBrush.Dispose()

  switch ($Theme) {
    "music" {
      $wavePenA = New-Object System.Drawing.Pen ((New-Color 28 $accent.R $accent.G $accent.B), 2)
      $wavePenB = New-Object System.Drawing.Pen ((New-Color 16 $accent.R $accent.G $accent.B), 1)
      for ($x = 0; $x -lt $width; $x += 42) {
        $graphics.DrawArc($wavePenA, $x - 20, 132, 70, 44, 0, 180)
        $graphics.DrawArc($wavePenB, $x - 10, 146, 60, 34, 180, 180)
      }
      $wavePenA.Dispose()
      $wavePenB.Dispose()
    }
    "sports" {
      $stadiumPen = New-Object System.Drawing.Pen ((New-Color 26 $accent.R $accent.G $accent.B), 2)
      $graphics.DrawArc($stadiumPen, 170, 106, 770, 220, 194, 152)
      $graphics.DrawArc($stadiumPen, 220, 124, 670, 180, 198, 144)
      $graphics.DrawArc($stadiumPen, 274, 140, 560, 148, 202, 136)
      $stadiumPen.Dispose()
    }
    "corporate" {
      $gridPen = New-Object System.Drawing.Pen ((New-Color 18 $accent.R $accent.G $accent.B), 1)
      for ($x = 318; $x -le 1010; $x += 54) {
        $graphics.DrawLine($gridPen, $x, 46, $x, 244)
      }
      for ($y = 58; $y -le 236; $y += 34) {
        $graphics.DrawLine($gridPen, 300, $y, 1040, $y)
      }
      $gridPen.Dispose()
    }
    "art" {
      $panelFill = New-Object System.Drawing.SolidBrush (New-Color 12 $accent.R $accent.G $accent.B)
      $panelStroke = New-Object System.Drawing.Pen ((New-Color 24 $accent.R $accent.G $accent.B), 1.5)
      $graphics.FillRectangle($panelFill, 628, 42, 240, 170)
      $graphics.DrawRectangle($panelStroke, 628, 42, 240, 170)
      $graphics.DrawRectangle($panelStroke, 590, 72, 240, 170)
      $panelFill.Dispose()
      $panelStroke.Dispose()
    }
    default {
      $linePen = New-Object System.Drawing.Pen ((New-Color 22 $accent.R $accent.G $accent.B), 1.5)
      $graphics.DrawArc($linePen, 280, 52, 520, 164, 182, 176)
      $graphics.DrawArc($linePen, 210, 78, 640, 182, 184, 170)
      $linePen.Dispose()
    }
  }

  $particleBrushA = New-Object System.Drawing.SolidBrush (New-Color 105 255 255 255)
  $particleBrushB = New-Object System.Drawing.SolidBrush (New-Color 44 $accent.R $accent.G $accent.B)
  for ($i = 0; $i -lt 68; $i++) {
    $size = Get-Random -Minimum 2 -Maximum 6
    $x = Get-Random -Minimum 18 -Maximum ($width - 18)
    $y = Get-Random -Minimum 14 -Maximum 214
    $brush = if ($i % 3 -eq 0) { $particleBrushB } else { $particleBrushA }
    $graphics.FillEllipse($brush, $x, $y, $size, $size)
  }
  $particleBrushA.Dispose()
  $particleBrushB.Dispose()

  $borderPath = New-RoundedPath -X 6 -Y 6 -Width ($width - 12) -Height ($height - 12) -Radius 28
  $borderPen = New-Object System.Drawing.Pen ((New-Color 58 255 255 255), 2)
  $graphics.DrawPath($borderPen, $borderPath)
  $borderPen.Dispose()
  $borderPath.Dispose()

  Save-Png -Bitmap $bitmap -Path $Path
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-Logo {
  param([string]$Path)

  $width = 480
  $height = 150
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)

  Draw-GlowCircle -Graphics $graphics -CenterX 60 -CenterY 75 -Radius 26 -Color (New-Color 255 83 176 255)
  Draw-GlowCircle -Graphics $graphics -CenterX 60 -CenterY 75 -Radius 18 -Color (New-Color 255 185 98 255)
  $coreBrush = New-Object System.Drawing.SolidBrush (New-Color 255 4 7 16)
  $graphics.FillEllipse($coreBrush, 42, 57, 36, 36)
  $coreBrush.Dispose()
  $ringPen = New-Object System.Drawing.Pen ((New-Color 235 255 255 255), 2.6)
  $graphics.DrawEllipse($ringPen, 38, 53, 44, 44)
  $ringPen.Dispose()

  $font = New-Object System.Drawing.Font("Segoe UI Semibold", 38, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $graphics.DrawString("E C L I P S E", $font, $brush, 106, 43)
  $font.Dispose()
  $brush.Dispose()

  Save-Png -Bitmap $bitmap -Path $Path
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-Icon {
  param([string]$Path)

  $size = 180
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    (New-Color 255 5 9 22),
    (New-Color 255 22 14 48)
  )
  $graphics.FillEllipse($bg, 10, 10, 160, 160)
  $bg.Dispose()

  Draw-GlowCircle -Graphics $graphics -CenterX 90 -CenterY 90 -Radius 36 -Color (New-Color 255 84 176 255)
  Draw-GlowCircle -Graphics $graphics -CenterX 90 -CenterY 90 -Radius 24 -Color (New-Color 255 192 98 255)
  $coreBrush = New-Object System.Drawing.SolidBrush (New-Color 255 4 6 12)
  $graphics.FillEllipse($coreBrush, 66, 66, 48, 48)
  $coreBrush.Dispose()
  $ringPen = New-Object System.Drawing.Pen ((New-Color 240 255 255 255), 4)
  $graphics.DrawEllipse($ringPen, 60, 60, 60, 60)
  $ringPen.Dispose()

  $outline = New-Object System.Drawing.Pen ((New-Color 58 255 255 255), 2)
  $graphics.DrawEllipse($outline, 10, 10, 160, 160)
  $outline.Dispose()

  Save-Png -Bitmap $bitmap -Path $Path
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-Footer {
  param([string]$Path)

  $width = 858
  $height = 45
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $lineBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($width, 0)),
    (New-Color 0 72 180 255),
    (New-Color 0 192 98 255)
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = @(
    (New-Color 0 72 180 255),
    (New-Color 215 72 180 255),
    (New-Color 225 196 96 255),
    (New-Color 0 196 96 255)
  )
  $blend.Positions = @(0.0, 0.22, 0.78, 1.0)
  $lineBrush.InterpolationColors = $blend
  $graphics.FillRectangle($lineBrush, 38, 20, $width - 76, 4)
  $lineBrush.Dispose()

  Draw-GlowCircle -Graphics $graphics -CenterX ($width - 32) -CenterY 22 -Radius 8 -Color (New-Color 255 184 96 255) -Steps 4
  $coreBrush = New-Object System.Drawing.SolidBrush (New-Color 255 5 8 18)
  $graphics.FillEllipse($coreBrush, $width - 38, 16, 12, 12)
  $coreBrush.Dispose()
  $ringPen = New-Object System.Drawing.Pen ((New-Color 230 255 255 255), 1.2)
  $graphics.DrawEllipse($ringPen, $width - 40, 14, 16, 16)
  $ringPen.Dispose()

  Save-Png -Bitmap $bitmap -Path $Path
  $graphics.Dispose()
  $bitmap.Dispose()
}

$fullOutDir = Join-Path (Get-Location) $OutputDir
New-Item -ItemType Directory -Force -Path $fullOutDir | Out-Null

New-Strip -Path (Join-Path $fullOutDir "strip_music.png") -Theme "music"
New-Strip -Path (Join-Path $fullOutDir "strip_sports.png") -Theme "sports"
New-Strip -Path (Join-Path $fullOutDir "strip_corporate.png") -Theme "corporate"
New-Strip -Path (Join-Path $fullOutDir "strip_art.png") -Theme "art"
New-Strip -Path (Join-Path $fullOutDir "strip_default.png") -Theme "default"
New-Logo -Path (Join-Path $fullOutDir "logo.png")
New-Icon -Path (Join-Path $fullOutDir "icon.png")
New-Footer -Path (Join-Path $fullOutDir "footer.png")

Write-Host "Wallet assets generated in $fullOutDir"
