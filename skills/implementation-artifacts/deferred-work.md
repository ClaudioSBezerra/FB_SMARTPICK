- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Handler novo (`sp_faturamento_sem_calibragem.go`) não propaga `r.Context()` para as queries do banco nem para a chamada HTTP ao Farol.
  evidence: Blind-hunter + edge-case-hunter apontaram que um cliente desconectado não cancela a query/chamada em andamento; hardening razoável, mas não bloqueia a correção funcional desta história.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Sem paginação/LIMIT nas queries internas nem no array `pendentes` da resposta, e o cliente do Farol assume resposta única não-paginada.
  evidence: Padrão consistente com outras leituras não-limitadas de `sp_enderecos` já existentes no código (ex. query de alertas em `resumo_executivo.go`), mas o contrato do Farol ainda não existe e pode vir paginado quando for implementado — revisar então.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: `classe_venda`/`produto` exibidos no painel vêm da importação CALIBRACAO mais recente do CD, que pode estar desatualizada frente ao faturamento do Farol (dado mais recente).
  evidence: Já documentado como decisão deliberada no Spec Change Log; falta apenas comunicar ao usuário "classificação como de {data}" na UI — melhoria de transparência, não bug.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Frontend não trata erro nas queries de `filiais` e `cds` (dropdowns ficam vazios sem feedback ao usuário).
  evidence: Mesmo padrão (sem tratamento de erro nesses dois fetches) já existe em `SpResumoExecutivo.tsx` — não é regressão desta história, é convenção pré-existente do projeto.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Nenhum teste automatizado (Go ou frontend) cobre o novo handler/cliente/página.
  evidence: Verification-gap layer confirmou que todo o backend do projeto não tem nenhum teste Go (`find backend -iname "*_test.go"` = 0 resultados) — consistente com o padrão pré-existente, não uma lacuna introduzida por esta história.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Quantidades faturadas (`qt`) do Farol com valor zero/negativo (possíveis devoluções/ajustes) não são filtradas antes de somar em `qtd_faturada`.
  evidence: Edge-case-hunter apontou o caso; requer esclarecer com o contrato real do Farol (ainda não implementado) se `qt` negativo é uma possibilidade de negócio válida antes de decidir a regra.

- source_spec: `skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md`
  summary: Handler confia cegamente no filtro de `empresa`/período que o Farol aplica na resposta, sem revalidar client-side.
  evidence: Edge-case-hunter apontou como hardening defensivo razoável; não é uma falha coberta pelo contrato assumido documentado no spec.

~~- source_spec: `skills/implementation-artifacts/spec-faturamento-pdf-email.md`~~
~~  summary: SEGURANÇA — `SpResumoItemHandler`/`SpResumoEnviarHandler`/`SpResumosHandler`/`SpResumoGerarHandler` (Resumo Executivo) não filtravam por `empresa_id`.~~
**CORRIGIDO em 2026-08-30** (fora de qualquer spec, correção ad-hoc pedida diretamente pelo usuário): os 4 handlers em `backend/handlers/sp_resumos.go` agora escopam por `empresa_id` — `SpResumoItemHandler`/`SpResumoEnviarHandler`/`SpResumosHandler` via `JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id ... AND cd.empresa_id = $N`, `SpResumoGerarHandler` via checagem prévia (`sp_centros_dist WHERE id=$1 AND empresa_id=$2` + `HasFilialAccess`), mesmo padrão já usado em `sp_relatorios_faturamento.go`. `SpResumoPDFHandler` já estava correto e não precisou de mudança.
