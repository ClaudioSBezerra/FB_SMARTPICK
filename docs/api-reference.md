# API Reference — SmartPick

> Todos os endpoints estão sob o prefixo `/api/sp/` e exigem JWT válido via `Authorization: Bearer <token>` + header `X-Company-ID` (UUID da empresa ativa).
> Autenticação e seleção de empresa são tratadas pelo `SmartPickAuthMiddleware`.

---

## Autenticação (herdada do FB_APU02)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/auth/login` | Login com email + senha → retorna JWT |
| POST | `/api/auth/logout` | Invalida o token (blacklist) |
| POST | `/api/auth/change-password` | Troca senha do usuário autenticado |
| POST | `/api/auth/forgot-password` | Envia link de reset por e-mail |
| POST | `/api/auth/reset-password` | Conclui reset de senha via token |
| GET  | `/api/auth/me` | Dados do usuário autenticado |

---

## Filiais e CDs (`sp_ambiente.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/filiais` | `somente_leitura` | Lista filiais da empresa |
| POST | `/api/sp/filiais` | `gestor_geral` | Cria filial |
| GET | `/api/sp/filiais/{id}` | `somente_leitura` | Detalhe de filial |
| PUT | `/api/sp/filiais/{id}` | `gestor_geral` | Atualiza filial |
| DELETE | `/api/sp/filiais/{id}` | `admin_fbtax` | Remove filial |
| GET | `/api/sp/filiais/{id}/cds` | `somente_leitura` | Lista CDs da filial |
| POST | `/api/sp/filiais/{id}/cds` | `gestor_geral` | Cria CD na filial |
| GET | `/api/sp/cds/{id}` | `somente_leitura` | Detalhe de CD |
| PUT | `/api/sp/cds/{id}` | `gestor_geral` | Atualiza CD |
| DELETE | `/api/sp/cds/{id}` | `admin_fbtax` | Remove CD |
| POST | `/api/sp/cds/{id}/duplicar` | `gestor_geral` | Duplica CD (copia params motor) |
| GET | `/api/sp/cds/{id}/params` | `somente_leitura` | Parâmetros do motor do CD |
| PUT | `/api/sp/cds/{id}/params` | `gestor_geral` | Atualiza parâmetros do motor |
| GET | `/api/sp/plano` | `somente_leitura` | Plano e limites da empresa |
| PUT | `/api/sp/plano` | `admin_fbtax` | Atualiza plano/limites |

### Parâmetros do motor (`SpMotorParamsRequest`)
```json
{
  "dias_analise": 90,
  "curva_a_max_est": 7,
  "curva_b_max_est": 15,
  "curva_c_max_est": 30,
  "fator_seguranca": 1.10,
  "curva_a_nunca_reduz": true,
  "min_capacidade": 1,
  "retencao_csv_meses": 6
}
```

---

## Upload e Jobs CSV (`sp_csv.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| POST | `/api/sp/csv/upload` | `gestor_filial` | Upload de arquivo CSV/TXT (multipart) |
| GET | `/api/sp/csv/jobs` | `somente_leitura` | Lista jobs da empresa (query: `cd_id`, `limit`) |
| GET | `/api/sp/csv/jobs/{id}` | `somente_leitura` | Status de job específico |

**Upload — campos do form:**
- `cd_id` (int) — obrigatório
- `filial_id` (int) — obrigatório
- `arquivo` (file) — `.csv` ou `.txt`; max 50 MB

**Deduplicação por conteúdo:** SHA-256 do arquivo. Se hash já existe para o mesmo CD/empresa com `status != 'failed'`, retorna **409 Conflict**.

**Campos de resposta do job:**
```json
{
  "id": "uuid",
  "filename": "string",
  "status": "pending|processing|done|failed",
  "total_linhas": 5000,
  "linhas_ok": 4998,
  "linhas_erro": 2,
  "erro_msg": "...",
  "started_at": "ISO8601",
  "finished_at": "ISO8601",
  "created_at": "ISO8601",
  "cd_id": 1,
  "filial_id": 1
}
```

---

