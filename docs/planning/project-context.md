---
project_name: 'FB_SMARTPICK'
user_name: 'Claudio'
date: '2026-04-06'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'database_security', 'quality_workflow_antipatterns']
status: 'complete'
rule_count: 48
optimized_for_llm: true
existing_patterns_found: 42
---

# Project Context for AI Agents — FB_SMARTPICK

_Este arquivo contém regras críticas e padrões que agentes AI devem seguir ao implementar código neste projeto. Foco em detalhes não-óbvios que agentes costumam ignorar._

---

## Technology Stack & Versions

**Backend**
- Go 1.22 — `net/http` standard library (sem framework externo)
- `github.com/golang-jwt/jwt/v5`
- `github.com/lib/pq` (driver PostgreSQL)
- `golang.org/x/crypto/bcrypt`
- `github.com/joho/godotenv`
- `github.com/johnfercher/maroto` (geração de PDF)

**Frontend**
- React 18.3.1 + TypeScript 5.2.2 + Vite 5.2.0
- `@tanstack/react-query` 5.x
- `react-router-dom` 6.22.3
- Tailwind CSS 3.4.3
- Shadcn/UI (Radix UI) — componentes já disponíveis no clone
- Lucide React (ícones)
- Recharts (gráficos)
- `react-hook-form` + `zod` (formulários com validação)
- `date-fns` (manipulação de datas)

**Banco de dados**
- PostgreSQL 15-alpine (Docker)
- Banco: `fb_smartpick`; schema de domínio: `smartpick`

**Infraestrutura**
- Docker Compose + Nginx + Coolify + Traefik
- Porta API: 8082 (não colidir com APU02:8081)
- URL: `smartpick.fbtax.cloud`

---

## Critical Implementation Rules

### Language-Specific Rules

**Go**
- Módulo Go: `fb_smartpick` (go.mod) — nunca usar `fb_apu02`
- Handlers: sempre PascalCase + sufixo `Handler`
  - ✅ `GetPropostasHandler`, `UploadCSVHandler`
  - ❌ `getPropostas`, `uploadCSV`
- Structs: PascalCase com tags JSON snake_case
- Variáveis locais: camelCase — `cdID`, `userID`, `empresaID`
- **Prepared statements obrigatórios** em toda query SQL — nunca concatenar strings para montar SQL
- Erros: sempre `if err != nil { ... }` — sem panic em handlers
- JSON responses: `json.NewEncoder(w).Encode(...)`, nunca `fmt.Fprintf`
- Context de request: extrair `smartpick_role` e `filiais_autorizadas` via helper — nunca acessar diretamente de headers brutos

**TypeScript**
- Strict mode ativo — sem `any` implícito
- Imports: path alias `@/` para `src/` (configurado no Vite do clone)
  - ✅ `import { Button } from '@/components/ui/button'`
  - ❌ `import { Button } from '../../components/ui/button'`
- Tipos: sempre tipar retornos de `useQuery` / `useMutation`
- Async: usar `async/await` — evitar `.then()/.catch()` encadeados
- Arquivos de páginas: PascalCase — `DashboardUrgencia.tsx`
- Hooks customizados: prefixo `use` — `useSmartPick.ts`

### Framework-Specific Rules

**React**
- **`AuthContext` e `services/email.go` NUNCA modificar** — herdados do clone sem alteração; qualquer mudança quebra o auth global
- `SmartPickContext` é independente do `AuthContext` — não misturar; fornece `empresaId`, `filialId`, `cdId`, `roleSmartPick`, `filiaisAutorizadas`
- Fetch de dados: **sempre via TanStack Query** (`useQuery`/`useMutation`) — nunca `useEffect` + `fetch` diretamente para dados de servidor
- O fetch interceptor global em `AuthContext` injeta `Authorization` e `X-Company-ID` automaticamente — não duplicar esses headers
- Rotas protegidas: usar `ProtectedRoute` (autenticado) — nunca proteção inline no componente
- Componentes UI: usar Shadcn (`@/components/ui/`) — não criar primitivos duplicados
- Estado de servidor = TanStack Query; estado local de UI = `useState`; nunca `useState` para cache de API

