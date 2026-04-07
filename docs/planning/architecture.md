---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-06'
inputDocuments:
  - planning-artifacts/prd.md
  - planning-artifacts/product-brief-FB_SMARTPICK-2026-04-06.md
  - FB_APU02/docs/ARCHITECTURE.md
  - FB_APU02/docs/TECHNICAL_SPECS.md
  - FB_APU02/docs/diagrama_banco_importacao.md
  - FB_APU02/backend/main.go
  - FB_APU02/backend/go.mod
  - FB_APU02/backend/handlers/auth.go
  - FB_APU02/backend/handlers/middleware.go
  - FB_APU02/backend/handlers/hierarchy.go
  - FB_APU02/backend/handlers/environment.go
  - FB_APU02/backend/migrations/013_create_environment_hierarchy.sql
  - FB_APU02/backend/migrations/015_create_auth_system.sql
  - FB_APU02/backend/migrations/018_add_role_to_users.sql
  - FB_APU02/backend/services/email.go
  - FB_APU02/frontend/package.json
  - FB_APU02/frontend/src/App.tsx
  - FB_APU02/frontend/src/contexts/AuthContext.tsx
  - FB_APU02/docker-compose.yml
workflowType: 'architecture'
project_name: 'FB_SMARTPICK'
user_name: 'Claudio'
date: '2026-04-06'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements — 38 FRs em 8 áreas de capacidade:**

| Área | FRs | Implicação arquitetural |
|---|---|---|
| Importação e Processamento de Dados | FR1–FR5 | Parser CSV Go (herdado), validação de campos/encoding, log persistido |
| Motor de Calibragem | FR6–FR12 | Lógica de negócio exclusiva no backend; parâmetros persistidos no banco por CD |
| Dashboard de Urgência | FR13–FR17 | API de leitura com ordenação/filtro server-side; edição de propostas |
| Geração de PDF Operacional | FR18–FR21 | PDF gerado server-side (Go); campos específicos, ordenação, A4 |
| Histórico e Compliance | FR22–FR25 | Tabela de histórico com integridade referencial (até 4 por endereço) |
| Administração de Ambiente | FR26–FR30 | CRUD de hierarquia (tenant→empresa→filial→CD) + controle de plano/limite |
| Gestão de Usuários e Acesso | FR31–FR35 | RBAC com 4 perfis + escopo de filial por usuário (extensão do modelo do clone) |
| Comunicação e Notificações | FR36–FR38 | SMTP herdado do FB_APU02 sem modificação |

**Non-Functional Requirements — 17 NFRs com impacto arquitetural direto:**

| NFR | Alvo | Decisão arquitetural implicada |
|---|---|---|
| CSV 5.000 endereços | < 30s | Processamento síncrono aceitável (Go é rápido; worker async não necessário no MVP) |
| Motor de calibragem | < 10s | Execução síncrona no handler; resultado imediato para o gestor |
| PDF | < 5s | Geração server-side; biblioteca Go nativa |
| Dashboard | < 3s | Queries otimizadas com índices; sem materialized views necessárias no MVP |
| Isolamento de tenant | Schema por tenant | Schema `smartpick` isolado do `farol` no mesmo PostgreSQL |
| Novos tenants sem deploy | Operação administrativa | Parâmetros e limites de plano em tabelas de configuração — zero hardcode |
| 50 usuários simultâneos | Por tenant | Pool de conexões do Go (MaxOpenConns=50) é suficiente |
| 99% uptime (7h–22h úteis) | Zero-downtime deploy | Deploy via Coolify — health check no Docker Compose (herdado) |
| Audit log | Operações de escrita | Tabela `audit_log` no schema SmartPick |

**Scale & Complexity:**

- Domínio primário: Full-stack SaaS B2B — backend-heavy (motor de calibragem + PDF)
- Complexidade: Média-Alta
- Clone reduz escopo real em ~40% — auth, email, deploy, design system, tenant base
- Componentes arquiteturais estimados: 9 novos handlers backend + 7 novas páginas frontend

---

### Decisão Arquitetural Fundamental — Clone Strategy

**O FB_SMARTPICK parte do clone do repositório FB_APU02.**

**Componentes herdados SEM modificação:**

| Componente | Arquivos no FB_APU02 | Status no SmartPick |
|---|---|---|
| JWT auth + refresh token (sync.Map) + blacklist | `handlers/auth.go` | Herdado direto |
| SecurityMiddleware (CORS, headers, rate limiter) | `handlers/middleware.go` | Herdado direto |
| Sistema de migrations (.sql numerados) | `backend/migrations/` | Herdado direto |
| Email service (SMTP Hostinger, HTML templates) | `services/email.go` | Herdado direto |
| Docker Compose + Nginx + Coolify/Traefik | `docker-compose.yml`, `frontend/Dockerfile` | Herdado direto |
| AuthContext + fetch interceptor + localStorage | `frontend/src/contexts/AuthContext.tsx` | Herdado direto |
| Design system (Tailwind + Shadcn/Radix + Lucide) | `frontend/package.json`, `src/components/ui/` | Herdado direto |
| TanStack Query + React Router 6 + Vite setup | `frontend/src/App.tsx` | Herdado direto |
| Migration runner no startup (`onDBConnected`) | `backend/main.go` | Herdado direto |

**Componentes que precisam de EXTENSÃO (modificação do clone):**

| Componente | Mudança necessária | Razão |
|---|---|---|
| Tabela `users` | Adicionar coluna `role_smartpick` (admin_fbtax/gestor_geral/gestor_filial/somente_leitura) | RBAC do APU02 é binário; SmartPick precisa de 4 perfis |
| Nova tabela `user_filiais` | `user_id × empresa_id × filial_id (nullable) × all_filiais bool` — filial fica **abaixo** de `empresa_id` | Scoping de acesso por filial com granularidade por empresa |
| `AuthMiddleware` | Estender para validar perfil SmartPick + filiais vinculadas | Middleware atual só valida role 'admin'\|'user' |
| Hierarquia de ambiente | Adicionar tabelas `filiais` e `centros_distribuicao` abaixo de `companies` | O APU02 não tem filiais como entidade — branches são derivadas dos SPED |
| `main.go` (routes) | Substituir rotas de domínio APU02 pelas rotas SmartPick | Manter apenas rotas de auth e admin base |
| Frontend `App.tsx` (rotas) | Substituir páginas de domínio por páginas SmartPick | Manter Login, Register, ForgotPassword, ResetPassword |

