# Tutory Football League: app (Fase 1)

Evolução do protótipo (`../prototipo`, que continua funcionando na porta 8790). Plano em `../docs/PLANO-ETAPA-2.md`.

## Rodar

```
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8791
```

| Endereço | Banco |
|---|---|
| `http://localhost:8791/?mock=1` | simulado neste navegador, com pessoas de exemplo (barra amarela troca de pessoa; senha das contas de exemplo: `teste1234`) |
| `http://localhost:8791/?env=dev` | projeto Supabase de **testes** (preencher `js/config.js` › `dev`) |
| `http://localhost:8791/` | produção (`kfifjbkcdzkpagkdehkk`) |

## Estrutura

```
index.html            casca; carrega css/home.css (visual aprovado) e css/app.css (painéis)
js/config.js          nome do produto (um lugar só), ambientes, liga padrão
js/api.js             chamadas ao Supabase; toda autorização acontece no banco
js/mock.js            banco simulado com as MESMAS regras da migração
js/ui.js              rotas, avisos, diálogos, avatar com URL assinada
js/app.js             sessão, rotas e navegação por perfil
js/home3d.js          bola e taça 3D do Blender
js/screens/           login, perfil, foto, home, admin (super admin), org (painel da empresa)
supabase/migrations/  migrações versionadas (aplicar com a Supabase CLI)
supabase/tests/       testes de permissão (rodam só no projeto de testes)
```

## Rotas

| Rota | Quem | O quê |
|---|---|---|
| `#/` | todos | Home do jogador |
| `#/perfil` | todos | perfil único: nascimento, responsável (menores), foto, telão, ligas |
| `#/admin` · `/empresas` · `/auditoria` | super admin | indicadores reais, empresas, suspensão, sessões de suporte, auditoria |
| `#/o/<liga>` · `/membros` · `/equipe` · `/config` · `/historico` | membros (cada aba só com a permissão) | painel da empresa |

## Banco (Supabase CLI)

A CLI fica em `C:\Users\tutory teste\tools\supabase-cli\supabase.exe` (v2.121.0). Ela é usada para:
- ligar a CLI à conta;
- aplicar as migrações;
- rodar os testes de permissão.

Comandos e ordem estão no relatório da Fase 1.
