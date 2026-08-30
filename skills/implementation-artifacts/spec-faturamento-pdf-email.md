---
title: 'PDF + Envio Automático/Manual do Faturamento sem Calibragem'
type: 'feature'
created: '2026-08-30'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '6efa938db6d3fffb504a65ffe85bb30d2b64b2ff'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O painel "Faturamento sem Calibragem" só existe como visualização ao vivo — não há como exportar em PDF (com a logo da empresa), nem enviar aos gestores por e-mail, manual ou automaticamente.

**Approach:** Persistir um snapshot do painel (nova tabela, espelhando `sp_relatorios_semanais`), gerar PDF com logo (reaproveitando `buscarLogoEmpresa`) a partir desse snapshot, enviar e-mail HTML com link para o PDF (reaproveitando o padrão de `EnviarResumoPorEmail`) aos destinatários já cadastrados em `sp_destinatarios_resumo`, com botões manuais no painel e um worker diário (7h BRT) espelhando `resumo_worker.go`.

## Boundaries & Constraints

**Always:**
- Extrair a lógica de comparação hoje inline em `SpFaturamentoSemCalibragemHandler` para uma função de serviço reaproveitável (ex.: `services.ColetarFaturamentoSemCalibragem`), preservando EXATAMENTE o comportamento fail-loud já existente (falha nas queries internas nunca vira resultado vazio/parcial silencioso — mesmo princípio já estabelecido nesta feature). O handler GET ao vivo passa a só chamar essa função.
- Nova tabela `smartpick.sp_relatorios_faturamento` (migration `131_...sql`), mesma forma de `sp_relatorios_semanais` (id, cd_id, periodo_inicio/fim TIMESTAMPTZ, dados_json, enviado_em, enviado_para, erro_envio, criado_em, criado_por).
- PDF: novo handler seguindo o padrão de `sp_resumo_pdf.go` (maroto, logo via `buscarLogoEmpresa(db, empresaID)`, fallback sem logo se não houver), gerado a partir do snapshot salvo (não ao vivo).
- E-mail: HTML + texto plano seguindo o padrão de `buildResumoHTML`/`buildResumoPlainText`/`EnviarResumoPorEmail` — resumo dos números principais + o PDF completo anexado (binário, `multipart/mixed`), sem link pro painel (branding SmartPick). Ver Spec Change Log 2026-08-30 (anexo / remoção do link).
- Destinatários: reaproveitar `smartpick.sp_destinatarios_resumo` como está (mesma lista do Resumo Executivo, sem coluna de tipo de relatório).
- Worker diário novo (`StartFaturamentoWorker`, espelhando `resumo_worker.go`): roda 1x/dia às 7h BRT, para CDs ativos com destinatários ativos que não tiveram relatório de faturamento gerado nas últimas 20h (evita duplicar no mesmo dia).
- Frontend: botões "Gerar PDF" e "Enviar por e-mail" na página do painel, seguindo exatamente os padrões `baixarPDF`/`enviarMutation` de `SpResumoExecutivo.tsx`.
- Rotas novas seguem o padrão `/api/sp/relatorios-faturamento/{id}/pdf` e `/{id}/enviar` + `POST /api/sp/relatorios-faturamento/gerar?cd_id=X`, registradas em `main.go` com o mesmo dispatch por sufixo de `/api/sp/relatorios/`.

**Ask First:**
- Nenhuma pendente — horário (7h BRT), formato do e-mail (HTML+link) e lista de destinatários (reaproveitar a existente) já foram confirmados pelo usuário.