**Estrutura da tabela `user_filiais`:**

```sql
CREATE TABLE user_filiais (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    empresa_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    filial_id   UUID          REFERENCES filiais(id) ON DELETE CASCADE,
    -- NULL quando all_filiais = true (acesso a todas as filiais da empresa)
    all_filiais BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, empresa_id,
        COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid))
);
```

Regras:
- `all_filiais = true, filial_id = NULL` → acesso a todas as filiais da empresa
- `all_filiais = false, filial_id = <uuid>` → acesso somente a esta filial
- O popup no cadastro itera por empresa e permite seleção de 1, N ou todas as filiais

**Componentes NOVOS (greenfield — específicos do SmartPick):**

Backend (`handlers/`):
- `csv_upload.go` — upload, validação de campos/encoding, log de processamento
- `calibration.go` — motor de calibragem (regras ABC, fórmulas, parâmetros)
- `proposals.go` — CRUD de propostas, aprovação/edição individual e em lote
- `dashboard.go` — urgency dashboard com agregações e ordenação por % ofensa
- `pdf.go` — geração de PDF operacional server-side
- `history.go` — histórico de compliance e rastreamento de não-execuções
- `motor_params.go` — CRUD de parâmetros do motor por CD
- `filiais_smartpick.go` — CRUD de filiais e CDs (entidades SmartPick)
- `admin_smartpick.go` — administração de planos, limites e duplicação de CD

Frontend (`pages/`):
- `UploadCSV.tsx` — upload com log de processamento
- `DashboardUrgencia.tsx` — dashboard por rua com propostas editáveis
- `HistoricoCompliance.tsx` — histórico de propostas por endereço
- `GeradorPDF.tsx` — seleção e geração do PDF operacional
- `ConfiguracaoMotor.tsx` — parâmetros do motor por CD (admin)
- `GestaoFiliais.tsx` — CRUD de filiais e CDs (admin)
- `AdminSmartPick.tsx` — gestão de planos e tenants

---

### Technical Constraints & Dependencies

**Banco de dados compartilhado com FB_FAROL:**
SmartPick e Farol compartilham a mesma instância PostgreSQL com schemas isolados:
- Schema `public` → tabelas herdadas do clone (users, environments, companies, etc.)
- Schema `smartpick` → todas as tabelas específicas do SmartPick
- Schema `farol` → todas as tabelas específicas do Farol
- Migrations de SmartPick e Farol prefixadas para evitar conflito de numeração

**Sem escrita no ERP:**
O sistema nunca conecta ao Winthor ou SAP em runtime. Dados entram apenas via
CSV manual (MVP). Sem dependência de ERP.

**Processamento síncrono no MVP:**
CSVs de até 5.000 endereços processados em < 30s pelo Go — worker assíncrono
não é necessário. Sem job queue, sem Redis para filas no MVP.

**Redis no docker-compose:**
Herdado do clone; mantido no compose para compatibilidade mas sem integração
ativa no SmartPick MVP.

---

### Cross-Cutting Concerns

| Concern | Impacto | Abordagem |
|---|---|---|
| Isolamento multi-tenant | Todos os módulos | Schema `smartpick` com `tenant_id` em todas as tabelas de dados |
| RBAC com escopo de filial | Dashboard, Upload, Propostas, PDF, Histórico | Middleware valida perfil + filiais via `user_filiais` antes de cada operação |
| Parâmetros do motor configuráveis | Motor de calibragem | Tabela `motor_params` lida a cada execução — sem hardcode de thresholds |
| Integridade do histórico | Propostas, Compliance | Máx. 4 ocorrências por endereço com controle via INSERT condicional |
| Audit log | Admin, Propostas, Parâmetros | Tabela `audit_log` com user_id, ação, entidade, timestamp |
| Coordenação de migrations com Farol | Banco de dados | Prefixo `sp_` nas migrations SmartPick vs `fa_` nas migrations Farol |

---

## Starter Template Evaluation

### Primary Technology Domain

Full-stack SaaS B2B — Go backend + React frontend, baseado no clone
do repositório FB_APU02 (apuracao.fbtax.cloud), produção-estável.

### Starter Selecionado: Clone do FB_APU02

**Rationale:** O FB_APU02 é um sistema em produção com stack validada,
que provê exatamente a infraestrutura necessária para o SmartPick.
Usar um starter público introduziria divergências desnecessárias em
relação ao ecossistema fbtax.cloud e requereria retrabalho de auth,
tenant, email e deploy — já resolvidos e testados no APU02.

**Inicialização:**

```bash
# 1. Clonar repositório base
git clone <fb_apu02_repo> FB_SMARTPICK

# 2. Remover histórico Git e iniciar repositório independente
cd FB_SMARTPICK && rm -rf .git && git init

# 3. Remover módulos de domínio do APU02 (fiscal, RFB, ERP bridge específico)
#    Manter: auth, middleware, email, hierarchy, environment, migrations base

# 4. Renomear módulo Go
# backend/go.mod: module fb_apu02 → module fb_smartpick

# 5. Atualizar docker-compose.yml
#    DATABASE_URL: fb_apu → fb_smartpick
#    APP_URL: apuracao.fbtax.cloud → smartpick.fbtax.cloud
#    Traefik labels: apuracao → smartpick

# 6. Atualizar ALLOWED_ORIGINS e CORS
#    Adicionar: https://smartpick.fbtax.cloud
```

### Decisões Arquiteturais Providas pelo Clone

**Linguagem & Runtime (Backend):**
- Go 1.22 — `net/http` standard library (sem framework externo)
- Dependências: `golang-jwt/jwt/v5`, `lib/pq`, `bcrypt`, `godotenv`
- Versões exatas do `go.mod` do FB_APU02 mantidas

**Linguagem & Runtime (Frontend):**
- React 18.3.1 + TypeScript 5.2.2 + Vite 5.2.0
- TanStack Query 5.x (cache e sincronização server-side)
- React Router DOM 6.22.3
- Versões exatas do `package.json` do FB_APU02 mantidas

**Estilo & Design System:**
- Tailwind CSS 3.4.3
- Shadcn/UI (componentes Radix UI)
- Lucide React (ícones)
- Recharts (gráficos — reutilizável no dashboard SmartPick)

**Banco de Dados:**
- PostgreSQL 15-alpine (imagem Docker)
- Sistema de migrations: arquivos `.sql` numerados sequencialmente;
  executados automaticamente no startup via `onDBConnected()` em `main.go`
