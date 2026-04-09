---
title: 'Painel de Resultados'
slug: 'painel-de-resultados'
created: '2026-04-09'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'Go 1.26 / net/http'
  - 'PostgreSQL 15 (schema smartpick)'
  - 'React 18 + TypeScript + Vite'
  - 'Tailwind + shadcn/ui'
  - 'recharts@^3.7.0 (já instalado)'
files_to_modify:
  - 'backend/handlers/sp_resultados.go (CRIAR)'
  - 'backend/main.go'
  - 'frontend/src/pages/SpResultados.tsx (CRIAR)'
  - 'frontend/src/components/AppRail.tsx'
  - 'frontend/src/lib/navigation.ts'
  - 'frontend/src/App.tsx'
code_patterns:
  - 'Handler: func SpResultadosHandler(db *sql.DB) http.HandlerFunc'
  - 'Rota registrada: withSP(handlers.SpResultadosHandler, "gestor_filial")'
  - 'AppRail: adicionar entrada em mainItems[]'
  - 'navigation.ts: adicionar módulo resultados + caso no getActiveModule'
  - 'CTE PostgreSQL para últimos 4 jobs por CD com ROW_NUMBER() OVER PARTITION BY cd_id'
  - 'recharts: AreaChart ou LineChart para sparkline de 4 ciclos'
test_patterns: []
---

# Tech-Spec: Painel de Resultados

**Created:** 2026-04-09

## Overview

### Problem Statement

Não existe visibilidade consolidada dos 5 KPIs contratuais do Grupo JC — calibração %, ofensores A/B, caixas ociosas, reposições emergenciais e acessos picking (90d) — impedindo o cliente de acompanhar o progresso contra as metas acordadas em contrato ao longo do tempo.

### Solution

Novo módulo "Resultados" no AppRail com dois níveis de visão:
1. **Cards consolidados da empresa** — todos os CDs somados
2. **Breakdown por CD** — cards individuais por Centro de Distribuição

Cada KPI exibe os valores dos **últimos 4 ciclos** (tendência visual) com indicador de progresso em relação à meta contratual.

### Scope

**In Scope:**
- 5 KPIs derivados de `sp_propostas` + `sp_enderecos` (ver mapeamento abaixo)
- Visão consolidada (empresa) + cards por CD
- Evolução dos **4 últimos ciclos** por KPI (sparkline ou mini-tabela de tendência)
- Indicador visual de meta (barra de progresso) com targets do contrato
- Backend: `GET /api/sp/resultados`
- Frontend: rota `/resultados` + `SpResultados.tsx` + ícone no `AppRail`
- Integração com `navigation.ts` (novo módulo sem sub-abas)

**Out of Scope:**
- Distância física real (substituída por QTACESSO 90d como proxy)
- Integração direta com Winthor
- Exportação de relatório PDF do painel
- Comparação com mais de 4 ciclos
- Cálculo retroativo de ciclos sem dados de `sp_propostas`

## Context for Development

### Codebase Patterns

- Handlers Go seguem o padrão `sp_*.go` em `backend/handlers/`
- Todos os handlers usam `GetSpContext(r)` para multi-tenant isolation
- Filtros por empresa: `WHERE empresa_id = $1` sempre presente
- Frontend: páginas em `frontend/src/pages/Sp*.tsx`, shadcn/ui + Tailwind
- `AppRail` em `frontend/src/components/AppRail.tsx` — adicionar novo módulo
- `navigation.ts` em `frontend/src/lib/navigation.ts` — registrar rota e módulo
- `App.tsx` — adicionar rota e import da nova página

### KPI → Fonte de dados

| KPI | Meta Contratual | Fonte | Cálculo |
|-----|----------------|-------|---------|
| SKUs calibrados corretamente | >70% no 1º ciclo | `sp_propostas` | `COUNT(delta=0) / COUNT(*) × 100` |
| Ofensores de falta A/B | Redução 60–80% em A/B | `sp_propostas` | `COUNT(delta>0 AND classe_venda IN ('A','B'))` |
| Caixas ociosas recuperáveis | Realocação 70%+ | `sp_propostas` | `SUM(ABS(delta)) WHERE delta < 0` |
| Reposições emergenciais | Redução 50–70% | `sp_enderecos` + `sp_propostas` | `SUM(e.qt_acesso_90) WHERE delta > 0` (produtos subcalibrados) |
| Acessos picking total (90d) | Redução 15–30% | `sp_enderecos` | `SUM(qt_acesso_90)` do job (todos os produtos) |

