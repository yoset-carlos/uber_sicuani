$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$wizard = Join-Path $projectDirectory 'scripts/crear-conductor.ps1'
$previousPrefix = $env:REDIS_PREFIX
$previousDatabase = $env:REDIS_DATABASE
$env:REDIS_PREFIX = 'sicuani-driver-tests:' + [guid]::NewGuid().ToString('N') + ':'
$env:REDIS_DATABASE = '15'
$checks = 0
function Test-Condition([bool]$condition, [string]$message) {
    if (-not $condition) { throw ('FAIL: ' + $message) }
    $script:checks++
    Write-Host ('PASS: ' + $message)
}
function Set-Answers([string]$decision, [string]$repeat = 'Prueba-Conductor-123') {
    $global:SicuaniDriverTestAnswers = [System.Collections.Generic.Queue[string]]::new()
    foreach ($value in @('Ana María','989777001','conductor_prueba','ABC-123','Blanco','Toyota','Yaris','Prueba-Conductor-123',$repeat,$decision)) { $global:SicuaniDriverTestAnswers.Enqueue($value) }
}
# The real wizard is exercised with scripted answers; no interactive input is required.
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($global:SicuaniDriverTestNullInput) { return $null }
    $answer = $global:SicuaniDriverTestAnswers.Dequeue()
    if ($AsSecureString) { return ConvertTo-SecureString $answer -AsPlainText -Force }
    return $answer
}
try {
    Set-Location -LiteralPath $projectDirectory
    Set-Answers 'SI'
    $output = (& $wizard 6>&1 | Out-String)
    Test-Condition (-not $output.Contains('Prueba-Conductor-123')) 'La contraseña no se imprime'
    $info = ((& php tests/inspect-driver.php conductor_prueba) -join "`n") | ConvertFrom-Json
    Test-Condition ($info.rol -eq 'conductor' -and $info.aprobado -eq '1') 'Alta manual crea un conductor aprobado'
    Test-Condition ($info.nombre -ceq 'Ana María') 'El alta conserva caracteres UTF-8'
    Test-Condition ($info.password_ok -and $info.disponible -eq '0') 'Contraseña con hash y disponibilidad inicial desactivada'

    Set-Answers 'NO'
    $null = & $wizard 6>&1
    $info = ((& php tests/inspect-driver.php conductor_prueba) -join "`n") | ConvertFrom-Json
    Test-Condition ($info.contador -eq 1) 'Cancelar antes de aprobar no crea otra cuenta'

    Set-Answers 'SI' 'Otra-Contrasena-123'
    $failed = $false
    try { $null = & $wizard 6>&1 } catch { $failed = $_.Exception.Message -like '*no coinciden*' }
    Test-Condition $failed 'Contraseñas distintas impiden el alta'
    $info = ((& php tests/inspect-driver.php conductor_prueba) -join "`n") | ConvertFrom-Json
    Test-Condition ($info.contador -eq 1) 'Un error de confirmación conserva las cuentas existentes'
    $global:SicuaniDriverTestAnswers.Clear()
    $global:SicuaniDriverTestNullInput = $true
    $failed = $false
    try { $null = & $wizard 6>&1 } catch { $failed = $_.Exception.Message -like '*No se recibió entrada*' }
    Test-Condition $failed 'Entrada cerrada muestra un mensaje claro sin llamar Trim sobre NULL'
    Write-Host "$checks verificaciones del asistente aprobadas. Fixtures conservados en DB 15."
} finally {
    $env:REDIS_PREFIX = $previousPrefix
    $env:REDIS_DATABASE = $previousDatabase
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    Remove-Variable SicuaniDriverTestAnswers -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable SicuaniDriverTestNullInput -Scope Global -ErrorAction SilentlyContinue
}
