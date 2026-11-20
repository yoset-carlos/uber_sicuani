# Alta manual de conductores. Ejecutar desde PowerShell; no es una página web.
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$accountScript = Join-Path $PSScriptRoot 'create-account.php'
$previousOutputEncoding = $OutputEncoding
$previousDirectory = Get-Location
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$passwordText = $null
$confirmationText = $null
$password = $null
$confirmation = $null
$account = $null
$payload = $null

try {
    if (-not (Get-Command php -ErrorAction SilentlyContinue)) { throw 'No se encontró PHP. Abre una terminal con PHP disponible.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'vendor/autoload.php'))) { throw 'Primero ejecuta composer install en la carpeta del proyecto.' }
    Set-Location -LiteralPath $projectDirectory
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)

    Write-Host 'Crear y aprobar conductor de Uber Sicuani'
    Write-Host 'La cuenta se guardará en Redis y usará el inicio de sesión habitual.'
    $fields = [ordered]@{
        nombre = 'Nombre completo'
        telefono = 'Celular peruano'
        usuario = 'Usuario (3 a 32 caracteres: letras sin tildes, números, punto o guion)'
        placa = 'Placa del vehículo'
        color = 'Color'
        marca = 'Marca'
        modelo = 'Modelo'
    }
    $account = [ordered]@{ rol = 'conductor' }
    foreach ($field in $fields.Keys) {
        $rawValue = Read-Host -Prompt $fields[$field]
        if ($null -eq $rawValue) { throw 'No se recibió entrada de teclado. Ejecuta composer conductor directamente en una terminal interactiva.' }
        $value = ([string]$rawValue).Trim()
        if ([string]::IsNullOrWhiteSpace($value)) { throw ('Completa el campo: ' + $fields[$field]) }
        $account[$field] = $value
    }

    $password = Read-Host 'Contraseña (8 a 72 caracteres ASCII; no se mostrará)' -AsSecureString
    $confirmation = Read-Host 'Repite la contraseña' -AsSecureString
    if ($null -eq $password -or $null -eq $confirmation) { throw 'No se recibió la contraseña. Ejecuta el asistente directamente en una terminal interactiva.' }
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
    $passwordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $confirmationText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
    $passwordBytes = [System.Text.Encoding]::UTF8.GetByteCount($passwordText)
    if ($passwordBytes -lt 8 -or $passwordBytes -gt 72) { throw 'La contraseña debe ocupar entre 8 y 72 bytes. No se creó la cuenta.' }
    if ($passwordText -cne $confirmationText) { throw 'Las contraseñas no coinciden. No se creó la cuenta.' }

    Write-Host ''
    Write-Host ('Conductor: ' + $account.nombre)
    Write-Host ('Usuario: ' + $account.usuario + ' | Celular: ' + $account.telefono)
    Write-Host ('Vehículo: ' + $account.marca + ' ' + $account.modelo + ' | ' + $account.color + ' | ' + $account.placa)
    $decision = Read-Host '¿Crear y aprobar esta cuenta? Escribe SI para continuar'
    if (([string]$decision).Trim().ToUpperInvariant() -ne 'SI') {
        Write-Host 'Operación cancelada. No se creó ninguna cuenta.'
        return
    }

    $account.password = $passwordText
    $payload = $account | ConvertTo-Json -Compress
    # La contraseña viaja por stdin; no se añade a argumentos ni se guarda en disco.
    $result = $payload | & php $accountScript
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el conductor. Corrige el dato indicado y vuelve a ejecutar el asistente.' }
    $saved = ($result -join "`n") | ConvertFrom-Json
    Write-Host ''
    Write-Host ('Conductor creado y aprobado. Usuario: ' + $saved.usuario)
    Write-Host ('Inicia sesión con ese usuario y contraseña; después activa Disponible. ID: ' + $saved.id)
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
    if ($null -ne $password) { $password.Dispose() }
    if ($null -ne $confirmation) { $confirmation.Dispose() }
    if ($null -ne $account) { $account.Remove('password') }
    $passwordText = $null
    $confirmationText = $null
    $payload = $null
    $OutputEncoding = $previousOutputEncoding
    Set-Location -LiteralPath $previousDirectory
}
