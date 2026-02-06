param()

function Read-PlainPassword {
  param([string]$Prompt = "Password")
  $secure = Read-Host -AsSecureString $Prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
  }
}

try {
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path
  $firebasercPath = Join-Path $root ".firebaserc"
  if (-not (Test-Path $firebasercPath)) {
    throw "No se encontró .firebaserc en la raíz del repo."
  }

  $firebaserc = Get-Content $firebasercPath -Raw | ConvertFrom-Json
  $projectId = $firebaserc.projects.default
  if (-not $projectId) {
    throw "No se encontró projects.default en .firebaserc."
  }

  $email = Read-Host "Email"
  $password = Read-PlainPassword "Password"
  $name = Read-Host "Nombre completo"

  $body = @{
    data = @{
      email = $email
      password = $password
      name = $name
    }
  } | ConvertTo-Json -Depth 4

  $url = "http://127.0.0.1:5001/$projectId/us-central1/bootstrapAdmin"
  Write-Host "ProjectId: $projectId"
  Write-Host "URL: $url"

  $response = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $body
  if ($response.data -and $response.data.uid) {
    Write-Host "Admin creado OK. UID: $($response.data.uid) Email: $($response.data.email)"
    exit 0
  }

  Write-Host "Respuesta inesperada: $($response | ConvertTo-Json -Depth 6)"
  exit 1
} catch {
  $message = $_.Exception.Message
  if ($message -match "connection refused" -or $message -match "No se puede establecer") {
    Write-Host "Error: No se pudo conectar al emulador de Functions en http://127.0.0.1:5001. ¿Está levantado?"
    exit 1
  }
  if ($message -match "EMAIL_EXISTS" -or $message -match "email already exists") {
    Write-Host "Error: El email ya existe en Auth Emulator."
    exit 1
  }
  Write-Host "Error: $message"
  exit 1
}