**Never:**
- ~~Não anexar o PDF como binário no e-mail~~ — renegociado pelo usuário em 2026-08-30 (ver Spec Change Log). O e-mail agora anexa o PDF de fato.
- Não criar coluna/tela de destinatários específica para este relatório — reusa a lista existente do CD.
- Não modificar `services/email.go` (herdado) nem a lógica de `resumo_worker.go`/`resumo_executivo.go` além de ler seus padrões como referência.
- Não alterar o comportamento do GET ao vivo do painel (`/api/sp/faturamento-sem-calibragem`) além da extração de função — a resposta e o comportamento continuam idênticos.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gerar manual | Gestor clica "Gerar PDF" sem snapshot prévio | Cria snapshot (POST gerar) e baixa o PDF | Erro do Farol/banco vira mensagem clara, sem crash |
| Enviar manual | Gestor clica "Enviar por e-mail" num snapshot existente | E-mail enviado aos destinatários ativos do CD; `enviado_em`/`enviado_para` gravados | Zero destinatários ativos → erro claro (mesmo padrão de `EnviarResumoPorEmail`) |
| Worker diário roda | 7h BRT, CD ativo com destinatários, sem envio nas últimas 20h | Gera snapshot + envia e-mail automaticamente | Falha em 1 CD não impede os demais (mesmo padrão de `gerarEEnviar`) |
| Worker roda 2x no mesmo dia | CD já teve relatório gerado há poucas horas | CD é pulado (dedup) | N/A |
| Logo ausente | Empresa sem `logo_data` (nem no grupo) | PDF gerado sem logo (coluna em branco), sem erro | N/A |

</frozen-after-approval>

## Code Map

- `backend/handlers/sp_faturamento_sem_calibragem.go` -- lógica de comparação hoje inline (todas as funções `carregar*`, tipos `FaturamentoPendenciaItem`/`FaturamentoSemCalibragemResponse`) -- extrair para services
- `backend/services/farol_client.go` (`ResolveCDFarolInfo`, `CDFarolInfo`) -- reaproveitar para resolução de CD
- `backend/services/resumo_executivo.go:522` (`EnviarResumoPorEmail`), `:509` (`MarcarEnviado`), `:912` (`GerarResumoExecutivo`), `:677`/`:807` (`buildResumoHTML`/`buildResumoPlainText`) -- padrão exato a replicar
- `backend/services/resumo_worker.go` (arquivo inteiro, 109 linhas) -- padrão exato do worker diário a replicar (trocar janela semanal por diária 7h BRT)
- `backend/services/faturamento_pdf.go` (`GerarPDFFaturamentoSemCalibragem`, `BuscarLogoEmpresa`, `NomeArquivoPDFFaturamento`) -- montagem do PDF (maroto) e logo, compartilhadas entre o download manual (`handlers/sp_relatorios_faturamento_pdf.go`) e o anexo do e-mail (`services/faturamento_email.go`) desde 2026-08-30 (ver Spec Change Log)
- `backend/handlers/sp_resumos.go:197-386` (`SpResumosHandler`, `SpResumoItemHandler`, `SpResumoGerarHandler`, `SpResumoEnviarHandler`) -- padrão exato dos handlers HTTP (gerar/enviar/pdf) a replicar
- `backend/migrations/117_sp_resumo_executivo.sql` -- modelo exato para a nova migration `131_sp_relatorios_faturamento.sql`
- `backend/main.go:558-577` -- bloco de rotas `/api/sp/relatorios/` (dispatch por sufixo) e `main.go:274` (`services.StartResumoWorker`) -- onde registrar as rotas e o novo worker
- `frontend/src/pages/SpResumoExecutivo.tsx` (botões `baixarPDF`/`enviarMutation`, ~linhas 187-223 e 350-373) -- padrão exato dos botões a replicar
- `frontend/src/pages/SpFaturamentoSemCalibragem.tsx` -- onde adicionar os botões (header do painel)
- `smartpick.sp_destinatarios_resumo` -- lista de destinatários reaproveitada como está

## Tasks & Acceptance