## Motor de Calibragem (`sp_motor.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| POST | `/api/sp/motor/calibrar` | `gestor_geral` | Executa motor para um job `done` |

**Body:**
```json
{ "job_id": "uuid" }
```

O motor roda em **background goroutine**. Retorna imediatamente com 200. É **idempotente** — retorna 409 se propostas já existem para o job.

**Fórmula:**
```
sugestao = ⌈ ⌈giroDia / unidade_master⌉ × diasClasse × fatorSeguranca ⌉
```

---

## Dashboard de Propostas (`sp_propostas.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/propostas` | `somente_leitura` | Lista propostas com filtros |
| GET | `/api/sp/propostas/resumo` | `somente_leitura` | Contadores por tipo/status |
| PUT | `/api/sp/propostas/{id}` | `gestor_geral` | Edição inline de sugestao_editada |
| POST | `/api/sp/propostas/{id}/aprovar` | `gestor_geral` | Aprova proposta individual |
| POST | `/api/sp/propostas/{id}/rejeitar` | `gestor_geral` | Rejeita proposta individual |
| POST | `/api/sp/propostas/aprovar-lote` | `gestor_geral` | Aprovação em lote |

**Query params de `/api/sp/propostas`:**
- `cd_id` — filtra por CD
- `job_id` — filtra por job
- `tipo` — `falta` | `espaco` | `calibrado` | `curva_a_mantida`
- `status` — `pendente` | `aprovada` | `rejeitada`
- `limit` — max 1000, default 200

**Semântica de tipo:**

| tipo | Filtro SQL |
|------|-----------|
| `falta` | `delta > 0` |
| `espaco` | `delta < 0` |
| `calibrado` | `delta = 0 AND NOT (classe_venda='A' AND justificativa LIKE '%mantida%')` |
| `curva_a_mantida` | `classe_venda='A' AND delta=0 AND justificativa LIKE '%mantida%'` |

**Resposta de resumo:**
```json
{
  "total_pendente": 100,
  "total_aprovada": 50,
  "total_rejeitada": 10,
  "falta_pendente": 60,
  "espaco_pendente": 40,
  "calibrado_total": 200,
  "curva_a_mantida": 15
}
```

**Body de aprovação em lote:**
```json
{ "job_id": "uuid" }
// ou
{ "cd_id": 1, "tipo": "falta" }
```

---

## PDF Operacional (`sp_pdf.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/pdf/calibracao` | `somente_leitura` | Gera e baixa PDF de propostas aprovadas |

**Query params:** `job_id=UUID` ou `cd_id=INT`

PDF retornado como `application/pdf` com `Content-Disposition: attachment`. Layout: uma página por RUA, colunas: Curva | Cód. | Produto | Prédio | Apto | Cap.Atual | Nova Cap | Ação. Linha de obs. em branco após cada produto para anotação manual no Winthor.

---

## Histórico e Compliance (`sp_historico.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/historico` | `somente_leitura` | Lista ciclos de calibragem |
| POST | `/api/sp/historico/{id}/fechar` | `gestor_geral` | Fecha ciclo manualmente |
| GET | `/api/sp/historico/compliance` | `somente_leitura` | Indicadores por CD |

**Campos de compliance por CD:**
```json
{
  "cd_id": 1,
  "cd_nome": "string",
  "ultima_calibragem": "ISO8601",
  "dias_desde_ultima": 15,
  "ultimo_status": "concluido",
  "total_ciclos": 3,
  "ultimo_import_em": "ISO8601",
  "propostas_pendentes": 5,
  "status_compliance": "ok|atencao|critico|aguardando_motor|nunca_iniciado",
  "alerta": false
}
```

**Regras de status_compliance:**
- `nunca_iniciado` → nenhum import
- `aguardando_motor` → tem import, motor nunca rodou (< 7 dias)
- `critico` → motor nunca rodou + import há > 7 dias, OU última calibragem > 60 dias, OU proposta pendente há > 14 dias
- `atencao` → última calibragem > 30 dias OU proposta pendente há > 7 dias
- `ok` → todos os critérios satisfeitos

---