- Sem ORM — `database/sql` + `lib/pq` com SQL nativo

**Autenticação (herdada completa):**
- JWT HS256 — expiração configurável via env
- Refresh token in-memory (sync.Map) com rotação
- Blacklist de tokens revogados (sync.Map com cleanup periódico)
- Bcrypt custo 14
- Rate limiters: 5 logins/15min, 10 registros/h, 3 forgot-pw/h por IP

**Segurança (herdada completa):**
- `SecurityMiddleware`: CORS estrito por origem, TLS headers
  (HSTS, X-Frame-Options, CSP, X-Content-Type-Options)
- Prepared statements em todas as queries (sem SQL concatenado)
- `X-Company-ID` header para scoping de empresa

**Deploy & Infraestrutura (herdado completo):**
- Docker Compose: api (Go:8081), web (Nginx+React:80), db (Postgres:5432), redis
- Coolify + Traefik: TLS automático via Let's Encrypt, routing por hostname
- Zero-downtime: health check no `db` service antes de iniciar `api`

**Frontend Auth (herdado completo):**
- `AuthContext` com fetch interceptor global: injeta `Authorization` e
  `X-Company-ID` em todos os requests automaticamente
- Sessão persistida em `localStorage`
- `ProtectedRoute` e `AdminRoute` para proteção de rotas

**Email (herdado completo):**
- SMTP via Hostinger (smtp.hostinger.com:465, TLS)
- `services/email.go` com templates HTML
- Fluxos: ativação de conta, recuperação de senha, reset de senha

---

## Core Architectural Decisions

### Decision Priority Analysis

**Decisões Críticas (bloqueiam implementação):**
- Banco de dados separado por produto (reverte premissa do PRD)
- Biblioteca de PDF: `github.com/johnfercher/maroto`
- Motor de calibragem assíncrono: worker + job table
- RBAC: coluna `role_smartpick` em `users`

**Decisões Importantes (moldam arquitetura):**
- `SmartPickContext` no frontend (novo, independente do AuthContext)
- URLs diretas `/api/` sem prefixo de produto

**Decisões Adiadas (Pós-MVP):**
- Integração com FB_FAROL via API (V2 — se necessário)
- erp_bridge para SmartPick (V2)
- Agente Text-to-SQL (V2)

---

### Data Architecture

**Banco de Dados: Separado por produto (Decisão 1-B)**

Cada produto fbtax.cloud tem sua própria instância PostgreSQL isolada:

| Produto | Banco | Deploy |
|---|---|---|
| FB_SMARTPICK | `fb_smartpick` | smartpick.fbtax.cloud |
| FB_FAROL | `fb_farol` | farol.fbtax.cloud |
| FB_APU02 | `fb_apu` | apuracao.fbtax.cloud |

> **Revisão da premissa do PRD:** O PRD documentava banco compartilhado
> entre SmartPick e Farol com schemas isolados. Esta decisão reverte para
> bancos separados, alinhada com o modelo de deploy independente por produto.
> Acoplamento operacional futuro entre produtos ocorrerá via API, não via banco.

**Estrutura do banco `fb_smartpick`:**

```
public.*           → tabelas herdadas do clone (users, environments,
                     enterprise_groups, companies, user_environments,
                     verification_tokens, schema_migrations)

smartpick.*        → tabelas específicas do SmartPick:
  sp_filiais             filiais das empresas (CNPJ, estado, número)
  sp_centros_dist        CDs vinculados a filiais
  sp_motor_params        parâmetros do motor por CD
  sp_user_filiais        scoping de acesso por usuário/empresa/filial
  sp_csv_jobs            jobs de processamento de CSV (async)
  sp_enderecos           endereços de picking por carga/CD
  sp_propostas           propostas de recalibração
  sp_historico           histórico de compliance (até 4 por endereço)
  sp_audit_log           log de auditoria de operações de escrita
  sp_subscription_limits limites de plano por tenant
```

**Migrations:** Arquivos numerados sequencialmente com prefixo `sp_`
no nome. Executados via `onDBConnected()` herdado do clone.

---

### Authentication & Security

**RBAC — Coluna role_smartpick em users (Decisão 3-A)**

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_smartpick VARCHAR(50) DEFAULT 'somente_leitura';
-- Valores: 'admin_fbtax' | 'gestor_geral' | 'gestor_filial' | 'somente_leitura'
```

O `role` original ('admin'/'user') mantido para compatibilidade com o
auth herdado. O `role_smartpick` é a autoridade para controle de acesso
no domínio SmartPick.

**Middleware SmartPick — `handlers/middleware_smartpick.go`:**
1. Valida JWT (reutiliza lógica existente)
2. Lê `role_smartpick` do claims/banco
3. Para Gestor de Filial e Somente Leitura: valida filiais vinculadas via `sp_user_filiais`
4. Injeta `smartpick_role` e `filiais_autorizadas` no contexto do request

**Tabela sp_user_filiais (scoping empresa → filial):**

```sql
CREATE TABLE smartpick.sp_user_filiais (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    empresa_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    filial_id   UUID REFERENCES smartpick.sp_filiais(id) ON DELETE CASCADE,
    -- NULL quando all_filiais = true
    all_filiais BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, empresa_id,
        COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid))
);
-- all_filiais=true, filial_id=NULL  → acesso a todas as filiais da empresa
-- all_filiais=false, filial_id=uuid → acesso somente a esta filial
```

---

### API & Communication Patterns

**URLs diretas /api/ (Decisão 6-B)**

```
Auth (herdado):
  POST   /api/auth/register|login|refresh|logout|forgot-password|reset-password
  GET    /api/auth/me

Hierarquia Admin (herdado + extensão SmartPick):
  CRUD   /api/config/environments
  CRUD   /api/config/groups
  CRUD   /api/config/companies
  CRUD   /api/smartpick/filiais
  CRUD   /api/smartpick/cds

Usuários SmartPick:
  GET/POST /api/admin/users
  PUT      /api/admin/users/:id/filiais

Motor e Parâmetros:
  GET/PUT  /api/smartpick/motor-params/:cd_id

CSV Upload (async):
  POST     /api/smartpick/csv/upload
  GET      /api/smartpick/csv/jobs/:job_id

Dashboard e Propostas:
  GET      /api/smartpick/dashboard/:cd_id
  GET/PUT  /api/smartpick/propostas/:cd_id
  POST     /api/smartpick/propostas/:cd_id/aprovar

