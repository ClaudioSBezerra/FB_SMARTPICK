# Story v1.8.0: Indicadores de Calibragem, Paginação, Export Excel, RBAC MASTER e Audit Log

Status: done

<!-- Pseudo-story retrospectiva criada para review adversarial dos commits db1b42a → 966f368 (tag v1.8.0).
     As mudanças originais foram pedidos ad-hoc do usuário, não uma story BMAD formal. -->

## Story

Como **gestor MASTER do SmartPick**,
quero **indicadores automáticos de saúde da calibragem, paginação na tabela de propostas, exportação Excel dos dados filtrados, e um log de auditoria restrito ao grupo MASTER**,
para que eu possa **analisar rapidamente problemas de capacidade/giro, compartilhar recortes filtrados com stakeholders, e rastrear ações sensíveis (limpeza de dados, cadastro/exclusão de usuários)**.

## Acceptance Criteria

### Painel de Calibração — Indicadores
1. Três novas colunas com badges aparecem ao lado da coluna **Status** na tabela de propostas: **GiroCap.**, **GPRepos.** e **CMEN2DDV**.
2. Fórmula **GiroCap.**: `med_venda_cx >= capacidade_atual` → "Urgencia" (badge vermelho); senão "OK" (badge verde).
3. Fórmula **GPRepos.**: `ponto_reposicao <= med_venda_cx` → "Ajustar" (badge laranja); senão "OK" (badge verde).
4. Fórmula **CMEN2DDV**: `GiroCap == "OK"` **AND** `med_venda_cx / capacidade_atual > 0.5` → "CAP Menor" (badge amarelo); senão "OK" (badge verde).
5. Três dropdowns de filtro (com label ao lado) permitem filtrar por valor dos indicadores: Todos / OK / valor-de-alerta.
6. Coluna **Méd.Vda** (MED_VENDA_DIAS_CX) aparece ao lado de Giro/dia com 1 casa decimal.
7. Indicadores e filtros funcionam nas abas "Ampliar Slot" e "Reduzir Slot".

### Painel de Calibração — Paginação
8. Tabela de propostas pagina 100 itens por página (não carrega milhares de linhas no DOM).
9. Rodapé da tabela mostra "X–Y de Z" (com "filtrados de N" quando filtros ativos) e navegação `<<` / `<` / [números] / `>` / `>>`, além de "Pág. N/total".
10. Ao mudar qualquer filtro ou quando os dados são recarregados, a página volta automaticamente para 1.

### Painel de Calibração — Export Excel
11. Botão "Exportar Excel" na barra de filtros exporta **todas as linhas filtradas** (não apenas a página atual) em `.xlsx`.
12. Arquivo gerado contém as colunas visíveis + indicadores, com nome `calibragem_YYYY-MM-DD.xlsx`.
13. Toast de sucesso informa quantas linhas foram exportadas; botão fica desabilitado se não há linhas.

### Painel de Calibração — Performance
14. Troca entre abas "Ampliar Slot" e "Reduzir Slot" usa cache do React Query (staleTime 60s) — sem refetch imediato.
15. `calcIndicadores` e lista filtrada são memoizados (não recalculam a cada render).

### RBAC — visibilidade MASTER
16. Usuários **admin** que NÃO pertencem ao grupo `MASTER` (ex.: Keslley) **não veem** os itens "Gestão de Usuários", "Limpar Dados" e "Log de Auditoria" — nem na sidebar, nem nas tabs do módulo Configurações.
17. Tentativa de acessar `/config/usuarios`, `/config/audit-log` por URL direta redireciona para `/` se o usuário não for do grupo MASTER.
18. Usuários do grupo MASTER veem todos os itens MASTER-only normalmente.

### Audit Log
19. Endpoint `GET /api/sp/admin/audit-log` retorna registros do `sp_audit_log` da empresa ativa, apenas para `admin_fbtax`.
20. Endpoint `DELETE /api/sp/usuarios/{id}` exclui usuário (cascata em `user_environments` e `sp_user_filiais`), não permite autoexclusão.
21. As seguintes ações gravam em `sp_audit_log`:
    - `limpar_dados` (ao executar `DELETE /api/sp/admin/limpar-calibragem`)
    - `criar_usuario` (ao executar `POST /api/sp/usuarios`)
    - `excluir_usuario` (ao executar `DELETE /api/sp/usuarios/{id}`)
22. Página `/config/audit-log` lista os registros em tabela com Data/Hora, Usuário (nome + email), Ação (badge colorido) e Detalhes (resumo do payload).

## Tasks / Subtasks

### Backend
- [x] **T1** Adicionar `med_venda_cx` e `ponto_reposicao` ao `PropostaResponse` e à query SQL (AC: 1, 2, 3, 4, 6)
  - [x] 1.1 Novos campos no DTO
  - [x] 1.2 Expandir SELECT com `e.med_venda_cx, e.ponto_reposicao`
  - [x] 1.3 Expandir `rows.Scan(...)`
