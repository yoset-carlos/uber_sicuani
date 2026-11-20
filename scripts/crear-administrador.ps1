$ErrorActionPreference = 'Stop'
$previousOutputEncoding = $OutputEncoding
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'Crear administrador de Uber Sicuani'
$account = @{}
foreach ($item in @(@('nombre','Nombre completo'),@('telefono','Celular peruano'),@('usuario','Usuario'))) {
    $value = Read-Host $item[1]
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Todos los campos son obligatorios.' }
    $account[$item[0]] = $value.Trim()
}
$secure = Read-Host 'Contraseña (mínimo 8 caracteres)' -AsSecureString
$confirm = Read-Host 'Confirma la contraseña' -AsSecureString
$ptr = [IntPtr]::Zero
$confirmPtr = [IntPtr]::Zero
try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $confirmPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
    $account.password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($account.password -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPtr)) { throw 'Las contraseñas no coinciden.' }
    $ErrorActionPreference = 'Continue'
    $result = $account | ConvertTo-Json -Compress | php scripts/create-admin.php 2>&1
    $resultCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    foreach ($line in $result) { Write-Host $line }
    if ($resultCode -ne 0) { exit 1 }
} finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($confirmPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPtr) }
    $account.Remove('password')
    $OutputEncoding = $previousOutputEncoding
}
