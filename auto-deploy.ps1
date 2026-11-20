# Salmaker'n - Auto-deploy med FileSystemWatcher

$mappe = "C:\Users\GroAnitaMartinsen\OneDrive - Telemark Salmakerverksted\Skrivebord\Claude app"

Write-Host "Salmaker'n auto-deploy startet!" -ForegroundColor Green
Write-Host "Mappe: $mappe" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $mappe)) {
    Write-Host "FEIL: Finner ikke mappen!" -ForegroundColor Red
    Read-Host "Trykk Enter for aa lukke"
    exit
}

try {
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $mappe
    $watcher.Filter = "salmakern.html"
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
    $watcher.EnableRaisingEvents = $true

    Write-Host "Venter paa endringer i salmakern.html..." -ForegroundColor Gray
    Write-Host "(Trykk Ctrl+C for aa stoppe)" -ForegroundColor DarkGray
    Write-Host ""

    $sisteDeploy = [DateTime]::MinValue

    while ($true) {
        $endring = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed, 1000)

        if (-not $endring.TimedOut) {
            Start-Sleep -Milliseconds 800

            $naa = [DateTime]::Now

            if (($naa - $sisteDeploy).TotalSeconds -lt 5) { continue }
            $sisteDeploy = $naa

            Write-Host "[$($naa.ToString('HH:mm:ss'))] Endring oppdaget! Deployer..." -ForegroundColor Yellow

            Set-Location $mappe
            & git add salmakern.html
            & git commit -m "Oppdatering $($naa.ToString('dd.MM.yyyy HH:mm'))"
            & git push

            if ($LASTEXITCODE -eq 0) {
                Write-Host "[$($naa.ToString('HH:mm:ss'))] Nettsiden er oppdatert!" -ForegroundColor Green
            } else {
                Write-Host "FEIL under push - sjekk internett/git" -ForegroundColor Red
            }
            Write-Host ""
        }
    }
} catch {
    Write-Host ""
    Write-Host "FEIL: $_" -ForegroundColor Red
    Read-Host "Trykk Enter for aa lukke"
}
