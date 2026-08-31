---
title: 'Monitor de Faturamento sem Calibragem (Farol)'
type: 'feature'
created: '2026-08-30'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: 'f9dc676e583a0765efc75cf37c8d3dec734334b4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O CD fatura produtos Curva A/B nos últimos 30 dias (dado que só existe no Farol) sem que o SmartPick tenha nenhuma calibragem aprovada correspondente no mesmo período — hoje não há visibilidade dessa lacuna, o que dificulta monitorar a atividade real de calibragem do CD.

**Approach:** Novo painel dedicado no SmartPick que busca produtos faturados via uma API HTTP nova no Farol (o endpoint em si é pré-requisito externo, fora desta spec) e cruza com `sp_propostas` aprovadas, listando os produtos Curva A/B faturados sem calibragem correspondente.

## Boundaries & Constraints

**Always:**
- Cliente HTTP para o Farol em `backend/services/farol_client.go`, seguindo o padrão de `zai.go` (config via `os.Getenv`, erro claro se `FAROL_BASE_URL`/`FAROL_API_KEY` ausentes).
- Novo handler registrado via `withSP(handlerFactory, "gestor_filial")` em `main.go`, herdando o scoping de filial já resolvido pelo middleware.
- Comparação: produto = pendente quando está em `vendas_faturadas` (Farol, no período selecionado — ~~sempre últimos 30 dias~~ renegociado em 2026-08-31, ver Spec Change Log) e NÃO existe `sp_propostas` com `status='aprovada'` e `aprovado_em` no mesmo período para o mesmo `(cd_id, codprod)`.
- Join CD↔Farol via `sp_centros_dist.filial_id → sp_filiais.cod_filial` contra o campo `empresa` do Farol.
- Se a chamada ao Farol falhar (endpoint ausente, timeout, erro HTTP), o painel mostra um estado de erro claro ("Integração com Farol indisponível") sem quebrar o restante do SmartPick.
- Nova página segue o padrão de `SpResumoExecutivo.tsx` (TanStack Query, Shadcn); nova entrada em `navigation.ts` no grupo "Painel de Resultados".

**Ask First:**
- Contrato do Farol (ver Design Notes) é assumido, não confirmado — se mudar após o Farol implementar, renegociar antes de ajustar o client.

**Never:**
- Não implementar nada no repositório FB_FAROL nesta spec — o endpoint lá é pré-requisito documentado, não código a escrever aqui.
- Não persistir produtos faturados do Farol em tabela nova no SmartPick — comparação sempre ao vivo, sem cache/histórico.
- Não embutir essa lógica no resumo executivo existente — fica em painel próprio.
- Não considerar Curva C/D nesta comparação.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | CD com produtos Curva A/B faturados (Farol) no período selecionado (padrão: últimos 30d), alguns sem calibragem aprovada | Lista os produtos pendentes (codprod, classe, qtd faturada) | N/A |
| Tudo calibrado | Todos os produtos faturados já têm calibragem aprovada recente | Lista vazia + mensagem "Nenhuma pendência" | N/A |
| Farol indisponível | Farol retorna erro/timeout/404 | Painel mostra "Integração com Farol indisponível" | Backend loga o erro; endpoint responde 502 com mensagem amigável |
| Código de produto não bate | `cod_prod` do Farol não casa com nenhum `codprod` do SmartPick | Produto ignorado silenciosamente na comparação | Backend loga contagem agregada de não-correspondências para diagnóstico |

</frozen-after-approval>

## Code Map

- `backend/services/zai.go` -- padrão de cliente HTTP externo (env var, erro claro) a replicar em `farol_client.go`
- `backend/services/resumo_executivo.go:359-395` (`calcularEvolucaoAcesso`) -- padrão de comparação/agregação por CD, inspiração da nova função
- `backend/main.go:429-438` (`withSP`) / `:558-573` (bloco `/api/sp/relatorios`) -- wrapper de auth+role e onde registrar a nova rota
- `smartpick.sp_propostas` (`cd_id`, `codprod`, `classe_venda`, `status`, `aprovado_em`) -- fonte de calibragem aprovada
- `smartpick.sp_filiais.cod_filial` / `sp_centros_dist.filial_id` -- join CD → cod_filial p/ casar com `empresa` do Farol
- `frontend/src/pages/SpResumoExecutivo.tsx` -- padrão de página (TanStack Query) a replicar
- `frontend/src/lib/navigation.ts:55-58` / `App.tsx:190` -- onde entram a nova entrada de menu e a rota
- FB_FAROL `vendas_faturadas` (externo, contrato assumido) -- `cod_prod` TEXT, `empresa` TEXT (cod_filial), `data_faturamento` DATE, `qt` NUMERIC — endpoint HTTP ainda não existe lá

