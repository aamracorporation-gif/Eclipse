param(
  [ValidateSet('start','check','bootstrap-demo')]
  [string]$Action = 'start',
  [string]$CredentialPath = (Join-Path $PSScriptRoot '../../work/appfest-backend.secret')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CredentialPath)) {
  throw 'No se encuentra la credencial cifrada de este ordenador. No está incluida en el ZIP.'
}
$keys=@('DATABASE_URL','ALLOW_REMOTE_DATABASE','REMOTE_PROJECT_REF','AUTH_MODE','PAYMENT_MODE','PORT','HOST','APP_ORIGIN','DATABASE_LABEL','REMOTE_DEMO_BOOTSTRAP')
$previous=@{}
foreach($key in $keys) { $previous[$key]=[Environment]::GetEnvironmentVariable($key,'Process') }
$previousLocation=Get-Location
try {
  $encrypted=(Get-Content -LiteralPath $CredentialPath -Raw).Trim()
  $secure=ConvertTo-SecureString -String $encrypted
  $credential=[System.Management.Automation.PSCredential]::new('rondiqo_backend',$secure)
  $password=[Uri]::EscapeDataString($credential.GetNetworkCredential().Password)
  $env:DATABASE_URL="postgresql://rondiqo_backend.zurbdrfmwjqbrscairub:${password}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
  $env:ALLOW_REMOTE_DATABASE='approved-existing-project'
  $env:REMOTE_PROJECT_REF='zurbdrfmwjqbrscairub'
  $env:AUTH_MODE='local'
  $env:PAYMENT_MODE='simulated'
  $env:DATABASE_LABEL='AppFest'
  $env:PORT='4173'
  $env:HOST='127.0.0.1'
  $env:APP_ORIGIN='http://127.0.0.1:4173'
  Set-Location -LiteralPath $PSScriptRoot
  if ($Action -eq 'check') {
    & node --experimental-strip-types scripts/check-appfest.ts
  } elseif ($Action -eq 'bootstrap-demo') {
    $env:REMOTE_DEMO_BOOTSTRAP='approved-empty-rondiqo'
    & node --experimental-strip-types scripts/bootstrap-appfest-demo.ts
  } else {
    & node --experimental-strip-types server/index.ts
  }
  if ($LASTEXITCODE -ne 0) { throw "RONDIQO terminó con código $LASTEXITCODE." }
} finally {
  foreach($key in $keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
  Set-Location -LiteralPath $previousLocation
  $password=$null
  $credential=$null
}