**Execution:**
- [x] `backend/migrations/131_sp_relatorios_faturamento.sql` (novo) -- tabela `sp_relatorios_faturamento` espelhando `sp_relatorios_semanais` -- persistência do snapshot
- [x] `backend/services/faturamento_calibragem.go` (novo) -- move a lógica de `sp_faturamento_sem_calibragem.go` (tipos + `carregar*` + comparação), preservando 100% do comportamento fail-loud; expõe `ColetarFaturamentoSemCalibragem` e `GerarRelatorioFaturamento` (persiste snapshot) -- reuso entre handler HTTP e worker
- [x] `backend/handlers/sp_faturamento_sem_calibragem.go` -- refatorado para só chamar `services.ColetarFaturamentoSemCalibragem` -- elimina duplicação
- [x] `backend/services/faturamento_email.go` (novo) -- `EnviarFaturamentoPorEmail` + `buildFaturamentoHTML`/`buildFaturamentoPlainText`, seguindo o padrão de `resumo_executivo.go`, com botão "Baixar PDF completo" -- e-mail aos destinatários
- [x] `backend/handlers/sp_relatorios_faturamento_pdf.go` (novo) -- PDF a partir do snapshot salvo, com logo via `buscarLogoEmpresa` -- exportação em PDF
- [x] `backend/handlers/sp_relatorios_faturamento.go` (novo) -- handlers gerar/item/enviar (`POST .../gerar?cd_id=X`, `GET .../{id}`, `POST .../{id}/enviar`) -- endpoints manuais
- [x] `backend/services/faturamento_worker.go` (novo) -- `StartFaturamentoWorker`, ticker diário, janela 7h BRT, dedup por CD nas últimas 20h -- automação diária
- [x] `backend/main.go` -- registra rotas `/api/sp/relatorios-faturamento` (dispatch por sufixo) + `services.StartFaturamentoWorker(getDB)` -- expõe tudo
- [x] `frontend/src/pages/SpFaturamentoSemCalibragem.tsx` -- botões "Gerar PDF" e "Enviar por e-mail" no header do painel, seguindo `baixarPDF`/`enviarMutation` de `SpResumoExecutivo.tsx` -- UI manual

**Acceptance Criteria:**
- Given um CD com pendências, when o gestor clica "Gerar PDF", then um PDF com a logo da empresa é baixado, mostrando os produtos pendentes com Curva/Gap/Acessos.
- Given um snapshot gerado, when o gestor clica "Enviar por e-mail", then todos os destinatários ativos do CD recebem o e-mail com o PDF completo anexado.
- Given 7h BRT chega e um CD ativo tem destinatários ativos e não teve relatório de faturamento nas últimas 20h, when o worker roda, then o snapshot é gerado e enviado automaticamente, sem intervenção manual.
- Given o mesmo CD já teve relatório gerado há poucas horas, when o worker roda de novo, then o CD é pulado (sem e-mail duplicado).
- Given a query interna de comparação falha (mesmo cenário já coberto pelo GET ao vivo), when o snapshot é gerado (manual ou pelo worker), then a geração falha com erro claro — nunca salva um snapshot com resultado vazio/parcial enganoso.

## Spec Change Log

- 2026-08-30 (implementation): a spec não detalhava 3 pontos de design — resolvidos por engenharia, sem contradizer nenhum boundary:
  1. **Botões manuais sem histórico selecionável**: como o painel não lista snapshots anteriores (diferente de `SpResumoExecutivo.tsx`), tanto "Gerar PDF" quanto "Enviar por e-mail" geram seu próprio snapshot novo (`POST .../gerar`) antes de agir sobre ele (baixar o PDF / enviar o email), em vez de operar sobre um snapshot pré-selecionado.
  2. **Autorização nos novos endpoints por `{id}`**: `sp_resumos.go` (padrão de referência) não escopa `SpResumoItemHandler`/`SpResumoEnviarHandler` à empresa da sessão (só `SpResumoPDFHandler` faz o `JOIN` com `cd.empresa_id`). Para o Faturamento, apliquei o `JOIN cd.empresa_id = spCtx.EmpresaID` nos três handlers por `{id}` (item/enviar/pdf), e a checagem completa (`ResolveCDFarolInfo` + `HasFilialAccess`) no `gerar?cd_id=X` — mesmo nível de rigor já estabelecido para este painel na spec anterior (spec-farol-faturamento-sem-calibragem.md), não o nível mais permissivo do Resumo Executivo.
  3. **Mensagens de erro 500 do GET ao vivo**: ao consolidar a coleta em `services.ColetarFaturamentoSemCalibragem`, as mensagens de erro específicas por etapa ("Erro interno ao carregar classificação de produtos" vs. "...calibragens aprovadas") viraram uma mensagem genérica única ("Erro interno ao carregar o painel"). Os status HTTP (404/500/502) e o comportamento fail-loud (nunca resultado vazio/parcial) permanecem idênticos; só o texto exato da mensagem de erro para essas 2 sub-falhas específicas mudou.