## Tasks & Acceptance

**Execution:**
- [x] `.env.example` -- adicionar `FAROL_BASE_URL` e `FAROL_API_KEY` -- documenta a config necessária
- [x] `backend/services/farol_client.go` (novo) -- cliente HTTP (GET produtos-faturados por `cod_filial`+janela 30d, header `X-API-Key`) + função que resolve o `cod_filial` do CD; `io.ReadAll` do corpo verifica erro (não ignora com `_`) -- isola a integração externa
- [x] `backend/handlers/sp_faturamento_sem_calibragem.go` (novo) -- handler GET que cruza produtos faturados (Farol, Curva A/B) x `sp_propostas` aprovadas (30d) e retorna JSON com pendências; erro do Farol vira 502 amigável; falha nas queries internas (classificação Curva ABC, propostas aprovadas, incluindo `rows.Err()` pós-iteração) vira 500 explícito, nunca resultado vazio silencioso -- endpoint consumido pelo frontend
- [x] `backend/main.go` -- registrar `/api/sp/faturamento-sem-calibragem` via `withSP(..., "gestor_filial")` -- expõe o handler
- [x] `frontend/src/pages/SpFaturamentoSemCalibragem.tsx` (novo) -- página com TanStack Query, tabela de pendências + estado de indisponibilidade -- UI do painel
- [x] `frontend/src/App.tsx` -- rota protegida `/faturamento-sem-calibragem` -- registra a página
- [x] `frontend/src/lib/navigation.ts` -- nova entrada em "Painel de Resultados" -- torna o painel navegável

**Acceptance Criteria:**
- Given um CD com produtos Curva A/B faturados no período selecionado (padrão: últimos 30 dias) no Farol, when nenhum tem `sp_propostas` aprovada correspondente no mesmo período, then o painel lista esses produtos como pendentes.
- Given a chamada ao Farol falha (timeout/erro/404), when o gestor abre o painel, then é exibida a mensagem de integração indisponível, sem erro genérico nem crash do restante do app.
- Given um produto Curva C/D faturado sem calibragem, when a comparação roda, then ele NÃO aparece na lista.
- Given a query interna do SmartPick que carrega a classificação Curva ABC (`sp_enderecos`) falha, when o handler processa a requisição, then a resposta é HTTP 500 (erro genérico, não "Integração com Farol indisponível") — NUNCA uma lista vazia/parcial tratada como resultado válido.
- Given a query interna que carrega `sp_propostas` aprovadas falha, when o handler processa a requisição, then a resposta é HTTP 500 — NUNCA trata a falha como "nenhum produto aprovado" (o que geraria falsos positivos).
- Given a busca do CD (`sp_centros_dist`) falha por erro de banco que não seja "CD inexistente", when o handler valida o `cd_id`, then a resposta é HTTP 500, distinta do 404 usado quando o CD genuinamente não existe/não pertence à empresa.

## Spec Change Log