- [x] **T2** Criar `sp_audit.go` com helper `writeAuditLog()` e handler `SpAuditLogHandler` (AC: 19, 22)
- [x] **T3** Integrar `writeAuditLog()` em `SpLimparCalibragemHandler` (AC: 21)
- [x] **T4** Integrar `writeAuditLog()` em `SpCriarUsuarioHandler` (AC: 21)
- [x] **T5** Criar `SpDeletarUsuarioHandler` com audit log e proteção de autoexclusão (AC: 20, 21)
- [x] **T6** Registrar rotas em `main.go`: `DELETE /api/sp/usuarios/{id}` e `GET /api/sp/admin/audit-log`

### Frontend — Indicadores
- [x] **T7** Adicionar campos `med_venda_cx` e `ponto_reposicao` à interface `Proposta` (AC: 1)
- [x] **T8** Criar `calcIndicadores()` com as 3 fórmulas (AC: 2, 3, 4)
- [x] **T9** Criar `IndicadorBadge` com mapa de cores por valor (AC: 1)
- [x] **T10** Adicionar 3 colunas ao header e body da tabela (AC: 1)
- [x] **T11** Adicionar 3 dropdowns de filtro com labels (AC: 5)
- [x] **T12** Adicionar coluna `Méd.Vda` ao lado de Giro/dia (AC: 6)

### Frontend — Paginação e Performance
- [x] **T13** Adicionar state `page` com `PAGE_SIZE = 100` e `useMemo` para lista paginada (AC: 8, 15)
- [x] **T14** Rodapé com "X–Y de Z", botões de navegação first/prev/numbers/next/last e indicador Pág. N/total (AC: 9)
- [x] **T15** `useEffect` resetando `page = 1` quando filtros ou dados mudam (AC: 10)
- [x] **T16** `useMemo` em `rows` (com `_ind` pré-computado), `deptos`, `secoes`, `filtered` (AC: 15)
- [x] **T17** `staleTime: 60_000` nas queries de propostas (falta, espaco, calibrado, curva_a_mantida) (AC: 14)

### Frontend — Export Excel
- [x] **T18** Botão "Exportar Excel" usando lib `xlsx` já instalada, exporta `filtered` (AC: 11, 12)
- [x] **T19** Toast de sucesso com contagem; `disabled={filtered.length === 0}` (AC: 13)

### Frontend — RBAC MASTER
- [x] **T20** Adicionar flag `masterOnly` ao tipo `NavItem` em AppSidebar e marcar 3 itens MASTER-only (AC: 16)
- [x] **T21** Calcular `isMaster = group === "MASTER"` no AppSidebar (AC: 16)
- [x] **T22** Atualizar filtro de `visibleItems` para respeitar `masterOnly` (AC: 16)
- [x] **T23** Corrigir `isMaster` em `ModuleTabs` (App.tsx) para usar `group === 'MASTER'` (AC: 16)
- [x] **T24** Marcar tab "Usuários" e "Log de Auditoria" como `masterOnly` em `navigation.ts` (AC: 16)
- [x] **T25** Criar `MasterRoute` guard no App.tsx que redireciona para `/` se `group !== 'MASTER'` (AC: 17)
- [x] **T26** Alterar rotas `/config/usuarios`, `/config/usuarios-admin` e `/config/audit-log` para usar `MasterRoute` (AC: 17, 18)

### Frontend — Audit Log page
- [x] **T27** Criar página `SpAuditLog.tsx` consumindo `GET /api/sp/admin/audit-log` (AC: 22)
- [x] **T28** Renderizar tabela com Data/Hora formatada (pt-BR), Usuário, Ação (badge colorido), Detalhes (AC: 22)

## Dev Notes

- Indicadores usam `med_venda_cx` (MED_VENDA_DIAS_CX do CSV), **não** `giro_dia_cx` (qt_giro_dia/unidade_master). Valores diferem — validado contra amostras do cliente onde 205 ≤ 228 batia com MED_VENDA_CX mas não com GIRODIA.
- `sp_audit_log` já existia (migration 105_sp_csv_jobs_audit.sql), não requer migration nova.
- Grupo "MASTER" é criado pela migration 024_ensure_master_link.sql e é usado como proxy para "admin global do sistema" vs "admin de tenant".
- Frontend já usa dependência `xlsx` (SheetJS) em `package.json` — não houve instalação nova.

### References