PDF:
  POST     /api/smartpick/pdf/gerar

Histórico e Compliance:
  GET      /api/smartpick/historico/:cd_id
  GET      /api/smartpick/compliance/:cd_id
```

Padrão de resposta: JSON, `{"error": "msg"}` para erros, objeto direto
para sucesso — mantém convenções do APU02.

---

### Motor de Calibragem — Processamento Assíncrono (Decisão 4-B)

CSVs de picking podem ser grandes → worker + job table, padrão idêntico
ao `import_jobs` do APU02.

**Fluxo:**
```
1. POST /api/smartpick/csv/upload
   → Valida JWT + filial autorizada
   → Salva arquivo em disco (uploads/)
   → INSERT sp_csv_jobs (status='pending')
   → Retorna {job_id} imediatamente (HTTP 202)

2. Worker goroutine — go startCSVWorker(getDB) no startup
   → Polling sp_csv_jobs WHERE status='pending' (interval: 2s)
   → UPDATE status='processing'
   → Detecta encoding + valida campos obrigatórios
   → Executa motor de calibragem (regras ABC, fórmulas)
   → INSERT sp_enderecos + sp_propostas
   → UPDATE sp_csv_jobs status='completed'|'error' + log_resumo
   → DELETE arquivo do disco

3. GET /api/smartpick/csv/jobs/:job_id
   → Frontend polling até status ∉ {pending, processing}
   → Retorna: status, enderecos_ok, erros, log_resumo
```

**Tabela sp_csv_jobs:**
```sql
CREATE TABLE smartpick.sp_csv_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES environments(id),
    cd_id        UUID NOT NULL REFERENCES smartpick.sp_centros_dist(id),
    user_id      UUID NOT NULL REFERENCES users(id),
    status       VARCHAR(20) DEFAULT 'pending',
    filename     VARCHAR(255),
    enderecos_ok INTEGER DEFAULT 0,
    erros        INTEGER DEFAULT 0,
    log_resumo   TEXT,
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

### PDF Generation

**`github.com/johnfercher/maroto` (Decisão 2)**

Orientado a relatórios tabulares — exatamente o layout do PDF SmartPick:
cabeçalho com CD + data, tabela de endereços com 6 colunas, ordenação
por prioridade Alta→Média→Baixa, formato A4 portrait.

`POST /api/smartpick/pdf/gerar` retorna `Content-Type: application/pdf`
para download direto no browser.

---

### Frontend Architecture

**SmartPickContext — `frontend/src/contexts/SmartPickContext.tsx` (Decisão 5-B)**

```typescript
interface SmartPickContextType {
  empresaId:          string | null
  empresaNome:        string | null
  filialId:           string | null
  filialNome:         string | null
  cdId:               string | null
  roleSmartPick:      'admin_fbtax'|'gestor_geral'|'gestor_filial'|'somente_leitura'
  filiaisAutorizadas: Filial[]
  selectFilial:       (empresaId, filialId, cdId) => void
  clearContext:       () => void
}
```

Envolve apenas rotas autenticadas do domínio SmartPick, abaixo do
`AuthProvider` existente. Não modifica nem substitui o `AuthContext`.

---

### Infrastructure & Deployment

```yaml
# docker-compose.yml (FB_SMARTPICK)
api:  # Go — porta 8082 (evita conflito com APU02:8081)
web:  # Nginx + React — smartpick.fbtax.cloud
db:   # PostgreSQL 15 — banco fb_smartpick
redis: # Herdado do clone — não utilizado no MVP

# Variáveis adicionais além das herdadas:
APP_MODULE=smartpick
VITE_APP_MODULE=smartpick
DATABASE_URL=postgres://...@db:5432/fb_smartpick
APP_URL=https://smartpick.fbtax.cloud
ALLOWED_ORIGINS=https://smartpick.fbtax.cloud,http://localhost:5173
```

---

### Decision Impact Analysis

**Sequência de implementação:**
1. Clone + limpeza de domínio APU02 → repositório FB_SMARTPICK limpo
2. Migrations: schema `smartpick` + todas as tabelas `sp_*`
3. Extensão RBAC: `role_smartpick` + `sp_user_filiais` + middleware
4. Hierarquia admin: `sp_filiais` + `sp_centros_dist` + CRUD handlers
5. CSV worker: `sp_csv_jobs` + worker goroutine + upload handler
6. Motor de calibragem: lógica ABC + `sp_enderecos` + `sp_propostas`
7. Dashboard + Propostas: handlers + frontend pages
8. PDF: maroto + handler + frontend trigger
9. Histórico/Compliance: `sp_historico` + frontend page
10. `SmartPickContext` + roteamento frontend completo

**Dependências críticas entre decisões:**
- Banco separado → migrations independentes, sem coordenação com Farol
- Async worker → `sp_csv_jobs` criada antes do motor de calibragem
- `role_smartpick` → middleware antes de qualquer handler protegido
- `SmartPickContext` → todas as páginas de domínio dependem dele

---

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Banco de Dados — snake_case em tudo:**

```sql
-- ✅ Correto
CREATE TABLE smartpick.sp_csv_jobs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL,
    cd_id      UUID NOT NULL,
    user_id    UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

Regras:
- Tabelas: `snake_case` plural com prefixo `sp_` para tabelas SmartPick
- Colunas: `snake_case`
- FKs: `<entidade>_id` (ex: `tenant_id`, `cd_id`, `user_id`)
- Índices: `idx_<tabela>_<coluna(s)>` (ex: `idx_sp_propostas_cd_id`)
- PKs: sempre `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Timestamps: sempre `created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`

**API Endpoints — substantivos no plural, snake_case/kebab-case:**

```
✅  GET  /api/smartpick/propostas
✅  GET  /api/smartpick/propostas/:cd_id
✅  POST /api/smartpick/csv/upload
✅  PUT  /api/smartpick/motor-params/:cd_id
❌  GET  /api/smartpick/getPropostas
❌  POST /api/smartpick/UploadCSV
```

**Go — PascalCase para exportados, camelCase para internos:**

```go
// ✅ Handlers: PascalCase + sufixo Handler
func GetPropostasHandler(db *sql.DB) http.HandlerFunc { ... }

// ✅ Structs: PascalCase com tags JSON snake_case
type PropostaRequest struct {
    CdID           string `json:"cd_id"`
    EnderecoID     string `json:"endereco_id"`
    NovaCapacidade int    `json:"nova_capacidade"`
}

// ✅ Variáveis locais: camelCase
cdID   := r.URL.Query().Get("cd_id")
userID := GetUserIDFromContext(r)
```

