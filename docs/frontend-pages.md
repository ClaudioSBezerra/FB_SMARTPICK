# Frontend — Páginas e Componentes

> React 18 + TypeScript + Vite + Tailwind + shadcn/ui  
> Roteamento: React Router v6 (BrowserRouter)

---

## Estrutura de Layout

```
AppLayout
├── AppRail              ← barra lateral de ícones de módulo
├── AppHeader            ← cabeçalho com nome do módulo + CompanySwitcher
├── ModuleTabs           ← abas de sub-navegação (por módulo ativo)
└── <main>
     └── <Routes>        ← renderiza a página ativa
```

### AppRail (componente)

Barra lateral com ícones de módulo. Clica → navega para a rota raiz do módulo.

| Ícone | Módulo | Rota | Restrição |
|-------|--------|------|-----------|
| BarChart3 | Dashboard | `/dashboard/urgencia/falta` | todos |
| Upload | Importar CSV | `/upload/csv` | todos |
| FileText | Histórico | `/historico` | todos |
| RefreshCw | Reincidência | `/reincidencia` | todos |
| TrendingUp | Resultados | `/resultados` | todos |
| FileDown | Gerar PDF | `/pdf/gerar` | todos |
| Building2 | Gestão | `/gestao/filiais` | gestor_geral+ |
| Settings | Configurações | `/config/planos` | admin_fbtax |

### ModuleTabs

Barra de abas renderizada abaixo do header, derivada de `navigation.ts`.

| Módulo | Abas |
|--------|------|
| Dashboard | Ampliar Slot (falta) \| Reduzir Slot (espaço) \| Já Calibrados \| Curva A Revisar |
| Upload | Importar CSV \| Log de Importações |
| Histórico | Ciclos \| Compliance |
| Gestão | Filiais e CDs \| Regras de Calibragem |
| Configurações | Plano e Limites \| Ambiente \| Usuários \| Manutenção |

---

## Páginas

### `SpDashboard.tsx` — Dashboard de Urgência

**Rotas:** `/dashboard/urgencia/falta`, `/dashboard/urgencia/espaco`

**Abas (Tabs do shadcn):**
- `falta` → propostas com `delta > 0` — controlada pela URL (`/falta`)
- `espaco` → propostas com `delta < 0` — controlada pela URL (`/espaco`)
- `calibrado` → `delta = 0`, não Curva A mantida — local state
- `curva_a` → Curva A mantida — local state

**Padrão de controle das abas (híbrido):**
```typescript
const urlTab = location.pathname.endsWith('/espaco') ? 'espaco' : 'falta'
const [activeTab, setActiveTab] = useState<string>(urlTab)
useEffect(() => { setActiveTab(urlTab) }, [urlTab])

<Tabs value={activeTab} onValueChange={v => {
  setActiveTab(v)
  if (v === 'falta' || v === 'espaco') navigate(`/dashboard/urgencia/${v}`)
}}>
```

**Filtros no topo:** Selects de CD e Job; botão "Executar Motor"; botão "Aprovar Tudo".

**PropostasTable (sub-componente inline):**
- Filtros locais: departamento (select), seção (select cascadeado por departamento), endereço (text search)
- Contador "X de Y registros"
- Colunas: Endereço | Depto | Seção | Curva | Cód. | Produto | Cap.Atual | Sugestão | Delta | Ações
- Fonte `text-[11px]` para caber na linha
- Ações: editar sugestão inline, aprovar, rejeitar

---

### `SpUploadCSV.tsx` — Upload e Log

**Rotas:** `/upload/csv`, `/upload/log`

**Aba Upload:**
- Select de Filial e CD
- Drag-and-drop ou browse de arquivo `.csv`/`.txt`
- Exibe resultado do upload (sucesso/erro/duplicata)
- Botão "Executar Motor" aparece quando job fica `done`

**Aba Log:**
- Lista de jobs com status colorido (badge)
- Filtro por CD: `<Select value={cdID || 'all'}>` com `<SelectItem value="all">`
- Polling automático para jobs em processamento

---

### `SpAmbiente.tsx` — Gestão de Ambiente

Renderiza seções diferentes baseado na rota ativa:

| Rota | Seção `isFiliais` | `isRegras` | `isPlanos` | `isManutencao` |
|------|-------------------|------------|------------|----------------|
| `/gestao/filiais` | ✓ | | | |
| `/gestao/regras` | | ✓ | | |
| `/config/planos` | | | ✓ | |
| `/config/manutencao` | | | | ✓ |

**isFiliais:** CRUD de Filiais (lista/cria/edita/remove) e CDs por filial. Botão de duplicar CD.

**isRegras:** Tabela de CDs com parâmetros do motor (edita inline). Painel de ajuda colapsável com:
- Fórmula visual com legenda
- Simulador interativo (8 inputs → cálculo passo a passo ao vivo)
- Prioridade das fontes de dados do CSV