### Lógica dos 4 ciclos

- Ciclo = `sp_csv_jobs` com `status = 'done'`, ordenado por `created_at DESC`
- Para cada CD: pegar os últimos 4 `job_id` distintos
- Para empresa consolidada: pegar os 4 períodos mais recentes de qualquer CD
- Calcular os KPIs para cada um dos 4 jobs → retornar array de 4 valores por KPI

### Files to Reference

| File | Purpose |
|------|---------|
| `backend/handlers/sp_resultados.go` | CRIAR — handler + DTOs |
| `backend/handlers/sp_reincidencia.go` | Padrão de CTE + ROW_NUMBER + JOIN jobs/enderecos |
| `backend/handlers/sp_propostas.go` | Padrão de filtro empresa_id + FILTER(WHERE ...) |
| `backend/handlers/smartpick_auth.go` | SmartPickContext, GetSpContext, withSP |
| `backend/main.go` | Registro de rota: `withSP(handlers.SpResultadosHandler, "gestor_filial")` |
| `frontend/src/pages/SpResultados.tsx` | CRIAR — página principal |
| `frontend/src/components/AppRail.tsx` | `mainItems[]`: adicionar `{ id: 'resultados', icon: TrendingUp, label: 'Resultados', path: '/resultados' }` |
| `frontend/src/lib/navigation.ts` | Adicionar módulo + `if (pathname.startsWith('/resultados')) return 'resultados'` |
| `frontend/src/App.tsx` | `<Route path="/resultados" element={<ProtectedRoute><SpResultados /></ProtectedRoute>} />` |

### Technical Decisions

- **recharts já instalado** (`recharts@^3.7.0`) — usar `AreaChart` para sparkline de 4 ciclos
- **Ciclos por CD**: API retorna array de até 4 ciclos por CD, ordenados do mais recente (ciclo 1) ao mais antigo (ciclo 4)
- **Empresa consolidada**: soma dos valores do ciclo mais recente de cada CD (snapshot atual da empresa)
- **CDs sem motor rodado**: retornam ciclos apenas com `acessos_total` (vem de sp_enderecos); KPIs de proposta ficam zerados
- **Meta contratual**: constantes hardcoded no frontend (não configuráveis por enquanto)
- **Query central**: CTE com `ROW_NUMBER() OVER (PARTITION BY cd_id ORDER BY created_at DESC)` para pegar os últimos 4 jobs por CD
- **JOIN**: `sp_enderecos LEFT JOIN sp_propostas ON p.job_id = e.job_id AND p.endereco_id = e.id` — LEFT JOIN porque propostas podem não existir

### Shape da resposta da API

```go
// CicloKPI — métricas de um job/ciclo
type CicloKPI struct {
    JobID             string  `json:"job_id"`
    CicloNum          int     `json:"ciclo_num"`      // 1=mais recente, 4=mais antigo
    CriadoEm          string  `json:"criado_em"`
    TotalEnderecos    int     `json:"total_enderecos"`
    CalibradosOk      int     `json:"calibrados_ok"`
    PctCalibrados     float64 `json:"pct_calibrados"`  // calibrados_ok/total_enderecos*100
    OfensoresFaltaAB  int     `json:"ofensores_falta_ab"`
    CaixasOciosas     int     `json:"caixas_ociosas"`   // SUM(ABS(delta)) WHERE delta < 0
    CaixasAprovadas   int     `json:"caixas_aprovadas"` // status='aprovada' AND delta < 0
    PctRealocado      float64 `json:"pct_realocado"`    // caixas_aprovadas/caixas_ociosas*100
    AcessosEmergencia int     `json:"acessos_emergencia"` // SUM(qt_acesso_90) WHERE delta > 0
    AcessosTotal      int     `json:"acessos_total"`      // SUM(qt_acesso_90) all
}

// SpResultadosCD — um CD com seus últimos N ciclos
type SpResultadosCD struct {
    CdID       int        `json:"cd_id"`
    CdNome     string     `json:"cd_nome"`
    FilialNome string     `json:"filial_nome"`
    Ciclos     []CicloKPI `json:"ciclos"` // até 4 itens
}

// SpResultadosResponse — response completa
type SpResultadosResponse struct {
    Empresa     *CicloKPI        `json:"empresa"`     // soma ciclos mais recentes de cada CD
    CDs         []SpResultadosCD `json:"cds"`
}
```

