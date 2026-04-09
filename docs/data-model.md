# Modelo de Dados — SmartPick

> Schema PostgreSQL: `smartpick` (no mesmo banco que o FB_APU02, schema `public`)

---

## Visão geral dos relacionamentos

```
public.companies (tenant)
    └── smartpick.sp_subscription_limits  (1:1)
    └── smartpick.sp_filiais              (1:N)
            └── smartpick.sp_centros_dist (1:N)
                    └── smartpick.sp_motor_params     (1:1)
                    └── smartpick.sp_csv_jobs         (1:N)
                            └── smartpick.sp_enderecos (1:N)
                            └── smartpick.sp_propostas (1:N)
                    └── smartpick.sp_historico         (1:N)

public.users
    └── smartpick.sp_user_filiais (M:N com sp_filiais)
```

---

## Tabelas

### `smartpick.sp_filiais`
Representa as filiais WMS de um tenant. `cod_filial` vem do campo `CODFILIAL` do CSV.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | SERIAL PK | ID interno |
| empresa_id | UUID FK → public.companies | Tenant |
| cod_filial | INTEGER | Código WMS (ex: 11) |
| nome | TEXT | Nome da filial |
| ativo | BOOLEAN | default true |
| created_at / updated_at | TIMESTAMPTZ | |

Constraint único: `(empresa_id, cod_filial)`

---

### `smartpick.sp_centros_dist`
Centro de Distribuição vinculado a uma filial. Um CD pode ser duplicado (self-referência `fonte_cd_id`).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | SERIAL PK | |
| filial_id | INTEGER FK → sp_filiais | |
| empresa_id | UUID FK → public.companies | |
| nome | TEXT | |
| descricao | TEXT | |
| ativo | BOOLEAN | |
| fonte_cd_id | INTEGER FK self | ID do CD original quando duplicado |
| criado_por | UUID FK → public.users | |

---

### `smartpick.sp_motor_params`
Parâmetros do motor de calibragem por CD. Criados automaticamente ao criar um CD.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| id | SERIAL PK | | |
| cd_id | INTEGER FK unique | | |
| dias_analise | INTEGER | 90 | Janela de análise (informativo) |
| curva_a_max_est | INTEGER | 7 | Dias máx estoque Curva A |
| curva_b_max_est | INTEGER | 15 | Dias máx estoque Curva B |
| curva_c_max_est | INTEGER | 30 | Dias máx estoque Curva C |
| fator_seguranca | NUMERIC(5,2) | 1.10 | Multiplicador de segurança |
| curva_a_nunca_reduz | BOOLEAN | true | Curva A nunca gera proposta de redução |
| min_capacidade | INTEGER | 1 | Sugestão mínima absoluta |
| retencao_csv_meses | INTEGER | 6 | Retenção de importações antigas |

---

### `smartpick.sp_subscription_limits`
Limites de plano por empresa (tenant).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| empresa_id | UUID FK unique | |
| plano | TEXT | 'trial' \| 'basic' \| 'pro' \| 'enterprise' |
| max_filiais | INTEGER | -1 = ilimitado |
| max_cds | INTEGER | -1 = ilimitado |
| max_usuarios | INTEGER | -1 = ilimitado |
| ativo | BOOLEAN | |
| valido_ate | TIMESTAMPTZ | NULL = sem expiração |

---

### `smartpick.sp_csv_jobs`
Job de importação CSV. Cada arquivo enviado cria um job.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UUID PK (gen_random_uuid) | |
| empresa_id | UUID FK | |
| filial_id | INTEGER FK → sp_filiais | |
| cd_id | INTEGER FK → sp_centros_dist | |
| uploaded_by | UUID FK → public.users | |
| filename | TEXT | Nome original do arquivo |
| file_path | TEXT | Caminho no disco (`uploads/`) |
| file_hash | TEXT | SHA-256 do conteúdo (deduplicação) |
| status | TEXT | `pending` \| `processing` \| `done` \| `failed` |
| total_linhas | INTEGER | |
| linhas_ok | INTEGER | |
| linhas_erro | INTEGER | |
| erro_msg | TEXT | Mensagem de erro do worker |
| started_at | TIMESTAMPTZ | |
| finished_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

Índice único: `(empresa_id, cd_id, file_hash)` — aplicado na camada de aplicação com filtro `status != 'failed'`.

---

### `smartpick.sp_enderecos`
Dados importados do CSV WMS — um registro por linha do arquivo. Vinculado ao job.

