# Aplica as migrações na PRODUÇÃO (tutory-football-league, kfifjbkcdzkpagkdehkk).
# Só rodar depois de os testes passarem no projeto de testes e com a aprovação do Paulo.
# A senha do banco é pedida num prompt seguro: não aparece na tela nem fica salva.
param([Parameter(Mandatory = $true)][string]$HostPooler)   # ex.: aws-0-sa-east-1.pooler.supabase.com

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cli = 'C:\Users\tutory teste\tools\supabase-cli\supabase.exe'
$app = Split-Path $PSScriptRoot -Parent
$ref = 'kfifjbkcdzkpagkdehkk'
$log = Join-Path $PSScriptRoot 'ultimo-resultado-prod.txt'

Write-Host ''
Write-Host '== PRODUÇÃO: tutory-football-league ==' -ForegroundColor Yellow
$sec = Read-Host 'Digite a senha do banco de PRODUÇÃO' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $plain) { Write-Host 'Senha vazia. Nada foi feito.' -ForegroundColor Yellow; exit 1 }
$url = "postgresql://postgres.$($ref):$([uri]::EscapeDataString($plain))@$($HostPooler):5432/postgres"
$plain = $null

Set-Location $app
"Resultado de $(Get-Date -Format 'dd/MM/yyyy HH:mm')" | Out-File $log -Encoding utf8

function Passo($titulo, [scriptblock]$acao) {
  Write-Host ''
  Write-Host "-- $titulo" -ForegroundColor Cyan
  "`n-- $titulo" | Out-File $log -Append -Encoding utf8
  $antes = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $saida = & $acao 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } } |
    Where-Object { $_ -notmatch 'new version of Supabase CLI|recommend updating|updating-the-supabase-cli' }
  $codigo = $LASTEXITCODE
  $ErrorActionPreference = $antes
  $saida | ForEach-Object { Write-Host $_ }
  $saida | Out-File $log -Append -Encoding utf8
  if ($codigo -ne 0) { throw "Falhou: $titulo (código $codigo). Veja $log" }
}

try {
  # A fase 0 foi aplicada à mão no SQL Editor (10/11): registra no histórico sem rodar de novo.
  Passo 'Registrando a fase 0 como já aplicada' { & $cli migration repair --db-url $url --status applied 20261110120000 }
  Passo 'Aplicando as migrações novas' { & $cli db push --db-url $url --yes }
  Passo 'Conferindo o que ficou aplicado' { & $cli db query --db-url $url --output-format json "select (select count(*) from public.profiles) as perfis, (select count(*) from public.platform_admins) as super_admins, (select count(*) from public.permissions) as permissoes, (select count(*) from public.roles where org_id is null) as papeis_padrao, (select count(*) from public.org_members) as membros" }
  Write-Host ''
  Write-Host "Pronto. Resultado salvo em $log" -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  $url = $null
}