### Query SQL central (esboço)

> **Nota F1 (Critical fix):** a query foi reestruturada com CTEs separados para `sp_enderecos` e `sp_propostas` antes de fazer JOIN. O padrão original `LEFT JOIN sp_enderecos → LEFT JOIN sp_propostas` causava row multiplication: um endereco com N propostas faria `SUM(qt_acesso_90)` ser multiplicado N vezes.

```sql
WITH ultimos_jobs AS (
    SELECT j.id AS job_id, j.cd_id, j.created_at,
           cd.nome AS cd_nome, f.nome AS filial_nome,
           ROW_NUMBER() OVER (PARTITION BY j.cd_id ORDER BY j.created_at DESC) AS rn
    FROM smartpick.sp_csv_jobs j
    JOIN smartpick.sp_centros_dist cd ON cd.id = j.cd_id
    JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
    WHERE j.empresa_id = $1 AND j.status = 'done'
    -- [se cd_id fornecido: AND j.cd_id = $2]
),
jobs_top4 AS (SELECT * FROM ultimos_jobs WHERE rn <= 4),
-- Agrega enderecos separadamente (sem JOIN com propostas → sem multiplicação)
end_agg AS (
    SELECT e.job_id,
           COUNT(*)                                AS total_enderecos,
           COALESCE(SUM(e.qt_acesso_90), 0)        AS acessos_total
    FROM smartpick.sp_enderecos e
    WHERE e.job_id IN (SELECT job_id FROM jobs_top4)
    GROUP BY e.job_id
),
-- Agrega enderecos com pelo menos 1 proposta delta>0 (subcalibrados)
emerg_agg AS (
    SELECT e.job_id,
           COALESCE(SUM(e.qt_acesso_90), 0) AS acessos_emergencia
    FROM smartpick.sp_enderecos e
    WHERE e.job_id IN (SELECT job_id FROM jobs_top4)
      AND EXISTS (
          SELECT 1 FROM smartpick.sp_propostas p
          WHERE p.job_id = e.job_id AND p.endereco_id = e.id AND p.delta > 0
      )
    GROUP BY e.job_id
),
-- Agrega propostas separadamente
prop_agg AS (
    SELECT p.job_id,
           COUNT(*) FILTER (WHERE p.delta = 0)                                           AS calibrados_ok,
           COUNT(*) FILTER (WHERE p.delta > 0 AND p.classe_venda IN ('A','B'))            AS ofensores_falta_ab,
           COALESCE(SUM(ABS(p.delta)) FILTER (WHERE p.delta < 0), 0)                      AS caixas_ociosas,
           COALESCE(SUM(ABS(p.delta)) FILTER (WHERE p.delta < 0 AND p.status='aprovada'), 0) AS caixas_aprovadas
    FROM smartpick.sp_propostas p
    WHERE p.job_id IN (SELECT job_id FROM jobs_top4)
    GROUP BY p.job_id
)
SELECT
    jt.cd_id, jt.cd_nome, jt.filial_nome,
    jt.job_id::text,
    TO_CHAR(jt.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
    jt.rn AS ciclo_num,
    COALESCE(ea.total_enderecos,    0) AS total_enderecos,
    COALESCE(pa.calibrados_ok,      0) AS calibrados_ok,
    COALESCE(pa.ofensores_falta_ab, 0) AS ofensores_falta_ab,
    COALESCE(pa.caixas_ociosas,     0) AS caixas_ociosas,
    COALESCE(pa.caixas_aprovadas,   0) AS caixas_aprovadas,
    COALESCE(em.acessos_emergencia, 0) AS acessos_emergencia,
    COALESCE(ea.acessos_total,      0) AS acessos_total
FROM jobs_top4 jt
LEFT JOIN end_agg  ea ON ea.job_id = jt.job_id
LEFT JOIN emerg_agg em ON em.job_id = jt.job_id
LEFT JOIN prop_agg pa ON pa.job_id = jt.job_id
ORDER BY cd_id, ciclo_num;
```