**Frontend — PascalCase para componentes e arquivos:**

```
✅  pages/DashboardUrgencia.tsx
✅  components/PropostaCard.tsx
✅  contexts/SmartPickContext.tsx
✅  hooks/useSmartPick.ts
❌  pages/dashboard-urgencia.tsx
❌  components/proposta_card.tsx
```

---

### Structure Patterns

**Backend — organização de arquivos:**

```
backend/
  main.go                     → rotas, inicialização, worker startup
  go.mod                      → módulo: fb_smartpick
  handlers/
    auth.go                   → herdado
    middleware.go             → herdado
    middleware_smartpick.go   → NOVO: SmartPickAuthMiddleware
    environment.go            → herdado
    hierarchy.go              → herdado
    csv_upload.go             → NOVO
    calibration.go            → NOVO: motor de calibragem
    proposals.go              → NOVO
    dashboard.go              → NOVO
    pdf.go                    → NOVO
    history.go                → NOVO
    motor_params.go           → NOVO
    filiais_smartpick.go      → NOVO
    admin_smartpick.go        → NOVO
  services/
    email.go                  → herdado
    csv_worker.go             → NOVO: worker goroutine
    calibration_engine.go     → NOVO: lógica pura do motor
  migrations/
    001_*.sql ... N_*.sql     → herdadas do clone
    0XX_sp_schema.sql         → NOVO: CREATE SCHEMA smartpick
    0XX_sp_filiais.sql        → NOVO: tabelas sp_*
```

**Frontend — organização de arquivos:**

```
frontend/src/
  App.tsx                     → rotas (herdado, limpo de páginas APU02)
  contexts/
    AuthContext.tsx            → herdado (não modificar)
    SmartPickContext.tsx       → NOVO
  pages/
    Login.tsx / Register.tsx / ForgotPassword.tsx / ResetPassword.tsx → herdado
    DashboardUrgencia.tsx     → NOVO
    UploadCSV.tsx             → NOVO
    HistoricoCompliance.tsx   → NOVO
    GeradorPDF.tsx            → NOVO
    ConfiguracaoMotor.tsx     → NOVO (admin)
    GestaoFiliais.tsx         → NOVO (admin)
    AdminSmartPick.tsx        → NOVO (admin)
    GestaoAmbiente.tsx        → herdado (admin)
    AdminUsers.tsx            → herdado (admin)
  components/
    ui/                       → herdado (Shadcn/Radix — não modificar)
    AppRail.tsx               → herdado (adaptar menu)
  hooks/
    useSmartPick.ts           → NOVO: TanStack Query hooks SmartPick
```

---

### Format Patterns

**Respostas de API:**

```go
// ✅ Sucesso: objeto direto (sem wrapper)
w.Header().Set("Content-Type", "application/json")
json.NewEncoder(w).Encode(propostas)

// ✅ Erro
http.Error(w, "CD não encontrado", http.StatusNotFound)
// ou JSON para erros com contexto
json.NewEncoder(w).Encode(map[string]string{"error": "campo GIRO ausente na linha 42"})

// ❌ Wrapper desnecessário
json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": propostas})
```

**HTTP Status codes:**
- `200` → GET com resultado, PUT/POST com retorno
- `202` → POST async (CSV upload → retorna job_id)
- `400` → validação de input falhou
- `401` → JWT inválido/expirado
- `403` → perfil sem permissão
- `404` → recurso não encontrado
- `500` → erro inesperado

**Datas — sempre ISO 8601 string no JSON:**

```go
CreatedAt string `json:"created_at"` // "2026-04-06T14:30:00Z"
```

---

### Process Patterns

**Handler Go — estrutura padrão:**

```go
func GetPropostasHandler(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // 1. Extrair identidade do contexto
        userID  := GetUserIDFromContext(r)
        filiais := GetFiliaisAutorizadasFromContext(r)

        // 2. Validar parâmetros
        cdID := r.URL.Query().Get("cd_id")
        if cdID == "" {
            http.Error(w, "cd_id obrigatório", http.StatusBadRequest)
            return
        }

        // 3. Verificar acesso à filial
        if !isFilialAutorizada(filiais, cdID) {
            http.Error(w, "Acesso negado a este CD", http.StatusForbidden)
            return
        }

        // 4. Query com prepared statement — NUNCA concatenar SQL
        rows, err := db.Query(
            `SELECT id, endereco_fisico, cap_atual, cap_proposta
             FROM smartpick.sp_propostas WHERE cd_id = $1`,
            cdID,
        )
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        defer rows.Close()

        // 5. Responder
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(propostas)
    }
}
```

**Frontend — hooks TanStack Query:**

