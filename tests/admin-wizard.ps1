$ErrorActionPreference = 'Stop'
$env:REDIS_PREFIX = 'sicuani-admin-wizard:' + [guid]::NewGuid().ToString('N') + ':'
$env:REDIS_DATABASE = '15'
$global:AdminAnswers = [System.Collections.Generic.Queue[string]]::new()
foreach ($value in @('Ana María','989777001','admin_prueba','Prueba-Conductor-123','Prueba-Conductor-123')) { $global:AdminAnswers.Enqueue($value) }
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $answer = $global:AdminAnswers.Dequeue()
    if ($AsSecureString) { return ConvertTo-SecureString $answer -AsPlainText -Force }
    return $answer
}
$output = (& "$PSScriptRoot/../scripts/crear-administrador.ps1" 6>&1 | Out-String)
if ($output -notmatch 'Administrador creado: admin_prueba' -or $output.Contains('Prueba-Conductor-123')) { throw 'Falló la creación segura del administrador.' }
Write-Host 'PASS: Asistente crea administrador sin mostrar la contraseña. Fixtures en DB 15.'