> **Índice recomendado (F10):** Se a tabela `sp_csv_jobs` crescer muito, criar `CREATE INDEX idx_sp_csv_jobs_empresa_status_cd ON smartpick.sp_csv_jobs(empresa_id, status, cd_id, created_at DESC)` para acelerar o CTE `ultimos_jobs`.

## Implementation Plan

### Tasks

**Ordem obrigatória: backend primeiro (define o contrato da API), depois frontend.**

---

- [ ] **Task 1: Criar `backend/handlers/sp_resultados.go`**
  - File: `backend/handlers/sp_resultados.go` (novo)
  - Action: Criar DTOs e handler completo.

  **DTOs a declarar:**
  ```go
  type CicloKPI struct {
      JobID             string  `json:"job_id"`
      CicloNum          int     `json:"ciclo_num"`          // 1=mais recente
      CriadoEm          string  `json:"criado_em"`
      TotalEnderecos    int     `json:"total_enderecos"`
      CalibradosOk      int     `json:"calibrados_ok"`
      PctCalibrados     float64 `json:"pct_calibrados"`     // calculado em Go
      OfensoresFaltaAB  int     `json:"ofensores_falta_ab"`
      CaixasOciosas     int     `json:"caixas_ociosas"`
      CaixasAprovadas   int     `json:"caixas_aprovadas"`
      PctRealocado      float64 `json:"pct_realocado"`      // calculado em Go
      AcessosEmergencia int     `json:"acessos_emergencia"`
      AcessosTotal      int     `json:"acessos_total"`
  }
  type SpResultadosCD struct {
      CdID       int        `json:"cd_id"`
      CdNome     string     `json:"cd_nome"`
      FilialNome string     `json:"filial_nome"`
      Ciclos     []CicloKPI `json:"ciclos"` // 1..4 itens, índice 0 = mais recente
  }
  type SpResultadosResponse struct {
      Empresa *CicloKPI        `json:"empresa"`  // soma dos ciclos mais recentes de cada CD
      CDs     []SpResultadosCD `json:"cds"`
  }
  ```

  **Handler `SpResultadosHandler`:**
  - `GET /api/sp/resultados?cd_id=X` — cd_id opcional
  - Chamar `GetSpContext(r)` para obter `spCtx.EmpresaID`
  - **Validar cd_id (F5):** se `cd_id` fornecido:
    - `cdID, err := strconv.Atoi(r.URL.Query().Get("cd_id"))` → se erro: `http.Error(w, "cd_id inválido", 400); return`
    - Verificar ownership: `SELECT 1 FROM smartpick.sp_centros_dist WHERE id = $1 AND empresa_id = $2` → se não encontrado: `http.Error(w, "não encontrado", 404); return`
  - Executar CTE (ver query abaixo)
  - Iterar rows; agrupar por cd_id em `map[int]*SpResultadosCD`
  - Calcular `PctCalibrados`: se `total_enderecos > 0` → `float64(calibrados_ok)/float64(total_enderecos)*100` else `0`
  - Calcular `PctRealocado`: se `caixas_ociosas > 0` → `float64(caixas_aprovadas)/float64(caixas_ociosas)*100` else `0`
  - **Calcular `empresa` (F2 — fórmula explícita):**
    - Iterar CDs; para cada CD pegar `Ciclos[0]` (mais recente)
    - Campos int (absolutos): **somar** diretamente: `TotalEnderecos`, `CalibradosOk`, `OfensoresFaltaAB`, `CaixasOciosas`, `CaixasAprovadas`, `AcessosEmergencia`, `AcessosTotal`
    - Campos float (percentuais): **média ponderada por `TotalEnderecos`**:
      ```go
      // PctCalibrados da empresa = soma(calibrados_ok de cada CD) / soma(total_enderecos de cada CD) * 100
      emp.PctCalibrados = safe_div(float64(emp.CalibradosOk), float64(emp.TotalEnderecos)) * 100
      emp.PctRealocado  = safe_div(float64(emp.CaixasAprovadas), float64(emp.CaixasOciosas)) * 100
      // safe_div: retorna 0 se denominador == 0
      ```
    - Se nenhum CD tem ciclos (empresa sem dados): `Empresa = nil`
  - Retornar JSON `SpResultadosResponse`

  **Query SQL CTE completa (F1 fix — CTEs separados, sem JOIN multiplication):**
  ```sql
  WITH ultimos_jobs AS (
      SELECT j.id AS job_id, j.cd_id, j.created_at,
             cd.nome AS cd_nome, f.nome AS filial_nome,
             ROW_NUMBER() OVER (PARTITION BY j.cd_id ORDER BY j.created_at DESC) AS rn
      FROM smartpick.sp_csv_jobs j
      JOIN smartpick.sp_centros_dist cd ON cd.id = j.cd_id
      JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
      WHERE j.empresa_id = $1 AND j.status = 'done'
      -- [se cd_id fornecido: AND j.cd_id = $2]
  ),
  jobs_top4 AS (SELECT * FROM ultimos_jobs WHERE rn <= 4),
  end_agg AS (
      SELECT e.job_id,
             COUNT(*)                          AS total_enderecos,
             COALESCE(SUM(e.qt_acesso_90), 0)  AS acessos_total
      FROM smartpick.sp_enderecos e
      WHERE e.job_id IN (SELECT job_id FROM jobs_top4)
      GROUP BY e.job_id
  ),
  emerg_agg AS (
      SELECT e.job_id,
             COALESCE(SUM(e.qt_acesso_90), 0) AS acessos_emergencia
      FROM smartpick.sp_enderecos e
      WHERE e.job_id IN (SELECT job_id FROM jobs_top4)
        AND EXISTS (
            SELECT 1 FROM smartpick.sp_propostas p
            WHERE p.job_id = e.job_id AND p.endereco_id = e.id AND p.delta > 0
        )
      GROUP BY e.job_id
  ),
  prop_agg AS (
      -- delta é GENERATED ALWAYS STORED: não inserir manualmente
      SELECT p.job_id,
             COUNT(*) FILTER (WHERE p.delta = 0)                                              AS calibrados_ok,
             COUNT(*) FILTER (WHERE p.delta > 0 AND p.classe_venda IN ('A','B'))               AS ofensores_falta_ab,
             COALESCE(SUM(ABS(p.delta)) FILTER (WHERE p.delta < 0), 0)                         AS caixas_ociosas,
             COALESCE(SUM(ABS(p.delta)) FILTER (WHERE p.delta < 0 AND p.status='aprovada'), 0) AS caixas_aprovadas
      FROM smartpick.sp_propostas p
      WHERE p.job_id IN (SELECT job_id FROM jobs_top4)
      GROUP BY p.job_id
  )
  SELECT
      jt.cd_id, jt.cd_nome, jt.filial_nome,
      jt.job_id::text,
      TO_CHAR(jt.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
      jt.rn AS ciclo_num,
      COALESCE(ea.total_enderecos,    0) AS total_enderecos,
      COALESCE(pa.calibrados_ok,      0) AS calibrados_ok,
      COALESCE(pa.ofensores_falta_ab, 0) AS ofensores_falta_ab,
      COALESCE(pa.caixas_ociosas,     0) AS caixas_ociosas,
      COALESCE(pa.caixas_aprovadas,   0) AS caixas_aprovadas,
      COALESCE(em.acessos_emergencia, 0) AS acessos_emergencia,
      COALESCE(ea.acessos_total,      0) AS acessos_total
  FROM jobs_top4 jt
  LEFT JOIN end_agg   ea ON ea.job_id = jt.job_id
  LEFT JOIN emerg_agg em ON em.job_id = jt.job_id
  LEFT JOIN prop_agg  pa ON pa.job_id = jt.job_id
  ORDER BY cd_id, ciclo_num
  ```
  - Quando `cd_id` é fornecido: adicionar `AND j.cd_id = $2` no WHERE do CTE `ultimos_jobs` e passar como argumento extra.
  - **Scan Go para `acessos_total`/`acessos_emergencia`** (F7): usar `sql.NullInt64` ou garantir `COALESCE` (já presente na query). Exemplo: `var acessosTotal int64; rows.Scan(..., &acessosTotal)` — com COALESCE na query, scan direto em `int` é seguro.