- 2026-08-30 (pós-deploy, follow-up): usuário esclareceu que "Gap" (delta de capacidade) não é o custo operacional que queria evidenciar — pediu também o `qt_acesso_90` (nº de acessos do separador ao endereço em 90 dias, direto do WMS) e a evolução desde a 1ª importação do CD até hoje daquele produto, mantendo a ordenação por Gap como está. Implementado: `carregarClassificacaoCurva` passou a trazer `qt_acesso_90` da importação atual; nova query `carregarAcessoPrimeiraImportacao` traz o valor da 1ª importação CALIBRACAO concluída do CD (vazio se só há 1 import, ou se falhar — nunca inventa um valor); resposta ganhou `acessos_picking`/`acessos_inicial` por item; frontend mostra o valor atual com seta de tendência (▲ vermelho = mais acessos sem correção, ▼ verde = melhorou) desde a 1ª importação.
- 2026-08-30 (pós-deploy, produção): usuário confirmou integração funcionando em produção (5.234 pendências reais para FILIAL 11 JC) e pediu enriquecimento do painel: por produto, exibir a última proposta de calibragem já gerada (status + gap = `sugestao_calibragem - capacidade_atual`) e ordenar a lista pelo maior gap absoluto primeiro. Implementado: nova query `carregarUltimasPropostas` (mesma proteção fail-loud do amendment anterior — falha nela marca os itens como "indisponível" em vez de afirmar falsamente "nunca teve proposta"); resposta ganhou `ultimo_status`/`gap`/`ultima_atualizacao` por item; ordenação passou de codprod asc para `|gap|` desc (empate por codprod). Não afeta a lógica de inclusão/exclusão de pendências, que permanece intocada.
- 2026-08-30 (review — patch): a query de propostas aprovadas (`carregarCodprodsAprovados` em `sp_faturamento_sem_calibragem.go`) não filtrava `tipo_rel = 'CALIBRACAO'`. Como `sp_propostas` duplica cada produto por `tipo_rel` (CALIBRACAO/REALOCACAO — mesma causa raiz corrigida hoje em `resumo_executivo.go`), uma proposta de REALOCACAO aprovada suprimiria incorretamente uma pendência real de calibragem (falso negativo). Corrigido adicionando `AND tipo_rel = 'CALIBRACAO'` à query, alinhando com `carregarClassificacaoCurva` que já filtrava corretamente.
- 2026-08-30 (implementation): o contrato do Farol em Design Notes não traz `classe_venda` (só `cod_prod`/`empresa`/`data_faturamento`/`qt`). O filtro Curva A/B é aplicado usando a classificação do próprio SmartPick (`sp_enderecos.classe_venda` da importação `CALIBRACAO` mais recente e concluída do CD). Produto do Farol sem correspondência em `sp_enderecos` (ou fora de A/B) é tratado como "não-correspondência" conforme a matriz de edge-case, e contado/logado agregadamente. **KEEP** — esta decisão de sourcing continua válida e deve ser preservada na re-implementação.
- 2026-08-30 (review — bad_spec): review layers (blind-hunter + edge-case-hunter) encontraram que a 1ª implementação tratava falha nas queries internas do SmartPick (classificação Curva ABC e propostas aprovadas) como resultado vazio silencioso — logava e seguia com mapa vazio. Isso fazia o painel mentir: falha na query de classificação → todo produto do Farol vira "não-correspondência" → "Nenhuma pendência" falso, escondendo exatamente o problema que o painel existe para detectar; falha na query de aprovados → nenhum produto é excluído → falsos positivos/alarme falso. A busca do CD também tratava qualquer erro de banco (não só "não encontrado") como 404, mascarando uma queda real do banco. Causa raiz: a seção "Always" só definia o comportamento de erro para falhas do **Farol** — nunca cobriu falhas internas do próprio banco do SmartPick. Amendment: adicionadas 3 Acceptance Criteria acima exigindo 500 explícito (nunca resultado vazio/parcial silencioso) nessas 3 queries internas; tarefa do `farol_client.go` ajustada para não ignorar erro de `io.ReadAll`. **KEEP** — toda a lógica de comparação (Curva A/B, exclusão por calibragem aprovada), a auth/scoping (`empresa_id` + `HasFilialAccess`), o tratamento 502 específico para falha do Farol, e a estrutura da página React (loading/erro/vazio/dados) estavam corretos e devem ser preservados; o único ajuste é fazer as 3 queries internas falharem alto (500) em vez de silenciosamente.
- 2026-08-31 (pós-deploy, usuário — período configurável): renegociado o boundary "sempre últimos 30 dias" (linha 24 original). Usuário pediu para poder informar data início/fim, especificamente por causa da coluna de Sazonalidade (carregada do FB_FAROL) — investigação mostrou que a sazonalidade em si NÃO usa essa janela (é um índice mensal calculado no FB_FAROL sobre o ano calendário 2025 fechado, hardcoded lá, independente do período do relatório); o que de fato estava fixo em 30 dias era a janela geral que decide quais produtos entram como pendência. Escopo confirmado com o usuário: só essa janela geral vira configurável (não o cálculo de sazonalidade no FB_FAROL, que ficou de fora). Implementado: `coletarFaturamentoInterno`/`ColetarFaturamentoSemCalibragem`/`GerarRelatorioFaturamento` (`faturamento_calibragem.go`) passam a aceitar `periodoIni, periodoFim time.Time` — zero value em ambos aplica o padrão de últimos 30 dias (`ResolverPeriodoFaturamento`, novo helper exportado). GET ao vivo (`/api/sp/faturamento-sem-calibragem`) e o gerar manual de snapshot (`POST /api/sp/relatorios-faturamento/gerar`) ganharam query params opcionais `data_ini`/`data_fim` (AAAA-MM-DD, validados: formato e `data_fim >= data_ini`); o worker diário automático sempre usa o padrão (sem UI pra escolher período num processo desatendido). Frontend: dois `<input type="date">` (Início/Fim) na página do painel, pré-preenchidos com os últimos 30 dias, incluídos na `queryKey` do TanStack Query (refetch automático ao mudar) e propagados também pro "Gerar PDF"/"Enviar por e-mail" (mesmo snapshot gerado usa o período escolhido). Textos que citavam "últimos 30 dias" como regra fixa (painel, e-mail) viraram dinâmicos, citando o período real do snapshot.

