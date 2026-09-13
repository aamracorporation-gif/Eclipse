# Run this script as Administrator to fix ThemedInput.tsx
$path = "C:\Users\Achraf\Desktop\AplicacionMovil\components\ui\ThemedInput.tsx"

# Grant Achraf full control on the ui directory
icacls "C:\Users\Achraf\Desktop\AplicacionMovil\components\ui" /grant "Achraf:(OI)(CI)F" /T

# Now fix the file
$c = Get-Content $path -Raw -Encoding UTF8
$c = $c -replace "fontSize: theme\.typography\.size\.lg,", "fontSize: 15,"
$c = $c -replace "    fontWeight: '700',", "    fontWeight: '400',"
[System.IO.File]::WriteAllText($path, $c, [System.Text.Encoding]::UTF8)
Write-Host "Done! ThemedInput.tsx fixed." -ForegroundColor Green