---

- [ ] **Task 2: Registrar rota em `backend/main.go`**
  - File: `backend/main.go`
  - Action: Adicionar após a linha `http.HandleFunc("/api/sp/reincidencia", ...)`
  ```go
  // ── SmartPick — Painel de Resultados (Epic 9) ─────────────────────────────
  http.HandleFunc("/api/sp/resultados", withSP(handlers.SpResultadosHandler, "gestor_filial"))
  ```

---

- [ ] **Task 3: Criar `frontend/src/pages/SpResultados.tsx`**
  - File: `frontend/src/pages/SpResultados.tsx` (novo)
  - Action: Criar página com os seguintes blocos:

  **Constantes de meta contratual (topo do arquivo):**
  ```typescript
  const METAS = {
    pct_calibrados: 70,          // >70% SKUs calibrados
    reducao_ofensores_ab: 60,    // 60-80% redução
    pct_realocado: 70,           // 70%+ realocação
    reducao_acessos_emergencia: 50, // 50-70% redução
    reducao_acessos_total: 15,   // 15-30% redução
  }
  ```

  **Interface TypeScript (espelha DTOs Go):**
  ```typescript
  interface CicloKPI {
    job_id: string; ciclo_num: number; criado_em: string
    total_enderecos: number; calibrados_ok: number; pct_calibrados: number
    ofensores_falta_ab: number; caixas_ociosas: number
    caixas_aprovadas: number; pct_realocado: number
    acessos_emergencia: number; acessos_total: number
  }
  interface SpResultadosCD {
    cd_id: number; cd_nome: string; filial_nome: string
    ciclos: CicloKPI[]
  }
  interface SpResultadosResponse { empresa: CicloKPI | null; cds: SpResultadosCD[] }
  ```

  **Estado + fetch:**
  ```typescript
  const [data, setData] = useState<SpResultadosResponse | null>(null)
  const [cdID, setCdID] = useState<string>('')   // '' = todos
  const [loading, setLoading] = useState(true)
  // useEffect: fetch /api/sp/resultados?cd_id=X ao montar e quando cdID muda
  ```

  **Layout da página:**
  1. **Header row**: título "Painel de Resultados" + Select de CD (opções: "Todos os CDs" + lista de CDs do `data.cds`)
  2. **Seção Empresa Consolidada** (visível quando cdID === ''):
     - 5 cards em grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`)
     - Cada card: título do KPI, valor atual em destaque, barra de progresso (`Progress` do shadcn), label da meta
  3. **Seção "Por Centro de Distribuição"** (sempre visível):
     - Grid de cards por CD (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`)
     - Cada card de CD: nome do CD + filial + 5 mini-KPIs com sparkline de 4 ciclos (`recharts AreaChart` width=120 height=40 no `ResponsiveContainer`)

  **Lógica de redução** (para KPIs 2, 4, 5):
  ```typescript
  // Calculado no frontend a partir do array ciclos[]
  // ciclos[0] = mais recente (ciclo_num=1), ciclos[ciclos.length-1] = mais antigo
  function calcReducao(ciclos: CicloKPI[], campo: keyof CicloKPI): number | null {
    if (ciclos.length < 2) return null
    const base = ciclos[ciclos.length - 1][campo] as number
    const atual = ciclos[0][campo] as number
    if (base === 0) return null
    return ((base - atual) / base) * 100
    // Resultado positivo = melhora (reduziu). Resultado negativo = piora (aumentou).
  }
  ```

  **Exibição de redução negativa (F3):**
  - Resultado ≥ 0: exibir em verde com "▼ X%" (reduziu — bom)
  - Resultado < 0: exibir em vermelho com "▲ X%" (aumentou — ruim), usando `Math.abs(valor)`
  - Exemplo de helper:
  ```typescript
  function renderReducao(pct: number | null) {
    if (pct === null) return <span className="text-muted-foreground text-xs">—</span>
    const abs = Math.abs(pct).toFixed(1)
    return pct >= 0
      ? <span className="text-green-600 text-xs">▼ {abs}%</span>
      : <span className="text-red-600 text-xs">▲ {abs}%</span>
  }
  ```

  **Sparkline — transformação de dados (F6):**
  A API retorna `ciclos` com `ciclo_num=1` (mais recente) primeiro. Recharts `AreaChart` precisa de dados em ordem cronológica (esquerda = mais antigo). Reverter antes de passar ao chart:
  ```typescript
  // ciclos já vem ordenado ciclo_num=1..4 (mais recente primeiro)
  const sparkData = [...cd.ciclos].reverse().map(c => ({
    ciclo: `C${c.ciclo_num}`, // rótulo: C4=mais antigo, C1=mais recente
    value: c.acessos_total,
  }))
  // Para sparkline mínimo (sem eixos):
  // <AreaChart width={120} height={40} data={sparkData}>
  //   <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#e0e7ff" strokeWidth={1.5} dot={false} />
  // </AreaChart>
  ```

  **Componente `KpiCard`** (inline na mesma página):
  ```tsx
  // Props: título, valor, unidade, meta, metaLabel, progresso (0-100), trend (array de numbers para sparkline)
  ```