- 2026-08-30 (review — patch): o PDF (`sp_relatorios_faturamento_pdf.go`) renderizava TODAS as pendências sem limite — um CD real em produção (FILIAL 11 JC) já tem 5.234 pendências, o que geraria um PDF de centenas de páginas, lento e impraticável. Corrigido: tabela limitada aos 300 maiores gaps (a lista já vem ordenada por gap desc), com nota no rodapé indicando quantos produtos adicionais existem e que a lista completa está no painel. `dados_json` continua salvando o snapshot completo (sem corte) — só a renderização do PDF foi limitada.
- 2026-08-30 (pós-deploy, usuário): dois ajustes no PDF gerado. (1) A coluna "Produto" truncava em 42 caracteres para uma coluna de largura 3/12 — acima do limite de 34 chars comprovado em `sp_resumo_pdf.go` para a mesma largura de coluna, causando quebra em 2 linhas dentro da altura fixa da linha (4.5mm) e sobreposição com a linha seguinte. Corrigido para 34 chars, igualando ao padrão de referência. (2) Removida a KPI "Sem correspondência Curva A/B" do resumo do PDF (usuário pediu para tirar; era um número de diagnóstico interno sem contexto útil pro gestor).
- 2026-08-30 (pós-deploy, usuário — repaginação executiva): PDF orientação paisagem, altura de linha automática (elimina sobreposição pra qualquer tamanho de nome), cabeçalho da tabela repetindo em toda página via `RegisterHeader`, rodapé com paginação, ribbon de 4 KPIs (pendências/curva A-B/nunca calibrados/acessos ao picking) substituindo a KPI solta, zebra striping, números com separador de milhar e Gap colorido. A mesma KPI de diagnóstico ("Sem correspondência Curva A/B") também existia no corpo do e-mail (`buildFaturamentoHTML`/`buildFaturamentoPlainText`) e foi removida de lá — substituída por uma frase de destaque no topo do e-mail dimensionando o volume de calibragem/realocação pendente (produtos sem calibragem, quantos são Curva A, acessos ao picking no período).
- 2026-08-30 (pós-deploy, usuário — anexo): renegociada a decisão "Never: não anexar o PDF" (linha 35 original). O e-mail agora anexa o PDF de fato (binário, `multipart/mixed` envolvendo o `multipart/alternative` plain+html + a parte `application/pdf` em base64), gerado uma única vez por envio a partir do mesmo `services.GerarPDFFaturamentoSemCalibragem` usado no download manual (lógica de montagem do PDF movida de `handlers/sp_relatorios_faturamento_pdf.go` para `services/faturamento_pdf.go`, exportada, pra ser reaproveitável pelos dois lugares; `buscarLogoEmpresa` também movida pra lá como `services.BuscarLogoEmpresa`, compartilhada com `sp_resumo_pdf.go`). Falha na geração do PDF loga um aviso e o e-mail sai sem anexo (não trava o envio do resumo). Nesse mesmo passo o botão do corpo do e-mail trocou de "Baixar PDF completo" pra "Abrir painel completo" (com nota de que o PDF já ia anexado).
- 2026-08-30 (pós-deploy, usuário — remoção do link): com o anexo já cobrindo o caso de uso, o botão/link "Abrir painel completo" (HTML e a linha equivalente no texto plano) virou redundante — removido de `buildFaturamentoHTML`/`buildFaturamentoPlainText`. `appURL` e o import `os` saíram junto por ficarem sem uso. E-mail final: assunto + resumo (frase de destaque, KPI, top produtos por gap) + PDF anexado, sem nenhum link pro painel. **Spec fechada nesse estado** (status `done`, sem pendências conhecidas).

## Design Notes

Contrato do e-mail (mesmo estilo visual do Resumo Executivo, adaptado):
- Assunto: `"SmartPick - Faturamento sem Calibragem {CdNome} ({data})"`.
- Corpo: frase de destaque (volume de calibragem/realocação pendente), nº de pendências, top 3-5 produtos por gap. Sem link pro painel.
- Anexo: o PDF completo do snapshot (ver Spec Change Log 2026-08-30 — anexo / remoção do link).

Worker diário — janela de dedup em 20h (não 24h) para tolerar variação no horário exato do ticker sem pular um dia; segue o mesmo `time.FixedZone("BRT", -3*3600)` de `resumo_worker.go`.