```typescript
// Query
export function usePropostas(cdId: string) {
  return useQuery({
    queryKey: ['propostas', cdId],
    queryFn: () => fetch(`/api/smartpick/propostas/${cdId}`)
                     .then(res => { if (!res.ok) throw new Error('Erro'); return res.json() }),
    enabled: !!cdId,
  })
}

// Mutation
export function useAprovarPropostas(cdId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      fetch(`/api/smartpick/propostas/${cdId}/aprovar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).then(res => res.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['propostas', cdId] }),
  })
}
```

---

### Enforcement Guidelines

**Todo agente DEVE:**
- Usar `snake_case` em nomes de tabelas, colunas e campos JSON
- Nunca concatenar strings em queries SQL — sempre `$1`, `$2`, ...
- Verificar autorização de filial antes de qualquer operação de dado SmartPick
- Usar `SmartPickAuthMiddleware` em todas as rotas de domínio SmartPick
- Retornar objetos JSON diretos (sem wrapper `{data, success, message}`)
- Prefixar tabelas SmartPick com `sp_` e criar no schema `smartpick.*`
- Usar `TanStack Query` para toda comunicação frontend-backend
- Nunca modificar `AuthContext.tsx` — é imutável no clone

**Anti-patterns a evitar:**
- `SELECT *` em queries — especificar colunas sempre
- Lógica de negócio no frontend — motor de calibragem 100% no backend
- Hardcode de thresholds do motor — usar `sp_motor_params` sempre
- Adicionar dependências novas sem verificar compatibilidade com as existentes

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
FB_SMARTPICK/
├── README.md
├── VERSIONAMENTO.md
├── docker-compose.yml              ← adaptado (smartpick, porta 8082)
├── docker-compose.prod.yml         ← adaptado
├── Dockerfile.production
├── coolify-env-template.txt        ← adaptado (APP_MODULE=smartpick)
├── .env.example
│
├── backend/
│   ├── Dockerfile
│   ├── main.go                     ← adaptado (rotas SmartPick, worker startup)
│   ├── go.mod                      ← module fb_smartpick
│   ├── go.sum
│   │
│   ├── handlers/
│   │   ├── auth.go                 ← herdado
│   │   ├── middleware.go           ← herdado (CORS, security headers, rate limiter)
│   │   ├── middleware_smartpick.go ← NOVO: SmartPickAuthMiddleware + filial scope
│   │   ├── environment.go          ← herdado (CRUD environments/groups/companies)
│   │   ├── hierarchy.go            ← herdado (GetUserHierarchyHandler)
│   │   ├── config.go               ← herdado (env vars helpers)
│   │   ├── crypto.go               ← herdado (AES-256 para campos sensíveis)
│   │   │
│   │   ├── filiais_smartpick.go    ← NOVO: CRUD sp_filiais + sp_centros_dist
│   │   ├── motor_params.go         ← NOVO: GET/PUT sp_motor_params por CD
│   │   ├── admin_smartpick.go      ← NOVO: gestão de planos, limites, role_smartpick
│   │   │
│   │   ├── csv_upload.go           ← NOVO: upload, validação, criação de sp_csv_jobs
│   │   ├── calibration.go          ← NOVO: trigger motor, consulta propostas
│   │   ├── proposals.go            ← NOVO: GET/PUT propostas, aprovação individual/lote
│   │   ├── dashboard.go            ← NOVO: urgency dashboard, agregações por rua
│   │   ├── pdf.go                  ← NOVO: geração PDF via maroto
│   │   └── history.go              ← NOVO: histórico de compliance por endereço
│   │
│   ├── services/
│   │   ├── email.go                ← herdado (SMTP, templates HTML)
│   │   ├── csv_worker.go           ← NOVO: worker goroutine, polling sp_csv_jobs
│   │   └── calibration_engine.go  ← NOVO: lógica pura ABC, fórmulas, thresholds
│   │
│   └── migrations/
│       ├── 001_create_jobs_table.sql            ← herdado
│       ├── 013_create_environment_hierarchy.sql ← herdado
│       ├── 015_create_auth_system.sql           ← herdado
│       ├── 016_seed_default_environment.sql     ← herdado
│       ├── 017_add_owner_to_companies.sql       ← herdado
│       ├── 018_add_role_to_users.sql            ← herdado
│       ├── 020_promote_admin_users.sql          ← herdado
│       ├── 025_add_indexes_auth.sql             ← herdado
│       ├── 045_add_used_to_verification_tokens.sql ← herdado
│       │   (migrations de domínio APU02 REMOVIDAS do clone)
│       │
│       ├── 100_add_role_smartpick_to_users.sql  ← NOVO: role_smartpick VARCHAR(50)
│       ├── 101_create_smartpick_schema.sql      ← NOVO: CREATE SCHEMA smartpick
│       ├── 102_sp_filiais.sql                   ← NOVO: filiais (CNPJ, estado, número)
│       ├── 103_sp_centros_dist.sql              ← NOVO: CDs (FK sp_filiais)
│       ├── 104_sp_user_filiais.sql              ← NOVO: scoping user × empresa × filial
│       ├── 105_sp_motor_params.sql              ← NOVO: parâmetros motor por CD
│       ├── 106_sp_subscription_limits.sql       ← NOVO: limites de plano por tenant
│       ├── 107_sp_csv_jobs.sql                  ← NOVO: jobs de processamento CSV
│       ├── 108_sp_enderecos.sql                 ← NOVO: endereços de picking por carga
│       ├── 109_sp_propostas.sql                 ← NOVO: propostas de recalibração
│       ├── 110_sp_historico.sql                 ← NOVO: histórico (até 4 por endereço)
│       ├── 111_sp_audit_log.sql                 ← NOVO: audit log de operações
│       └── 112_sp_indexes.sql                   ← NOVO: índices de performance
│
└── frontend/
    ├── Dockerfile / Dockerfile.dev
    ├── package.json                ← herdado (versões mantidas)
    ├── tsconfig.json / vite.config.ts / tailwind.config.js
    ├── nginx.conf                  ← herdado
    │
    └── src/
        ├── main.tsx / index.css    ← herdado
        ├── App.tsx                 ← adaptado (rotas SmartPick, remove páginas APU02)
        │
        ├── contexts/
        │   ├── AuthContext.tsx         ← herdado (NÃO MODIFICAR)
        │   └── SmartPickContext.tsx    ← NOVO: empresaId, filialId, cdId, role, filiais
        │
        ├── pages/
        │   ├── Login.tsx / Register.tsx / ForgotPassword.tsx / ResetPassword.tsx ← herdado
        │   ├── DashboardUrgencia.tsx   ← NOVO: endereços por rua, % ofensa
        │   ├── UploadCSV.tsx           ← NOVO: upload + polling job status
        │   ├── HistoricoCompliance.tsx ← NOVO: histórico por endereço + % compliance
        │   ├── GeradorPDF.tsx          ← NOVO: seleção de endereços + download PDF
        │   ├── GestaoAmbiente.tsx      ← herdado (environments/groups/companies)
        │   ├── AdminUsers.tsx          ← herdado + extensão (role_smartpick, filiais popup)
        │   ├── GestaoFiliais.tsx       ← NOVO: CRUD filiais + CDs (admin)
        │   ├── ConfiguracaoMotor.tsx   ← NOVO: parâmetros motor por CD (admin)
        │   └── AdminSmartPick.tsx      ← NOVO: planos, limites, visão global (admin)
        │
        ├── components/
        │   ├── ui/                     ← herdado (Shadcn/Radix — NÃO MODIFICAR)
        │   ├── AppRail.tsx             ← herdado (adaptar: menu SmartPick)
        │   ├── AppSidebar.tsx          ← herdado (adaptar)
        │   ├── CompanySwitcher.tsx / Footer.tsx ← herdado
        │   ├── PropostaRow.tsx         ← NOVO: linha editável do dashboard
        │   ├── FilialSelector.tsx      ← NOVO: seletor empresa → filial → CD
        │   ├── CSVUploadZone.tsx       ← NOVO: drag-and-drop + progresso do job
        │   ├── ComplianceBadge.tsx     ← NOVO: badge 2ª/3ª/4ª ocorrência
        │   └── FilialAccessPopup.tsx   ← NOVO: popup de vinculação empresa/filiais
        │
        ├── hooks/
        │   ├── use-mobile.tsx          ← herdado
        │   └── useSmartPick.ts         ← NOVO: todos os hooks TanStack Query SmartPick
        │
        └── lib/
            ├── utils.ts                ← herdado
            └── navigation.ts           ← herdado (adaptar: módulos SmartPick)
```