**Go HTTP (`net/http`)**
- Rotas em `main.go`: `mux.HandleFunc("/api/smartpick/...", handler(db))`
- Handlers recebem `db *sql.DB` via closure: `func GetPropostasHandler(db *sql.DB) http.HandlerFunc`
- Middleware chain: `SecurityMiddleware` → `AuthMiddleware` → `SmartPickAuthMiddleware` → handler
- CORS configurado no `SecurityMiddleware` — apenas atualizar `ALLOWED_ORIGINS` no `.env`
- Migrations numeradas a partir de `100` para SmartPick; executadas automaticamente pelo `onDBConnected()`
- Worker CSV: goroutine iniciada em `main.go`; polling via `sp_csv_jobs` — padrão idêntico ao `import_jobs` do APU02

### Database & Security Rules

**Schema e Nomenclatura**
- Todas as tabelas SmartPick vivem no schema `smartpick` com prefixo `sp_`
  - ✅ `smartpick.sp_propostas`, `smartpick.sp_csv_jobs`
  - ❌ `public.propostas`, `public.csv_jobs`
- Tabelas herdadas do clone ficam em `public.*` — nunca mover para `smartpick`
- Colunas: snake_case — `empresa_id`, `filial_id`, `nova_capacidade`
- PKs: UUID (`gen_random_uuid()`) — nunca SERIAL/BIGSERIAL em tabelas novas
- FKs: sempre `ON DELETE CASCADE` ou `ON DELETE SET NULL` explícito

**Scoping de Filial — Regra Crítica**
- **Sempre verificar `sp_user_filiais` antes de retornar dados de filial**
- Para `gestor_filial` e `somente_leitura`: filtrar por `filiais_autorizadas` injetado pelo `SmartPickAuthMiddleware`
- Para `gestor_geral` e `admin_fbtax`: acesso total à empresa/tenant
- `empresa_id` vem do header `X-Company-ID` (injetado pelo `AuthContext`)

**RBAC — 4 perfis SmartPick**
- `admin_fbtax` — acesso total a todos os tenants (equipe fbtax)
- `gestor_geral` — acesso total dentro do tenant
- `gestor_filial` — acesso restrito às filiais vinculadas em `sp_user_filiais`
- `somente_leitura` — igual ao gestor_filial mas sem escrita
- Coluna: `role_smartpick VARCHAR(50)` na tabela `users` (public schema)
- O `role` original ('admin'/'user') **mantido intacto** — não remover nem alterar

**SQL — Segurança**
- Prepared statements em 100% das queries: `db.QueryRow("SELECT ... WHERE id = $1", id)`
- Nunca `fmt.Sprintf` ou concatenação para montar SQL
- Queries com múltiplas linhas: sempre `defer rows.Close()`
- Transações para operações que escrevem em múltiplas tabelas

**Audit Log**
- Inserir em `smartpick.sp_audit_log` em toda operação de escrita (propostas, parâmetros, filiais)
- Campos mínimos: `user_id`, `action`, `table_name`, `record_id`, `created_at`

### Code Quality & Style Rules

**Estrutura de arquivos — Backend**
```
backend/
  main.go                     → rotas, startup, worker goroutine
  go.mod                      → module fb_smartpick
  handlers/
    auth.go                   → HERDADO — não modificar
    middleware.go             → HERDADO — não modificar
    middleware_smartpick.go   → NOVO: SmartPickAuthMiddleware
    environment.go            → HERDADO
    hierarchy.go              → HERDADO
    csv_upload.go             → NOVO
    calibration.go            → NOVO
    proposals.go              → NOVO
    dashboard.go              → NOVO
    pdf.go                    → NOVO
    history.go                → NOVO
    motor_params.go           → NOVO
    filiais_smartpick.go      → NOVO
    admin_smartpick.go        → NOVO
  services/
    email.go                  → HERDADO — não modificar
  migrations/
    001–09x_*.sql             → HERDADO do clone
    100_sp_schema.sql         → NOVO: CREATE SCHEMA smartpick
    101–112_sp_*.sql          → NOVO: tabelas SmartPick
```