| Coluna | CSV Origem | Tipo | Descrição |
|--------|-----------|------|-----------|
| id | — | BIGSERIAL PK | |
| job_id | — | UUID FK → sp_csv_jobs CASCADE | |
| filial_id | — | INTEGER FK | |
| cod_filial | CODFILIAL (col 0) | INTEGER | |
| codepto | CODEPTO (col 1) | INTEGER | |
| departamento | DEPARTAMENTO (col 2) | TEXT | |
| codsec | CODSEC (col 3) | INTEGER | |
| secao | SECAO (col 4) | TEXT | |
| codprod | CODPROD (col 5) | INTEGER | Chave do produto no WMS |
| produto | PRODUTO (col 6) | TEXT | |
| embalagem | EMBALAGEM (col 7) | TEXT | |
| unidade_master | QTUNITCX (col 8) | INTEGER | Unidades por caixa |
| fora_linha | FORALINHA (col 9) | BOOLEAN | N→false, S→true |
| rua | RUA (col 10) | INTEGER | Endereço picking |
| predio | PREDIO (col 11) | INTEGER | |
| apto | APTO (col 12) | INTEGER | |
| capacidade | CAPACIDADE (col 13) | INTEGER | Capacidade atual em caixas |
| norma_palete | NORMA_PALETE (col 14) | INTEGER | |
| ponto_reposicao | PONTOREPOSICAO (col 15) | INTEGER | |
| classe_venda | CLASSEVENDA (col 16) | CHAR(1) | A/B/C |
| classe_venda_dias | CLASSEVENDA_DIAS (col 17) | INTEGER | Dias target do WMS |
| qt_giro_dia | QTGIRODIA_SISTEMA (col 18) | NUMERIC(12,4) | |
| qt_acesso_90 | QTACESSO_PICKING_PERIODO_90 (col 19) | INTEGER | |
| qt_dias | QT_DIAS (col 20) | INTEGER | |
| qt_prod | QT_PROD (col 21) | INTEGER | |
| qt_prod_cx | QT_PROD_CX (col 22) | INTEGER | |
| med_venda_cx | MED_VENDA_DIAS_CX (col 23) | NUMERIC(12,4) | Média vendas caixas/dia |
| med_venda_dias | MED_VENDA_DIAS (col 24) | NUMERIC(12,4) | Média vendas unidades/dia |
| med_dias_estoque | MED_DIAS_ESTOQUE (col 25) | NUMERIC(12,4) | |
| med_venda_cx_aa | MED_VENDA_DIAS_CX_ANOANT_MESSEG (col 26) | NUMERIC(12,4) | Ano anterior |

**Nota histórica:** QTUNITCX está na coluna 8 (0-based). Bug histórico onde estava ausente deslocava RUA/PREDIO/APTO/CAPACIDADE — corrigido no commit `f4923da`.

---

### `smartpick.sp_propostas`
Proposta de recalibração gerada pelo motor para cada endereço. `delta` é coluna GENERATED.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | BIGSERIAL PK | |
| job_id | UUID FK → sp_csv_jobs CASCADE | |
| endereco_id | BIGINT FK → sp_enderecos CASCADE | |
| empresa_id | UUID FK | |
| cd_id | INTEGER FK | |
| cod_filial | INTEGER | Desnormalizado para leitura rápida |
| codprod | INTEGER | |
| produto | TEXT | |
| rua / predio / apto | INTEGER | |
| classe_venda | CHAR(1) | |
| capacidade_atual | INTEGER | Do CSV |
| sugestao_calibragem | INTEGER | Calculado pelo motor |
| **delta** | INTEGER GENERATED | `sugestao - COALESCE(capacidade_atual, 0)` |
| justificativa | TEXT | Texto explicativo do motor |
| status | TEXT | `pendente` \| `aprovada` \| `rejeitada` |
| aprovado_por | UUID FK → public.users | |
| aprovado_em | TIMESTAMPTZ | |
| sugestao_editada | INTEGER | NULL = não editado pelo gestor |
| editado_por | UUID FK | |
| editado_em | TIMESTAMPTZ | |

**Nota:** `departamento` e `secao` não são armazenadas em sp_propostas — são recuperadas via `LEFT JOIN sp_enderecos` nas queries.

---

### `smartpick.sp_historico`
Ciclo de calibragem por CD. Criado pelo motor, fechado após aprovação.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | BIGSERIAL PK | |
| job_id | UUID FK nullable | NULL se CD nunca importou |
| cd_id | INTEGER FK | |
| empresa_id | UUID FK | |
| total_propostas | INTEGER | Snapshot ao fechar |
| aprovadas / rejeitadas / pendentes | INTEGER | |
| curva_a / curva_b / curva_c | INTEGER | Distribuição por curva |
| executado_por | UUID FK | |
| executado_em | TIMESTAMPTZ | |
| concluido_em | TIMESTAMPTZ | NULL = ainda em andamento |
| status | TEXT | `em_andamento` \| `concluido` \| `nao_executado` |
| observacao | TEXT | |

---

### `smartpick.sp_user_filiais`
Vinculo RBAC de usuário ↔ filiais acessíveis dentro de uma empresa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | SERIAL PK | |
| user_id | UUID FK → public.users | |
| empresa_id | UUID FK → public.companies | |
| filial_id | INTEGER FK nullable → sp_filiais | NULL quando all_filiais = true |
| all_filiais | BOOLEAN | true = acesso irrestrito |

---

## Migrations aplicadas (SmartPick)

| Migration | Conteúdo |
|-----------|----------|
| 100_sp_schema | Schema + extensão pgcrypto + sp_enderecos + índices |
| 101_sp_rbac | `sp_role` enum, `sp_role` em `public.users`, `sp_user_filiais`, `set_updated_at()` trigger function |
| 102_sp_filiais_cds | sp_filiais, sp_centros_dist, FK retroativa em sp_user_filiais |
| 103_sp_motor_params | sp_motor_params, trigger `after insert on sp_centros_dist` para criar params default |
| 104_sp_subscription_limits | sp_subscription_limits |
| 105_sp_csv_jobs_audit | sp_csv_jobs |
| 106_sp_propostas | sp_propostas com `delta GENERATED ALWAYS AS (...) STORED` |
| 107_sp_historico | sp_historico |
| 108_sp_retencao_hash | file_hash + retencao_csv_meses em sp_motor_params |