---

### Architectural Boundaries

**Fronteira de Auth (herdada):**
- Tudo atrás de `AuthMiddleware` requer JWT válido
- `AuthContext` injeta token em todos os requests via fetch interceptor
- `/api/auth/*` é público; tudo mais requer `Authorization: Bearer <token>`

**Fronteira SmartPick (nova):**
- Todas as rotas `/api/smartpick/*` passam por `SmartPickAuthMiddleware`
- Middleware injeta no contexto: `smartpick_role`, `tenant_id`, `filiais_autorizadas`
- Handlers verificam `filiais_autorizadas` antes de acessar dados de qualquer CD

**Fronteira de Dados:**
- Schema `public.*` → auth/tenant compartilhado (herdado)
- Schema `smartpick.*` → exclusivo SmartPick, prefixo `sp_`
- Sem cross-product queries — cada produto acessa apenas seu banco

**Fronteira do Motor de Calibragem:**
- `calibration_engine.go` é biblioteca interna pura (sem dependências de DB)
- `csv_worker.go` orquestra: lê CSV → chama engine → persiste resultados
- Frontend nunca executa lógica de calibragem

---

### Requirements to Structure Mapping

| FR | Handler/Service | Migration | Frontend |
|---|---|---|---|
| FR1–5 (CSV) | `csv_upload.go`, `csv_worker.go` | `107`, `108` | `UploadCSV.tsx`, `CSVUploadZone.tsx` |
| FR6–12 (Motor) | `calibration.go`, `calibration_engine.go` | `109`, `105` | `ConfiguracaoMotor.tsx` |
| FR13–17 (Dashboard) | `dashboard.go`, `proposals.go` | `109` | `DashboardUrgencia.tsx`, `PropostaRow.tsx` |
| FR18–21 (PDF) | `pdf.go` | — | `GeradorPDF.tsx` |
| FR22–25 (Histórico) | `history.go` | `110` | `HistoricoCompliance.tsx`, `ComplianceBadge.tsx` |
| FR26–30 (Admin) | `filiais_smartpick.go`, `admin_smartpick.go` | `102–106`, `112` | `GestaoFiliais.tsx`, `AdminSmartPick.tsx` |
| FR31–35 (RBAC) | `middleware_smartpick.go` | `100`, `104` | `AdminUsers.tsx`+, `FilialAccessPopup.tsx` |
| FR36–38 (Email) | `email.go` (herdado) | `015` (herdado) | `ForgotPassword.tsx` (herdado) |

---

### Data Flow Principal

```
Gestor → Upload CSV
  POST /api/smartpick/csv/upload
  → csv_upload.go: valida filial + salva arquivo + INSERT sp_csv_jobs
  → Retorna {job_id} (HTTP 202)

csv_worker.go (goroutine background)
  → Polling sp_csv_jobs WHERE status='pending' (interval 2s)
  → Detecta encoding + valida campos obrigatórios
  → calibration_engine.go: regras ABC + fórmulas + thresholds do sp_motor_params
  → INSERT sp_enderecos + sp_propostas
  → UPDATE sp_csv_jobs status='completed' + log_resumo

Frontend polling GET /api/smartpick/csv/jobs/:id
  → status='completed' → navega para DashboardUrgencia

Gestor → Aprova propostas → Gera PDF
  POST /api/smartpick/propostas/:cd_id/aprovar
  POST /api/smartpick/pdf/gerar
  → pdf.go: maroto → Content-Type: application/pdf → download no browser
```

---

## Architecture Validation Results

### Coherence Validation ✅

| Decisão | Compatibilidade | Observação |
|---|---|---|
| Go 1.22 + database/sql + lib/pq | ✅ | PostgreSQL 15 suportado nativamente |
| JWT golang-jwt/jwt/v5 + bcrypt | ✅ | Herdado do APU02, testado em produção |
| React 18 + Vite + TanStack Query | ✅ | Versões compatíveis, sem conflitos |
| maroto PDF (pure Go) | ✅ | Sem dependências externas, deploy simples |
| Async worker + sp_csv_jobs | ✅ | Padrão idêntico ao APU02, já validado |
| role_smartpick + role original | ✅ | Colunas independentes, sem conflito |
| Banco separado fb_smartpick | ✅ | Elimina coordenação de migrations com Farol |
| Schema smartpick.* | ✅ | Isolamento dentro do banco próprio |
| Redis no compose (não usado) | ⚠️ | Overhead mínimo; mantido por compatibilidade |

snake_case banco ↔ JSON ↔ API; PascalCase Go ↔ React ↔ arquivos — coerente em todos os níveis. ✅
handlers/ e migrations/ espelham APU02; SmartPickContext isolado abaixo do AuthProvider. ✅

---

### Requirements Coverage Validation

**38 FRs cobertos:**

| Área | FRs | Cobertura |
|---|---|---|
| CSV (FR1–5) | 5 | `csv_upload.go` + `csv_worker.go` + `sp_csv_jobs` + `sp_enderecos` ✅ |
| Motor (FR6–12) | 7 | `calibration_engine.go` + `sp_motor_params` + `sp_propostas` ✅ |
| Dashboard (FR13–17) | 5 | `dashboard.go` + `proposals.go` + `DashboardUrgencia.tsx` ✅ |
| PDF (FR18–21) | 4 | `pdf.go` (maroto) + `GeradorPDF.tsx` ✅ |
| Histórico (FR22–25) | 4 | `history.go` + `sp_historico` + `HistoricoCompliance.tsx` ✅ |
| Admin (FR26–30) | 5 | `filiais_smartpick.go` + `admin_smartpick.go` + `sp_subscription_limits` ✅ |
| RBAC (FR31–35) | 5 | `middleware_smartpick.go` + `sp_user_filiais` + `role_smartpick` ✅ |
| Email (FR36–38) | 3 | `email.go` herdado ✅ |