---

- [ ] **Task 4: Adicionar módulo em `frontend/src/components/AppRail.tsx`**
  - File: `frontend/src/components/AppRail.tsx`
  - Action 1: Adicionar `TrendingUp` ao import de lucide-react
  - Action 2: Adicionar entrada no array `mainItems` após `reincidencia`:
  ```typescript
  { id: 'resultados', icon: TrendingUp, label: 'Resultados', path: '/resultados' },
  ```

---

- [ ] **Task 5: Registrar módulo em `frontend/src/lib/navigation.ts`**
  - File: `frontend/src/lib/navigation.ts`
  - Action 1: Adicionar antes do módulo `gestao`:
  ```typescript
  resultados: {
    label: 'Painel de Resultados',
    tabs: [
      { label: 'Resultados Contratuais', path: '/resultados' },
    ],
  },
  ```
  - Action 2: Adicionar caso na função `getActiveModule`:
  ```typescript
  if (pathname.startsWith('/resultados')) return 'resultados'
  ```
  (inserir após o bloco `reincidencia`)

---

- [ ] **Task 6: Registrar rota em `frontend/src/App.tsx`**
  - File: `frontend/src/App.tsx`
  - Action 1: Adicionar import:
  ```typescript
  import SpResultados from './pages/SpResultados'
  ```
  - Action 2: Adicionar rota após a rota `/reincidencia`:
  ```tsx
  <Route path="/resultados" element={<ProtectedRoute><SpResultados /></ProtectedRoute>} />
  ```

