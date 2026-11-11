# Aplica as migrações no projeto de TESTES (tutory-football-dev) e roda os testes de permissão.
# A senha do banco é pedida num prompt seguro: não aparece na tela, não fica salva em arquivo
# e só existe enquanto o script roda.
param([switch]$SoTestes)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8   # acentos da CLI aparecem certos
$cli = 'C:\Users\tutory teste\tools\supabase-cli\supabase.exe'
$app = Split-Path $PSScriptRoot -Parent
$ref = 'jokqpozlquglujppeugl'
$hostPooler = 'aws-1-ca-central-1.pooler.supabase.com'
$log = Join-Path $PSScriptRoot 'ultimo-resultado-dev.txt'

Write-Host ''
Write-Host '== Projeto de TESTES: tutory-football-dev ==' -ForegroundColor Cyan
$sec = Read-Host 'Digite a senha do banco do projeto de testes' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $plain) { Write-Host 'Senha vazia. Nada foi feito.' -ForegroundColor Yellow; exit 1 }
$url = "postgresql://postgres.$($ref):$([uri]::EscapeDataString($plain))@$($hostPooler):5432/postgres"
$plain = $null

Set-Location $app
"Resultado de $(Get-Date -Format 'dd/MM/yyyy HH:mm')" | Out-File $log -Encoding utf8

function Passo($titulo, [scriptblock]$acao) {
  Write-Host ''
  Write-Host "-- $titulo" -ForegroundColor Cyan
  "`n-- $titulo" | Out-File $log -Append -Encoding utf8
  # A CLI escreve o progresso no canal de erro; no PowerShell 5.1, com 'Stop', isso derruba o script.
  # Aqui as mensagens viram texto e só o código de saída decide se falhou.
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
  if (-not $SoTestes) {
    Passo 'Aplicando as migrações' { & $cli db push --db-url $url --include-all --yes }
  }
  Passo 'Marcando o banco como ambiente de testes' { & $cli db query --db-url $url -f 'supabase/tests/00_marcar_ambiente_dev.sql' }
  Passo 'Rodando os testes da Fase 1 (permissões)' { & $cli db query --db-url $url -f 'supabase/tests/fase1_permissoes.sql' }
  Passo 'Rodando os testes da Fase 2 (operação)' { & $cli db query --db-url $url -f 'supabase/tests/fase2_operacao.sql' }
  Passo 'Rodando os testes da Fase 3a (sorteio e telão)' { & $cli db query --db-url $url -f 'supabase/tests/fase3a_sorteio.sql' }
  Passo 'Resultado dos testes' { & $cli db query --db-url $url --output-format json "select n, ok, teste, detalhe from private.test_results order by n" }
  Write-Host ''
  Write-Host "Pronto. Resultado salvo em $log" -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
  $url = $null
}