**Estrutura de arquivos — Frontend**
```
frontend/src/
  contexts/
    AuthContext.tsx            → HERDADO — não modificar
    SmartPickContext.tsx       → NOVO
  pages/
    Login.tsx / Register.tsx  → HERDADO
    UploadCSV.tsx             → NOVO
    DashboardUrgencia.tsx     → NOVO
    HistoricoCompliance.tsx   → NOVO
    GeradorPDF.tsx            → NOVO
    ConfiguracaoMotor.tsx     → NOVO
    GestaoFiliais.tsx         → NOVO
    AdminSmartPick.tsx        → NOVO
  components/ui/              → HERDADO Shadcn — não recriar
  App.tsx                     → substituir rotas de domínio APU02
```

**Comentários**
- Apenas onde a lógica não é auto-evidente
- Regras do motor de calibragem **devem ter comentário** explicando a fórmula
- Não adicionar JSDoc/godoc em funções triviais

### Development Workflow Rules

**Git**
- Feature branches: `feat/nome-da-feature`
- Fix branches: `fix/descricao-do-bug`
- Commits: mensagem em português, imperativo — "Adiciona handler de upload CSV"
- Nunca commitar `.env` ou credenciais

**Deploy**
- Deploy via Coolify — push para `main` dispara build automático
- Variáveis de ambiente no painel Coolify (nunca hardcode)
- Porta API: **8082** — não alterar (evita conflito com APU02:8081)
- Health check: `GET /api/health` (herdado do clone)

**Migrações**
- Migrações são **irreversíveis** — nunca deletar arquivo existente
- Para corrigir: criar nova migration com `ALTER TABLE` ou `DROP`
- Nomenclatura: `NNN_sp_nome_descritivo.sql`

### Critical Don't-Miss Rules (Anti-Patterns)

**NUNCA fazer:**
- Modificar `handlers/auth.go`, `handlers/middleware.go`, `services/email.go`, `contexts/AuthContext.tsx`
- Colocar lógica do motor de calibragem no frontend (zero business logic em React)
- Usar ORM ou query builder — apenas `database/sql` + SQL nativo
- Concatenar strings para montar SQL
- Usar `any` implícito em TypeScript
- Acessar dados de filial sem verificar `sp_user_filiais` para perfis restritos
- Criar tabela SmartPick fora do schema `smartpick` ou sem prefixo `sp_`
- Duplicar componentes UI primitivos que já existem no Shadcn
- Usar `useEffect` + `fetch` diretamente em vez de TanStack Query

**Calibration Engine — Regras de negócio críticas**
- Curva A: **nunca reduzir** — retornar warning ao gestor
- Shortage offenders: `GIRO > CAPACIDADE` → proposta de aumento
- Space offenders: `CAPACIDADE > N × GIRO` (N configurável por CD em `sp_motor_params`)
- Curvas B/C/D: auto-redução permitida
- Todas as regras em `handlers/calibration.go` — nenhuma regra no frontend
- Parâmetro N: valor padrão em `sp_motor_params`, editável por `admin_fbtax` e `gestor_geral`

**PDF (maroto)**
- Geração server-side em `handlers/pdf.go` — nunca no frontend
- Content-Type: `application/pdf` + `Content-Disposition: attachment`
- Ordenação: por rua, depois por endereço (server-side)

**Worker CSV assíncrono**
- Upload → inserir job em `sp_csv_jobs` com status `pending` → retornar `job_id`
- Frontend faz polling em `GET /api/smartpick/csv-jobs/:job_id`
- Worker: goroutine com `time.Sleep(5s)` entre polls
- Erro: `sp_csv_jobs.status = 'error'` + `error_message`

---

## Usage Guidelines

**Para Agentes AI:**
- Ler este arquivo antes de implementar qualquer código
- Seguir TODAS as regras exatamente como documentado
- Em caso de dúvida, preferir a opção mais restritiva
- Arquivos marcados como **HERDADO — não modificar** são intocáveis
- Verificar sempre o scoping de filial antes de retornar dados

**Para Humanos:**
- Manter este arquivo enxuto e focado nas necessidades dos agentes
- Atualizar quando o stack tecnológico mudar
- Remover regras que se tornarem óbvias com o tempo

_Last Updated: 2026-04-06_