---

### Acceptance Criteria

- [ ] **AC 1 — Happy path:** Dado que a empresa tem pelo menos 2 CDs com 4 jobs `done` e motor rodado, quando o usuário acessa `/resultados`, então a página exibe 5 cards consolidados e um card por CD, cada um com sparkline de 4 pontos.

- [ ] **AC 2 — Menos de 4 ciclos:** Dado que um CD tem apenas 2 jobs `done`, quando os dados são carregados, então o sparkline desse CD exibe 2 pontos (sem erro) e os demais campos mostram valores válidos.

- [ ] **AC 3 — Motor não rodado:** Dado que um CD tem jobs `done` mas o motor nunca foi executado (sem `sp_propostas`), quando os dados são carregados, então `calibrados_ok`, `ofensores_falta_ab`, `caixas_ociosas` e `acessos_emergencia` exibem `0` (não quebram), e `acessos_total` exibe o valor correto de `sp_enderecos.qt_acesso_90`.

- [ ] **AC 4 — Filtro por CD:** Dado que o usuário seleciona um CD específico no select, quando a seleção muda, então a seção "Empresa Consolidada" é ocultada e somente o card do CD selecionado é exibido com os 4 ciclos.

- [ ] **AC 5 — Cálculo de redução:** Dado que um CD tem 4 ciclos com valores de `ofensores_falta_ab` decrescentes, quando a página calcula a redução, então o percentual mostrado é `(base - atual) / base × 100` usando ciclo mais antigo como base.

