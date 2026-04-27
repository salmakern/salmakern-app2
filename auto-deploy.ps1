# Salmaker'n - Auto-deploy til GitHub/Netlify

$mappe = "C:\Users\GroAnitaMartinsen\OneDrive - Telemark Salmakerverksted\Skrivebord\Claude app"
$fil = "$mappe\salmakern.html"
$sjekkIntervall = 15

Write-Host "Salmaker'n auto-deploy startet!" -ForegroundColor Green
Write-Host "Fil: $fil" -ForegroundColor Cyan
Write-Host ""

# Sjekk at filen finnes
if (-not (Test-Path $fil)) {
    Write-Host "FEIL: Finner ikke filen!" -ForegroundColor Red
    Write-Host "Sjekk at stien er riktig." -ForegroundColor Red
    pause
    exit
}

$sistHash = (Get-FileHash $fil -Algorithm MD5).Hash
$sistStr  = (Get-Item $fil).LastWriteTime
Write-Host "Fil funnet! Storrelse: $((Get-Item $fil).Length) bytes" -ForegroundColor Green
Write-Host "Sist endret: $sistStr" -ForegroundColor Gray
Write-Host "Hash: $sistHash" -ForegroundColor Gray
Write-Host ""
Write-Host "Klar. Sjekker hvert $sjekkIntervall sekund..." -ForegroundColor Gray

$teller = 0
while ($true) {
    Start-Sleep -Seconds $sjekkIntervall
    $teller++
    Write-Host "Sjekk nr $teller..." -ForegroundColor DarkGray

    try {
        $nyHash = (Get-FileHash $fil -Algorithm MD5).Hash
        $nyStr  = (Get-Item $fil).LastWriteTime
    } catch {
        Write-Host "Feil ved lesing: $_" -ForegroundColor Red
        continue
    }

    Write-Host "  Hash: $nyHash" -ForegroundColor DarkGray
    Write-Host "  Tid:  $nyStr" -ForegroundColor DarkGray

    if ($nyHash -ne $sistHash) {
        $sistHash = $nyHash
        $naa = [DateTime]::Now

        Write-Host ""
        Write-Host "[$($naa.ToString('HH:mm:ss'))] Endring oppdaget! Laster opp..." -ForegroundColor Yellow

        Set-Location $mappe
        & git add -A
        & git commit -m "Automatisk oppdatering $($naa.ToString('dd.MM.yyyy HH:mm'))"
        & git push

        Write-Host "Nettsiden er oppdatert!" -ForegroundColor Green
        Write-Host ""
    }
}