**isPlanos:** Plano atual da empresa (uso vs limites).

**isManutencao:** Botão "Limpar Calibragem" (admin_fbtax) e "Purgar CSVs antigos".

---

### `SpUsuarios.tsx` — Gestão de Usuários

**Rota:** `/config/usuarios`

- Lista usuários da empresa com sp_role e filiais vinculadas
- Criar usuário (modal) com campos: nome, e-mail, senha, perfil, trial_ends_at, filiais
- Editar: atualiza sp_role, nome, hierarquia (ambiente + empresa)
- Vincular filiais por usuário (modal com checkboxes)
- Suporte a vínculos multi-empresa

---

### `SpGerarPDF.tsx` — Geração de PDF

**Rota:** `/pdf/gerar`

- Selects de Filial, CD e Job
- Botão "Baixar PDF" → chama `GET /api/sp/pdf/calibracao?job_id=...`
- Exibe contagem de propostas aprovadas disponíveis para o job selecionado

---

### `SpHistorico.tsx` — Histórico e Compliance

**Rotas:** `/historico`, `/historico/compliance`

**Aba Ciclos:** Lista de ciclos por CD com contagens (aprovadas/rejeitadas/pendentes), distribuição por curva, executor e data. Botão "Fechar Ciclo" para ciclos em_andamento.

**Aba Compliance:** Cards por CD com badge colorido (`ok` verde | `atencao` amarelo | `critico` vermelho | etc.). Mostra dias desde última calibragem, propostas pendentes, último gestor.

---

### `SpResultados.tsx` — Painel de Resultados Contratuais

**Rota:** `/resultados`

- Select de CD no topo ("Todos os CDs" ou CD específico)
- Quando "Todos os CDs": exibe seção **Empresa Consolidada** (5 cards em grid `lg:grid-cols-5`) + grid de cards por CD
- Quando CD selecionado: exibe apenas o card daquele CD (consolidado oculto)
- Cada card exibe: valor atual, barra de progresso relativa à meta, sparkline de 4 ciclos (`recharts AreaChart`)
- KPIs com cálculo de redução (ofensores A/B, acessos emergência, acessos total) mostram `▼ X%` verde ou `▲ X%` vermelho
- Estado vazio: mensagem "Nenhum dado disponível..." sem crash

**5 KPIs exibidos:**

| KPI | Meta | Campo |
|-----|------|-------|
| SKUs calibrados (%) | >70% | `pct_calibrados` |
| Ofensores falta A/B | Redução ≥60% | `ofensores_falta_ab` |
| Caixas ociosas realocadas (%) | ≥70% | `pct_realocado` |
| Acessos emergenciais (90d) | Redução ≥50% | `acessos_emergencia` |
| Acessos picking total (90d) | Redução ≥15% | `acessos_total` |

**Notas:**
- Empresa consolidada: % de redução **não** exibida (bases distintas por CD)
- Sparkline usa `[...ciclos].reverse()` para ordem cronológica (mais antigo → mais recente)

---

### `SpReincidencia.tsx` — Dashboard de Reincidência

**Rota:** `/reincidencia`

- Filtros: CD e min_ciclos (padrão 2)
- Tabela: produto, endereço (rua-predio-apto), curva, capacidade atual, última sugestão, último delta, N ciclos, datas primeiro/último ciclo

---

## Contextos

### `AuthContext`
Armazena: `user` (id, email, full_name, role, sp_role, trial_ends_at), `company` (nome da empresa ativa), `token` (JWT), `isAuthenticated`, `loading`.

Métodos: `login()`, `logout()`, `switchCompany()`.

### `FilialContext`
Disponível dentro de `AppLayout`. Carrega lista de filiais acessíveis ao usuário autenticado para popular selects de filial nas páginas.

---

## Componentes utilitários

### `CompanySwitcher`
Dropdown para trocar a empresa ativa. Disponível no AppHeader e no footer do AppSidebar (quando presente). Prop `compact` reduz tamanho.

### `AppSidebar` (não usado no SmartPick — legado FB_APU02)
Sidebar com menus colapsáveis do FB_APU02. **Não renderizado no AppLayout do SmartPick.** O SmartPick usa `AppRail` + `ModuleTabs`.

---

## Navegação (`src/lib/navigation.ts`)

Define a estrutura de módulos e abas usada por `AppRail` e `ModuleTabs`.

```typescript
const modules = {
  dashboard: { label, icon, tabs: [{path, label}, ...] },
  upload: { ... },
  historico: { ... },
  reincidencia: { ... },
  pdf: { ... },
  gestao: { adminOnly: false, tabs: [...] },
  config: { adminOnly: true, tabs: [...] },
}
```

`getActiveModule(pathname)` mapeia a rota atual para o módulo correspondente.