## Design Notes

Contrato assumido para o endpoint do Farol (ainda não existe lá — precisa ser confirmado/implementado depois):

```
GET {FAROL_BASE_URL}/api/farol/produtos-faturados?empresa={cod_filial}&data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD
Header: X-API-Key: {FAROL_API_KEY}
Resposta: [{ "cod_prod": "12345", "empresa": "11", "data_faturamento": "2026-08-15", "qt": 42.0 }]
```

Até lá, `farol_client.go` falha de forma limpa (erro tratado, nunca panic) e a página mostra indisponibilidade — o painel é entregue funcional, só aguardando o outro lado.

## Verification

**Commands:**
- `cd backend && go build ./...` -- expected: build limpo
- `cd frontend && npx tsc --noEmit` -- expected: sem erros de tipo

**Manual checks:**
- Abrir `/faturamento-sem-calibragem` logado como `gestor_filial` e confirmar o estado de "integração indisponível" (endpoint do Farol não existe em ambiente local ainda).

## Suggested Review Order

**Tratamento de erro interno vs. externo (o motivo do loop de revisão)**

- Entrada do handler: resolve o CD e já diferencia 404 (não existe) de 500 (erro real de banco) — é o padrão que se repete nas outras duas queries internas.
  [`sp_faturamento_sem_calibragem.go:87`](../../backend/handlers/sp_faturamento_sem_calibragem.go#L87)

- Falha ao carregar Curva ABC nunca vira mapa vazio silencioso — evita o painel mentir "Nenhuma pendência".
  [`sp_faturamento_sem_calibragem.go:210`](../../backend/handlers/sp_faturamento_sem_calibragem.go#L210)

- Falha ao carregar propostas aprovadas nunca vira "nenhum aprovado" — evita falso positivo/alarme falso.
  [`sp_faturamento_sem_calibragem.go:246`](../../backend/handlers/sp_faturamento_sem_calibragem.go#L246)

- `tipo_rel = 'CALIBRACAO'` na query de aprovados — sem isso, uma REALOCACAO aprovada suprimiria uma pendência real (mesmo bug corrigido hoje em `resumo_executivo.go`).
  [`sp_faturamento_sem_calibragem.go:250`](../../backend/handlers/sp_faturamento_sem_calibragem.go#L250)

**Cliente Farol (integração externa)**

- `ErrCDNaoEncontrado` como sentinel — permite ao handler distinguir CD inexistente de queda de banco sem string matching frágil.
  [`farol_client.go:34`](../../backend/services/farol_client.go#L34)

- Chamada HTTP: `io.ReadAll` com erro sempre checado, timeout de 20s, nunca panic — resposta do Farol pode falhar de várias formas.
  [`farol_client.go:78`](../../backend/services/farol_client.go#L78)

**Comparação e agregação (a lógica central do painel)**

- Filtra Curva A/B, exclui aprovados, agrega por `codprod` — o cruzamento Farol × SmartPick que gera a lista de pendências.
  [`sp_faturamento_sem_calibragem.go:138`](../../backend/handlers/sp_faturamento_sem_calibragem.go#L138)

**UI — três estados de erro distintos**

- Farol indisponível (502) tem tratamento visual separado de outros erros (500/403) — o gestor não confunde "Farol fora do ar" com "bug no SmartPick".
  [`SpFaturamentoSemCalibragem.tsx:108`](../../frontend/src/pages/SpFaturamentoSemCalibragem.tsx#L108)

- Tabela de pendências só renderiza com dados válidos e sem erro — states mutuamente exclusivos evitam UI inconsistente.
  [`SpFaturamentoSemCalibragem.tsx:221`](../../frontend/src/pages/SpFaturamentoSemCalibragem.tsx#L221)

**Periféricos**

- Rota registrada com o mesmo padrão de auth/scoping (`gestor_filial`) das demais rotas do painel.
  [`main.go:509`](../../backend/main.go#L509)

- Nova entrada de menu e rota protegida seguem o padrão das páginas irmãs.
  [`App.tsx:194`](../../frontend/src/App.tsx#L194)
