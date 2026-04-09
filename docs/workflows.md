# Fluxos de Negócio — SmartPick

---

## Fluxo Principal: Upload → Motor → Aprovação → PDF

```
Gestor exporta CSV do Winthor
        │
        ▼
[1] UPLOAD CSV
    POST /api/sp/csv/upload
    - Valida CD/Filial pertence à empresa
    - Calcula SHA-256 → verifica duplicata (409 se mesmo hash, status != 'failed')
    - Salva arquivo em uploads/sp_{ts}_{cdID}_{filename}
    - Cria sp_csv_jobs (status = 'pending')
        │
        ▼
[2] WORKER CSV (goroutine background — csv_worker.go)
    - Detecta encoding: se não for UTF-8 válido, converte Latin-1 → UTF-8
    - Lê CSV com delimitador ';'
    - Por linha: extrai 27 colunas (0-based) → insere em sp_enderecos
    - Usa SAVEPOINT por linha para isolar erros (linha ruim não aborta o batch)
    - Atualiza job: status = 'done', total_linhas, linhas_ok, linhas_erro
        │
        ▼
[3] EXECUTAR MOTOR
    POST /api/sp/motor/calibrar  { "job_id": "..." }
    - Verifica job.status == 'done'
    - Verifica idempotência (sp_propostas já existem → 409)
    - Carrega sp_motor_params do CD
    - Cria sp_historico (status = 'em_andamento')
    - Goroutine: para cada sp_enderecos do job → calcularSugestao() → sp_propostas
        │
        ▼
[4] DASHBOARD DE URGÊNCIA
    GET /api/sp/propostas/resumo  (contadores)
    GET /api/sp/propostas?tipo=falta|espaco|calibrado|curva_a_mantida
    
    Gestor pode:
    - PUT /api/sp/propostas/{id}  → editar sugestao_editada
    - POST /api/sp/propostas/{id}/aprovar
    - POST /api/sp/propostas/{id}/rejeitar
    - POST /api/sp/propostas/aprovar-lote
        │
        ▼
[5] GERAR PDF
    GET /api/sp/pdf/calibracao?job_id=...
    - Busca propostas aprovadas do job
    - Agrupa por RUA → gera PDF A4 com maroto
    - Layout: página por RUA, linha de obs. para anotação manual
        │
        ▼
[6] OPERADOR executa no Winthor
    - Usa PDF impresso para atualizar CAPACIDADE produto a produto
```

---

## Ciclo de Vida de um Job CSV

```
pending → processing → done
                    ↘ failed
```

- **pending**: arquivo salvo, worker ainda não iniciou
- **processing**: worker em execução
- **done**: todas as linhas processadas (com ou sem erros de linha)
- **failed**: erro fatal no processamento (ex: arquivo corrompido, erro de banco)

Jobs com status `failed` podem ser **reimportados** — a verificação de duplicata ignora jobs `failed`.

---

## Ciclo de Vida de uma Proposta

```
pendente → aprovada
        ↘ rejeitada
```

- Gerada pelo motor com `status = 'pendente'`
- Gestor pode editar `sugestao_editada` antes de aprovar (opcional)
- Ao aprovar: `status = 'aprovada'`, registra `aprovado_por` e `aprovado_em`
- O PDF usa `COALESCE(sugestao_editada, sugestao_calibragem)` como nova capacidade

---

## Fórmula do Motor de Calibragem

```
sugestao = ⌈ ⌈giroDia / unidade_master⌉ × diasClasse × fatorSeguranca ⌉
```

### Seleção do giro diário (prioridade decrescente):

| Prioridade | Campo CSV | Descrição |
|-----------|-----------|-----------|
| 1 | `MED_VENDA_DIAS` (col 24) | Média de vendas em **unidades/dia** — preferido |
| 2 | `MED_VENDA_DIAS_CX` (col 23) × `unidade_master` | Caixas/dia × unidades/caixa |
| 3 | `MED_VENDA_DIAS_CX_ANOANT_MESSEG` (col 26) × `unidade_master` | Ano anterior |

### Seleção dos dias de estoque (prioridade decrescente):

| Prioridade | Fonte | Descrição |
|-----------|-------|-----------|
| 1 | `CLASSEVENDA_DIAS` (col 17) | Valor definido pelo próprio WMS |
| 2 | Parâmetro do motor por curva | `curva_a_max_est` / `curva_b_max_est` / `curva_c_max_est` |

### Regras especiais:

- **Curva A nunca reduz** (`curva_a_nunca_reduz = true`): se `sugestao < capacidade_atual` e curva = 'A', sugestão é promovida para `capacidade_atual`
- **Mínimo absoluto**: `sugestao = max(sugestao, min_capacidade)`
- **Justificativa**: texto gerado pelo motor incluindo fonte do giro, fonte dos dias, cálculo e resultado

### Exemplo de justificativa gerada:
```
"Curva B: ceil(MED_VENDA_DIAS=15.50 / master=6)=3 × 15 dias(CSV) × 1.10(seg) = 50 cx"
```

---

## Fluxo de Compliance

O dashboard de compliance (`GET /api/sp/historico/compliance`) calcula em tempo real para cada CD:

| Status | Condição |
|--------|----------|
| `nunca_iniciado` | Nenhuma importação |
| `aguardando_motor` | Importou mas motor nunca rodou (≤ 7 dias) |
| `critico` | Motor nunca rodou + import > 7 dias, OU última calibragem > 60 dias, OU proposta pendente > 14 dias |
| `atencao` | Última calibragem > 30 dias OU proposta pendente > 7 dias |
| `ok` | Todos os critérios OK |

---

## Fluxo de Reincidência

Detecta produtos que **deveriam ter sido ajustados no Winthor mas não foram**:

1. Agrupa endereços por `(cd_id, codprod, rua, predio, apto, capacidade)`
2. Conta importações distintas com `status = 'done'` onde a capacidade é a mesma
3. Se o mesmo produto aparece em ≥ N ciclos com mesma capacidade + houve proposta com `delta != 0` → é uma reincidência

---

## Encoding de arquivos CSV

O WMS Winthor exporta arquivos `.txt` em encoding **Windows-1252** (Latin-1).

O `csv_worker.go` detecta automaticamente:
1. `utf8.Valid(rawBytes)` → se falso, aplica conversão Latin-1 → UTF-8
2. A conversão mapeia diretamente bytes 0x80–0xFF para os codepoints Unicode U+0080–U+00FF (sequências UTF-8 de 2 bytes)
3. Byte problemático `0xa0` (NBSP em Windows-1252) era o principal causador de falhas

---

## Deduplicação de arquivos

Critério: **SHA-256 do conteúdo do arquivo**.

- Se o mesmo arquivo for renomeado e enviado novamente → mesmo hash → **409 Conflict**
- Se um arquivo diferente (nova exportação do Winthor) for enviado → hash diferente → aceito
- Jobs com `status = 'failed'` são **ignorados** na verificação de duplicata, permitindo reimport
