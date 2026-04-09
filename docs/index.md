# FB_SMARTPICK — Documentação do Projeto

> Gerado por BMAD document-project (scan exaustivo) em 2026-04-09.

---

## O que é

**SmartPick** é um SaaS B2B de calibragem de endereços de picking para Centros de Distribuição. Analisa exportações do WMS Winthor (Totvs), aplica um motor ABC parametrizável para sugerir capacidades ideais por slot, e permite aprovação rastreável do gestor com geração de PDF operacional.

Primeiro cliente: **Grupo JC** (9 CDs, 840 RCAs).

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Go 1.26, `net/http`, PostgreSQL 15 (schema `smartpick`) |
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| PDF | `github.com/johnfercher/maroto/v2` |
| Auth | JWT (herdado do FB_APU02) |
| Deploy | Docker multi-stage → GHCR → Coolify (VPS Hostinger) |
| CI/CD | GitHub Actions → deploy-production.yml |

---

## Documentação disponível

| Documento | Conteúdo |
|-----------|----------|
| [api-reference.md](api-reference.md) | Todos os endpoints REST do SmartPick |
| [data-model.md](data-model.md) | Schema do banco, tabelas e relacionamentos |
| [workflows.md](workflows.md) | Fluxos de negócio (upload → motor → aprovação → PDF) |
| [rbac-security.md](rbac-security.md) | Perfis, permissões e middleware |
| [frontend-pages.md](frontend-pages.md) | Páginas React, componentes e navegação |

### Documentos de planejamento (histórico)
- [planning/prd.md](planning/prd.md)
- [planning/architecture.md](planning/architecture.md)
- [planning/epics.md](planning/epics.md)

---

## Domínio e deploy

| Item | Valor |
|------|-------|
| Produção | `smartpick.fbtax.cloud` → `76.13.171.196` |
| Coolify | `http://76.13.171.196:8000` |
| Backend API | porta `8082` |
| Frontend | porta `80` (nginx) |
| DB schema | `smartpick` (no mesmo PostgreSQL do FB_APU02) |
| Repo | `github.com/ClaudioSBezerra/FB_SMARTPICK`, branch `main` |

---

## Estrutura de pastas

```
FB_SMARTPICK/
├── backend/
│   ├── main.go                    # Entry point, todas as rotas registradas
│   ├── handlers/
│   │   ├── auth.go                # JWT + BlackList (herdado — nunca modificar)
│   │   ├── middleware.go          # AuthMiddleware, GetEffectiveCompanyID
│   │   ├── smartpick_auth.go      # SmartPickAuthMiddleware + SmartPickContext
│   │   ├── sp_ambiente.go         # CRUD filiais, CDs, params motor, plano
│   │   ├── sp_csv.go              # Upload CSV, lista/status de jobs
│   │   ├── sp_motor.go            # Motor de calibragem (execução + fórmula)
│   │   ├── sp_propostas.go        # Dashboard, aprovação, edição inline, lote
│   │   ├── sp_pdf.go              # Geração PDF com maroto
│   │   ├── sp_historico.go        # Ciclos de calibragem + compliance
│   │   ├── sp_reincidencia.go     # Produtos não ajustados em múltiplos ciclos
│   │   ├── sp_usuarios.go         # CRUD usuários SmartPick + vínculos filiais
│   │   └── sp_admin.go            # Limpar calibragem, purgar CSV antigos
│   ├── services/
│   │   ├── csv_worker.go          # Worker: parser CSV, encoding, savepoints
│   │   └── email.go               # SMTP herdado
│   └── migrations/
│       ├── 100_sp_schema.sql      # Schema + sp_enderecos
│       ├── 101_sp_rbac.sql        # sp_role, sp_user_filiais
│       ├── 102_sp_filiais_cds.sql # sp_filiais, sp_centros_dist
│       ├── 103_sp_motor_params.sql# sp_motor_params
│       ├── 104_sp_subscription_limits.sql
│       ├── 105_sp_csv_jobs_audit.sql # sp_csv_jobs
│       ├── 106_sp_propostas.sql   # sp_propostas (com delta GENERATED)
│       ├── 107_sp_historico.sql   # sp_historico
│       └── 108_sp_retencao_hash.sql # file_hash em sp_csv_jobs
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # Roteamento principal
│   │   ├── pages/
│   │   │   ├── SpDashboard.tsx    # Dashboard de Urgência (falta/espaço/calibrado/curva_a)
│   │   │   ├── SpUploadCSV.tsx    # Upload e log de jobs
│   │   │   ├── SpAmbiente.tsx     # Filiais/CDs/Motor/Plano/Manutenção/Usuários
│   │   │   ├── SpGerarPDF.tsx     # Download PDF operacional
│   │   │   ├── SpHistorico.tsx    # Ciclos histórico + compliance
│   │   │   ├── SpReincidencia.tsx # Dashboard de reincidência
│   │   │   └── SpUsuarios.tsx     # CRUD usuários
│   │   └── components/
│   │       ├── AppRail.tsx        # Barra lateral de módulos (ícones)
│   │       └── CompanySwitcher.tsx# Troca de empresa ativa
└── docs/                          # Esta documentação
```

---

## Epics implementados

| Epic | Título | Status |
|------|--------|--------|
| 1 | Setup e Clone | Produção |
| 2 | Auth SmartPick | Produção |
| 3 | Gestão de Ambiente (Filiais/CDs/Motor/Plano) | Produção |
| 4 | Upload CSV + Worker | Produção |
| 5 | Dashboard de Urgência | Produção |
| 6 | Geração de PDF | Produção |
| 7 | Histórico e Compliance | Produção |
| 8 | Reincidência de Calibragem | Produção |

---

## Semântica central

```
delta = sugestao_calibragem − capacidade_atual

delta > 0  → FALTA:  slot pequeno demais → produto vai faltar antes do reabastecimento
delta < 0  → ESPAÇO: slot grande demais  → área de picking desperdiçada
delta = 0  → CALIBRADO (ou Curva A mantida)
```

**Fórmula do motor:**
```
sugestao = ⌈ ⌈giroDia ÷ unidade_master⌉ × dias_curva × fator_seguranca ⌉
```

Fontes de giro (ordem de prioridade): `MED_VENDA_DIAS` → `MED_VENDA_DIAS_CX × master` → `MED_VENDA_CX_AA × master`
Fontes de dias: `CLASSEVENDA_DIAS` do CSV → parâmetros A/B/C do motor (fallback)