A extração de `sp_faturamento_sem_calibragem.go` para services é o passo de maior risco desta spec — copiar literalmente a lógica das funções `carregarClassificacaoCurva`, `carregarCodprodsAprovados`, `carregarUltimasPropostas`, `carregarAcessoPrimeiraImportacao` e do corpo de comparação, sem alterar nenhuma condição de erro/fail-loud já revisada e corrigida nesta feature.

## Verification

**Commands:**
- `cd backend && go build ./...` -- expected: build limpo
- `cd frontend && npx tsc --noEmit` -- expected: sem erros de tipo

**Manual checks:**
- Gerar PDF manual de um CD com pendências reais e conferir logo + dados.
- Enviar e-mail manual e conferir recebimento (ambiente com SMTP configurado).
- Não é possível testar o worker diário em tempo real na sessão — revisar a lógica de janela/dedup por leitura de código comparando com `resumo_worker.go`.

## Suggested Review Order

**Extração da lógica de coleta (o ponto de maior risco — precisa bater 100% com o comportamento já revisado)**

- Comparação Curva A/B x Farol x calibragem aprovada, cópia literal do handler original — confira contra `spec-farol-faturamento-sem-calibragem.md` linha a linha.
  [`faturamento_calibragem.go:92`](../../backend/services/faturamento_calibragem.go#L92)

- As 4 queries internas (`carregar*`) preservam o fail-loud: erro sempre propagado, nunca mapa vazio silencioso.
  [`faturamento_calibragem.go:282`](../../backend/services/faturamento_calibragem.go#L282)

- Persistência do snapshot — usa os limites exatos de tempo (`time.Time`) da coleta, não as datas já truncadas do JSON.
  [`faturamento_calibragem.go:238`](../../backend/services/faturamento_calibragem.go#L238)

- Handler GET ao vivo virou wrapper fino — comportamento e resposta devem ser idênticos a antes da extração.
  [`sp_faturamento_sem_calibragem.go`](../../backend/handlers/sp_faturamento_sem_calibragem.go)

**Autorização dos endpoints novos por `{id}`**

- `gerar?cd_id=X` — mesma checagem completa do painel ao vivo (`ResolveCDFarolInfo` + `HasFilialAccess`).
  [`sp_relatorios_faturamento.go:57`](../../backend/handlers/sp_relatorios_faturamento.go#L57)

- `{id}`, `{id}/enviar`, `{id}/pdf` — todos com `JOIN cd.empresa_id = spCtx.EmpresaID`, mais rigoroso que o padrão do Resumo Executivo (ver achado de segurança pré-existente em `deferred-work.md`).
  [`sp_relatorios_faturamento.go:125`](../../backend/handlers/sp_relatorios_faturamento.go#L125)

**PDF (com o cap de linhas — achado do review)**

- Limite de 300 linhas (maiores gaps) com nota de quantos ficaram de fora — evita um PDF de milhares de páginas num CD real com 5.234 pendências.
  [`faturamento_pdf.go`](../../backend/services/faturamento_pdf.go)

- Logo da empresa em `services.BuscarLogoEmpresa`, compartilhada entre o PDF de Faturamento e o de Resumo Executivo (sem duplicar).
  [`faturamento_pdf.go`](../../backend/services/faturamento_pdf.go)

**E-mail e worker diário**

- E-mail anexa o PDF completo (`multipart/mixed`) — resumo + PDF anexado, sem link pro painel (decisão renegociada em 2026-08-30, ver Spec Change Log).
  [`faturamento_email.go`](../../backend/services/faturamento_email.go)

- Worker: janela 7h BRT + dedup 20h; falha em 1 CD não impede os demais.
  [`faturamento_worker.go:48`](../../backend/services/faturamento_worker.go#L48)

**Frontend — botões manuais**

- Cada botão gera seu próprio snapshot antes de agir (painel não tem histórico selecionável — decisão documentada no Spec Change Log).
  [`SpFaturamentoSemCalibragem.tsx:176`](../../frontend/src/pages/SpFaturamentoSemCalibragem.tsx#L176)

**Periféricos**

- Migration da tabela de snapshot.
  [`131_sp_relatorios_faturamento.sql`](../../backend/migrations/131_sp_relatorios_faturamento.sql)

- Registro das rotas + worker.
  [`main.go:513`](../../backend/main.go#L513)