- Commits v1.8.0: db1b42a → 966f368 (tag v1.8.0)
- CSV de referência do cliente: `Modelo_Filtro_CD.csv` (colunas AB/AC/AD)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]`

### Debug Log References

- Build backend: `go build ./...` — OK
- Type-check frontend: `npx tsc --noEmit` — OK
- Deploy: Coolify webhook acionado via GitHub Actions (CI/CD) em cada push para `main`

### Completion Notes List

- Paginação e memoização reduzem re-renders em listas com milhares de propostas
- Export Excel usa `xlsx` já disponível — sem nova dependência
- Fórmula do CMEN2DDV inverte o sinal: quando GiroCap=OK e a utilização > 50%, flaga "CAP Menor" (indicando que capacidade cobre < 2 dias)
- Delete de usuário protegido contra autoexclusão (HTTP 400)
- Audit log helper é fire-and-forget (loga erro mas não falha a request original)

### Review Follow-ups Aplicados (AI Code Review — 2026-04-15)

Código atualizado para corrigir 3 HIGH + 3 MEDIUM + 3 LOW identificados em review adversarial.

**HIGH corrigidos:**
- **H1 (cross-tenant delete):** `SpDeletarUsuarioHandler` agora chama `spCtx.TargetUserInSameTenant(db, targetID)` antes de deletar. Novo helper em `smartpick_auth.go`.
- **H2 (guard backend/frontend divergente):** Novo helper `spCtx.IsMasterTenant(db)` aplicado a: `SpDeletarUsuarioHandler`, `SpCriarUsuarioHandler`, `SpAuditLogHandler`, `SpLimparCalibragemHandler`. Backend agora recusa 403 para qualquer admin_fbtax não-MASTER, casando com `MasterRoute` do frontend. ⚠️ **Mudança de comportamento observável**: admins não-MASTER que antes conseguiam criar/excluir usuários ou limpar dados via API agora recebem 403.
- **H3 (audit log fire-and-forget fora da tx):** Novo `writeAuditLogTx(tx, ...)` grava audit na mesma transação da operação. Se a auditoria falhar, rollback cancela a operação sensível. Aplicado a `SpDeletarUsuarioHandler` e `SpLimparCalibragemHandler`. `writeAuditLog(db, ...)` mantido como fallback.

**MEDIUM corrigidos:**
- **M3 (xlsx ~900KB no bundle inicial):** `import * as XLSX from 'xlsx'` removido do topo; agora `await import('xlsx')` dentro do handler do botão (code-splitting).
- **M4 (export bloqueia sem feedback):** Novo state `isExporting` desabilita botão e troca ícone por Loader2 animado enquanto o XLSX é gerado. Try/catch com toast de erro.
- **M5 (reset de página em refetch):** Dep do `useEffect` trocado de `propostas` (referência volátil) por `propostasKey = length:id` (hash estável).

**LOW corrigidos:**
- **L1:** imports mortos `useCallback, memo` removidos.
- **L3:** nome do XLSX usa `toLocaleDateString('sv-SE')` (data local) em vez de UTC.
- **L5:** `SpAuditLog` renderiza payload completo via `Object.entries()` com label map; adicionado `staleTime: 30_000` na query.

**Revertidos (desviavam da spec original):**
- **M1:** proposta de retornar `null` para CMEN2DDV quando GiroCap≠OK foi **revertida** — spec original diz explicitamente `Else "OK"`.
- **M2:** proposta de guardar `cap > 0` em GiroCap foi **revertida** — spec original só diz `mv >= cap → Urgencia`.

**Não corrigidos** (L2, L4): redundância de `headers` manuais (L2) é estilística; paginação do audit log (L4) fica para quando histórico crescer acima de 500 entradas.

### File List

**Backend:**
- `backend/handlers/sp_audit.go` (novo → atualizado) — `writeAuditLog` + novo `writeAuditLogTx` + `SpAuditLogHandler` com guard MASTER
- `backend/handlers/sp_admin.go` (modificado → atualizado) — `SpLimparCalibragemHandler` com guard MASTER + `writeAuditLogTx` dentro da tx
- `backend/handlers/sp_propostas.go` (modificado) — campos `med_venda_cx`, `ponto_reposicao` no DTO/SELECT/Scan
- `backend/handlers/sp_usuarios.go` (modificado → atualizado) — `SpDeletarUsuarioHandler` com guard MASTER + `TargetUserInSameTenant` + `writeAuditLogTx`; `SpCriarUsuarioHandler` com guard MASTER
- `backend/handlers/smartpick_auth.go` (atualizado) — novos helpers `IsMasterTenant(db)` e `TargetUserInSameTenant(db, targetID)`
- `backend/main.go` (modificado) — rotas `DELETE /api/sp/usuarios/{id}` e `GET /api/sp/admin/audit-log`

**Frontend:**
- `frontend/src/pages/SpDashboard.tsx` (modificado → atualizado) — indicadores, filtros, paginação, export Excel lazy-loaded com feedback, performance, calcIndicadores refinado
- `frontend/src/pages/SpAuditLog.tsx` (novo → atualizado) — página de visualização do audit log com payload completo + staleTime
- `frontend/src/components/AppSidebar.tsx` (modificado) — flag `masterOnly` + `group === 'MASTER'`
- `frontend/src/App.tsx` (modificado) — `MasterRoute` guard + rota `/config/audit-log` + fix `isMaster` em ModuleTabs
- `frontend/src/lib/navigation.ts` (modificado) — tabs Usuários/Audit Log marcadas como `masterOnly`

## Change Log

| Data       | Versão | Descrição                                                            | Autor              |
|------------|--------|----------------------------------------------------------------------|--------------------|
| 2026-04-14 | 1.8.0   | Entrega em produção. Tag v1.8.0. Aguardando testes do usuário final. | Claudio + Claude   |
| 2026-04-15 | 1.8.1   | Code review adversarial: 3 HIGH + 5 MEDIUM + 3 LOW corrigidos.       | AI Review          |