## Reincidência (`sp_reincidencia.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/reincidencia` | `somente_leitura` | Produtos com calibragem sugerida mas nunca ajustados no Winthor |

**Query params:** `cd_id`, `min_ciclos` (padrão 2)

Retorna produtos que aparecem em ≥ N importações com a **mesma capacidade** e ao menos uma proposta com `delta != 0`.

---

## Usuários (`sp_usuarios.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/usuarios` | `somente_leitura` | Lista usuários da empresa |
| POST | `/api/sp/usuarios` | `admin_fbtax` | Cria usuário |
| PUT | `/api/sp/usuarios/{id}` | `admin_fbtax` | Atualiza sp_role + nome |
| DELETE | `/api/sp/usuarios/{id}` | `admin_fbtax` | Remove usuário |
| PUT | `/api/sp/usuarios/{id}/filiais` | `admin_fbtax` | Define filiais acessíveis |
| GET | `/api/sp/usuarios/{id}/vinculos` | `admin_fbtax` | Vínculos multi-empresa |
| PUT | `/api/sp/usuarios/{id}/vinculos` | `admin_fbtax` | Salva vínculos multi-empresa |

---

## Perfil SmartPick (`smartpick_auth.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/me` | — (qualquer autenticado) | Retorna `sp_role` do usuário na empresa ativa |

**Resposta:** `{ "sp_role": "gestor_filial" }`

Usado pelo frontend (AuthContext) para controlar visibilidade de módulos no AppRail.

---

## Painel de Resultados (`sp_resultados.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| GET | `/api/sp/resultados` | `gestor_filial` | KPIs contratuais dos últimos 4 ciclos por CD |
| GET | `/api/sp/resultados?cd_id=X` | `gestor_filial` | Filtra por CD específico (validação de ownership incluída) |

**Resposta `GET /api/sp/resultados`:**
```json
{
  "empresa": {
    "job_id": "",
    "ciclo_num": 0,
    "total_enderecos": 1240,
    "calibrados_ok": 892,
    "pct_calibrados": 71.9,
    "ofensores_falta_ab": 34,
    "caixas_ociosas": 1580,
    "caixas_aprovadas": 1106,
    "pct_realocado": 70.0,
    "acessos_emergencia": 4820,
    "acessos_total": 38400
  },
  "cds": [
    {
      "cd_id": 1,
      "cd_nome": "CD Fortaleza",
      "filial_nome": "Filial CE",
      "ciclos": [
        {
          "job_id": "uuid-do-job",
          "ciclo_num": 1,
          "criado_em": "2026-04-09T14:00:00Z",
          "total_enderecos": 620,
          "calibrados_ok": 446,
          "pct_calibrados": 71.9,
          "ofensores_falta_ab": 17,
          "caixas_ociosas": 790,
          "caixas_aprovadas": 553,
          "pct_realocado": 70.0,
          "acessos_emergencia": 2410,
          "acessos_total": 19200
        }
      ]
    }
  ]
}
```
- `empresa` é `null` quando a empresa não tem nenhum CD com jobs `done`
- `ciclos` tem no máximo 4 itens; `ciclo_num=1` é o mais recente
- `pct_calibrados` e `pct_realocado` são calculados em Go (não vêm do SQL)

---

## Administração (`sp_admin.go`)

| Método | Endpoint | Perfil mínimo | Descrição |
|--------|----------|---------------|-----------|
| DELETE | `/api/sp/admin/limpar-calibragem` | `admin_fbtax` | Apaga TODOS os dados de calibragem da empresa |
| POST | `/api/sp/admin/purgar-csv-antigos` | `gestor_geral` | Remove CSVs mais antigos que retencao_csv_meses |

---

## Convenções

- Todas as respostas de erro: `text/plain` com status HTTP adequado
- Sucesso com corpo: `application/json`
- Timestamps: ISO 8601 UTC (`"2026-04-09T14:30:00Z"`)
- Datas formatadas para exibição: `"DD/MM/YYYY HH24:MI"` (TO_CHAR PostgreSQL)
- Multi-tenant: `empresa_id` sempre derivado do JWT + `X-Company-ID`; nunca aceito no body
