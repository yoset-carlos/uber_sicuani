param([int]$Port = 8081, [switch]$RedisOnly)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Selecciona un puerto entre 1024 y 65535.' }
if (-not (Test-Path -LiteralPath 'vendor/autoload.php')) { throw 'Ejecuta composer install antes de iniciar.' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
$windowsConfigPath = ($projectDirectory -replace '\\','/') + '/config/redis.local.conf'
$resolvedConfigPath = wsl -d Ubuntu -- wslpath -a $windowsConfigPath
if ($LASTEXITCODE -ne 0 -or -not $resolvedConfigPath) { throw 'No se encontró Ubuntu en WSL2 o no se pudo resolver la configuración.' }
$linuxConfigPath = ($resolvedConfigPath -join '').Trim()
$previousErrorActionPreference = $ErrorActionPreference
try {
    # Un Redis detenido escribe en stderr; la comprobación debe poder continuar.
    $ErrorActionPreference = 'Continue'
    $redisInfo = (wsl -d Ubuntu -- redis-cli -p 6380 INFO server 2>$null) -join "`n"
    $redisExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($redisExitCode -eq 0) {
    if (-not $redisInfo.Contains('config_file:' + $linuxConfigPath)) { throw 'El puerto 6380 ya pertenece a otra instancia. No se modificó.' }
} else {
    wsl -d Ubuntu -u root -- install -d -o redis -g redis /var/lib/redis-sicuani
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el directorio de Redis.' }
    wsl -d Ubuntu -u root -- runuser -u redis -- redis-server $linuxConfigPath
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar Redis en Ubuntu/WSL2.' }
}
if ($RedisOnly) { Write-Host 'Redis de Uber Sicuani listo en 127.0.0.1:6380'; exit 0 }
Write-Host "Uber Sicuani: http://127.0.0.1:$Port (Ctrl+C para detener PHP)"
php -S "127.0.0.1:$Port" -t public public/router.php