**17 NFRs cobertos:** Performance (worker async < 10s, maroto < 5s, queries indexadas < 3s), Segurança (TLS/Traefik, isolamento tenant, JWT herdado, audit log), Escalabilidade (banco separado, pool Go, sp_motor_params configurável), Confiabilidade (Coolify health checks, goroutines isoladas), Integração (encoding detection, maroto A4). ✅

---

### Gap Analysis Results

**Gaps Críticos:** Nenhum.

**Gaps Importantes:**
1. Campos do CSV (GIRO, CAPACIDADE, etc.) não mapeados explicitamente → resolvido na migration `108_sp_enderecos.sql`
2. Recomendação: adicionar `carga_id UUID` em `sp_enderecos` para identificar cada ciclo de carga e facilitar rastreamento de compliance entre ciclos

**Gaps Menores:** `ENCRYPTION_KEY` herdado sem uso no MVP (inofensivo). Testes unitários para `calibration_engine.go` recomendados pós-V1.

---

### Architecture Completeness Checklist

- [x] PRD, Product Brief e código real do FB_APU02 analisados
- [x] 38 FRs e 17 NFRs mapeados a componentes arquiteturais
- [x] Clone strategy com checklist HERDADO / ADAPTADO / NOVO
- [x] 6 decisões abertas resolvidas colaborativamente
- [x] 13 migrations SmartPick documentadas (100–112)
- [x] Naming conventions, padrões de handler Go e TanStack Query
- [x] Árvore completa de diretórios com todos os arquivos
- [x] Mapeamento FR → handler → migration → frontend page
- [x] Data flow principal documentado
- [x] Enforcement guidelines e anti-patterns definidos

---

### Architecture Readiness Assessment

**Status:** PRONTO PARA IMPLEMENTAÇÃO — Confiança: Alta

**Forças:** Clone APU02 reduz risco técnico (stack em produção); padrão worker/jobs testado; banco separado simplifica deploys; maroto zero-dep; RBAC extensível sem quebrar auth existente.

**Evolução V2:** Agente Text-to-SQL, CEO Executive View, erp_bridge SmartPick.

---

### Implementation Handoff

**Primeiro passo:**
```bash
git clone <fb_apu02_repo> FB_SMARTPICK
cd FB_SMARTPICK && rm -rf .git && git init
# Seguir checklist da seção "Starter Template Evaluation"
```

**Sequência:** Clone → Migrations 100–112 → RBAC → Hierarquia Admin → CSV Worker → Motor → Dashboard + PDF → Histórico/Compliance

**Diretriz para agentes:** Este documento é fonte de verdade arquitetural. Não tomar decisões de stack não documentadas aqui. Sempre verificar `filiais_autorizadas` antes de acessar dados. Nunca modificar `AuthContext.tsx` nem `services/email.go`. Motor 100% no backend.

---

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅
**Total Steps Completed:** 8
**Date Completed:** 2026-04-06
**Document Location:** `_bmad-output/planning-artifacts/architecture.md`

### Final Architecture Deliverables

**📋 Complete Architecture Document**

- Todas as decisões arquiteturais documentadas com versões específicas
- Padrões de implementação garantindo consistência entre agentes AI
- Estrutura completa do projeto com todos os arquivos e diretórios
- Mapeamento de requisitos para componentes arquiteturais
- Validação confirmando coerência e completude

**🏗️ Implementation Ready Foundation**

- 6 decisões arquiteturais tomadas (schema DB, PDF, RBAC, motor, contexto frontend, estrutura URLs)
- 13 migrações numeradas 100–112 especificadas
- Todos os 38 FRs e 17 NFRs do PRD cobertos arquiteturalmente
- Stack clone FB_APU02 — risco técnico mínimo (Go 1.22, React 18.3, PostgreSQL 15)

**📚 AI Agent Implementation Guide**

- Stack tecnológico com versões verificadas (produção no FB_APU02)
- Regras de consistência que previnem conflitos de implementação
- Estrutura de projeto com fronteiras claras entre backend/frontend
- Padrões de integração: worker assíncrono CSV, geração PDF maroto, RBAC 4 perfis

### Implementation Handoff — Sequência Definitiva

**Para Agentes AI:**
Este documento é o guia completo para implementar o FB_SMARTPICK. Seguir todas as decisões, padrões e estruturas exatamente como documentado.

**Prioridade de Implementação:**

1. Clone FB_APU02 → renomear módulo Go para `fb_smartpick`
2. Criar banco `fb_smartpick` + schema `smartpick.*`
3. Executar migrações 100–112 (em ordem)
4. Adicionar `role_smartpick` + tabela `user_filiais`
5. Implementar `SmartPickAuthMiddleware`
6. CSV upload + worker goroutine (padrão `sp_csv_jobs`)
7. Motor de calibragem (Go puro, endpoint REST)
8. Dashboard de urgência + geração PDF (maroto)
9. Histórico de propostas + compliance

**Sequência de desenvolvimento:**
Clone → Migrations 100–112 → RBAC → Hierarquia Admin → CSV Worker → Motor → Dashboard + PDF → Histórico/Compliance

### Quality Assurance Checklist

**✅ Coerência Arquitetural**

- [x] Todas as decisões trabalham juntas sem conflitos
- [x] Escolhas tecnológicas são compatíveis (stack FB_APU02 em produção)
- [x] Padrões suportam as decisões arquiteturais
- [x] Estrutura alinha com todas as escolhas

**✅ Cobertura de Requisitos**

- [x] Todos os 38 FRs funcionais suportados
- [x] Todos os 17 NFRs endereçados
- [x] Preocupações transversais tratadas (auth, RBAC, audit log, rate limiting)
- [x] Pontos de integração definidos (Winthor CSV, SAP S/4 CSV, ERP Bridge v2)

**✅ Prontidão para Implementação**

- [x] Decisões são específicas e acionáveis
- [x] Padrões previnem conflitos entre agentes
- [x] Estrutura está completa e não ambígua
- [x] Exemplos fornecidos para clareza (DDL, code snippets, naming conventions)

---

**Architecture Status:** PRONTO PARA IMPLEMENTAÇÃO ✅

**Próxima Fase:** `create-epics-and-stories` (agent: pm) — decompor FRs em épicos e user stories implementáveis.

**Manutenção do Documento:** Atualizar esta arquitetura quando decisões técnicas relevantes forem tomadas durante a implementação.