- [ ] **AC 6 — Meta contratual visual:** Dado qualquer estado de dados, quando a página é exibida, então cada KPI card mostra a meta contratual como label (ex: "Meta: >70%") e a barra de progresso reflete o valor atual relativo à meta.

- [ ] **AC 7 — Sem dados:** Dado que a empresa não tem nenhum job `done`, quando o usuário acessa a página, então é exibida uma mensagem "Nenhum dado disponível. Importe e processe um CSV para ver os resultados." sem erro no console.

- [ ] **AC 8 — Multi-tenant:** Dado que dois tenants distintos acessam a API, então cada um recebe apenas os dados da sua própria empresa (filtro `empresa_id` aplicado na query).

- [ ] **AC 9 — Ícone no AppRail:** Dado que o usuário está em qualquer rota, quando clica no ícone `TrendingUp` no AppRail, então navega para `/resultados` e o ícone fica destacado (estado ativo).

- [ ] **AC 10 — empresa null (F4):** Dado que a empresa não tem nenhum CD com ciclos, quando a API retorna `{ "empresa": null, "cds": [] }`, então a seção "Empresa Consolidada" exibe a mensagem "Nenhum dado disponível" sem erro de runtime (sem TypeError ao acessar propriedades de null).

- [ ] **AC 11 — ciclos[] vazio (F4):** Dado que um CD retorna com `ciclos: []` (ex: todos os jobs estão em status diferente de `done`), então o card desse CD exibe "—" em todos os KPIs e o sparkline não é renderizado (sem erro no recharts ao receber array vazio).

- [ ] **AC 12 — KPIs de redução não exibidos no consolidado (F9):** Dado que o usuário visualiza a seção "Empresa Consolidada", então os KPIs de redução percentual (ofensores A/B, acessos emergência, acessos total) exibem apenas o valor absoluto somado — não uma % de redução — pois a comparação cross-CD não tem baseline comum. A % de redução aparece apenas nos cards por CD.

## Additional Context

### Dependencies

- **recharts@^3.7.0** — já instalado, sem ação necessária
- **shadcn/ui `Progress`** — verificar se o componente está disponível em `frontend/src/components/ui/progress.tsx`; se não, instalar com `npx shadcn@latest add progress`
- Nenhuma nova migration necessária

### Testing Strategy

**Manual (obrigatório antes de merge):**
1. Fazer login com usuário `gestor_filial` → confirmar que a rota `/resultados` é acessível e retorna dados
2. Fazer login com `somente_leitura` → confirmar que `/api/sp/resultados` retorna 403
3. Testar com empresa sem nenhum job → verificar mensagem "sem dados"
4. Testar com empresa com 1, 2, 3 e 4 ciclos → verificar sparkline variável
5. Selecionar um CD específico no filtro → verificar que empresa consolidada some e apenas aquele CD aparece

**Query SQL (validação manual):**
- Executar query CTE diretamente no PostgreSQL para um job real e confirmar que os valores batem com o `sp_propostas/resumo` endpoint

### Notes

- **KPI Reposições emergenciais** (`acessos_emergencia`): usa `qt_acesso_90` de produtos com `delta > 0` como proxy. O dado real de redução só existiria após re-exportação do Winthor com a nova capacidade aplicada. Documentar isso visualmente no card (ex: tooltip "Proxy: acesso aos produtos subcalibrados no período").
- **KPI Redução de Acessos total** (KPI 5): a comparação entre ciclos só é estatisticamente válida se os mesmos produtos estiverem nos 4 exports. Variações podem ser por sazonalidade ou mix de produtos.
- **Empresa Consolidada** para KPIs de redução: não tem significado agregado (bases são diferentes por CD), por isso os cards consolidados mostram apenas o valor absoluto do ciclo mais recente + a soma; a % de redução é mostrada apenas no drill-down por CD.
- **Futuro (out of scope)**: exportar painel em PDF para apresentação ao cliente; configurar metas por empresa em vez de hardcoded.
