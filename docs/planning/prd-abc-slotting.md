# SmartPick — Módulo Curva ABC de Endereços Logísticos
## Documento de Contexto para Planejamento BMAD

---

## 1. VISÃO GERAL DO PROJETO

### 1.1 Produto
**SmartPick** — Motor Inteligente de Recalibragem e Otimização de Picking  
**URL:** smartpick.fbtax.cloud  
**Stack:** Golang (backend) | React (frontend) | PostgreSQL  
**Cliente:** Grupo Jorge Costa  
**ERP:** Winthor / TOTVS  
**Módulo atual:** Calibração de capacidade de endereços de picking  
**Módulo proposto:** Curva ABC de Endereços Logísticos (Slotting Optimization)

### 1.2 Problema que Resolve
O módulo atual do SmartPick responde à pergunta "**quanto cabe**" em cada endereço de picking (calibração vertical). O novo módulo responde à pergunta "**onde deveria estar**" cada produto no CD (calibração horizontal).

Produtos de alta frequência de separação (curva A) que estão alocados em ruas distantes das docas geram:
- Maior tempo de deslocamento do separador
- Maior custo de mão-de-obra por pedido
- Maior tempo de ciclo de separação (order cycle time)
- Congestionamento em rotas de picking desnecessariamente longas
- Fadiga operacional e risco ergonômico

### 1.3 Objetivo de Negócio
Reduzir o tempo de deslocamento do picking em 15-30% através da realocação inteligente de SKUs para endereços compatíveis com sua frequência de separação, utilizando a Curva ABC de endereços como base analítica.

---

## 2. CONTEXTO TÉCNICO (WINTHOR/TOTVS)

### 2.1 Estrutura de Endereços no Winthor
```
Armazém → Rua → Módulo → Nível → Posição
CD01-R05-M03-N02-P01
```

**Premissa do CD do Grupo Jorge Costa:**  
- Ruas de **menor numeração** = mais próximas das docas de carregamento  
- Ruas de **maior numeração** = mais distantes das docas  
- Quanto mais distante, maior o tempo de deslocamento

### 2.2 Tabelas Winthor Envolvidas

| Tabela | Finalidade | Campos-Chave |
|---|---|---|
| `PCMOVIMENTOW` | Histórico de movimentações WMS | `CODPROD`, `CODOPER`, `DATA`, `CODENDERECO`, `QT` |
| `PCENDERECOWMS` | Cadastro de endereços | `CODENDERECO`, `RUA`, `MODULO`, `NIVEL`, `APARTAMENTO`, `CAPACIDADE`, `PONTOREPOSICAO`, `TIPO` |
| `PCPRODUT` | Cadastro de produtos | `CODPROD`, `DESCRICAO`, `QTUNITCX`, `PESOBRUTO`, `ALTURAARM`, `LARGURAARM`, `COMPRIMENTOARM` |
| `PCEST` | Estoque atual | `CODPROD`, `CODFILIAL`, `QTESTGER`, `QTRESERV` |
| `PCPEDC` | Pedidos de venda | `NUMPED`, `CODPROD`, `QT`, `DATA` |

### 2.3 Consulta Base para Frequência de Picks (90 dias)
```sql
SELECT
    m.CODPROD,
    p.DESCRICAO,
    e.RUA,
    e.MODULO,
    e.NIVEL,
    COUNT(*)                          AS FREQ_PICKS,
    SUM(m.QT)                        AS VOL_TOTAL_SEPARADO,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS PCT_PICKS
FROM PCMOVIMENTOW m
JOIN PCENDERECOWMS e ON m.CODENDERECO = e.CODENDERECO
JOIN PCPRODUT p ON m.CODPROD = p.CODPROD
WHERE m.CODOPER = 'S'  -- Saída / Separação
  AND m.DATA >= SYSDATE - 90
  AND e.TIPO = 'P'      -- Endereço de Picking
GROUP BY m.CODPROD, p.DESCRICAO, e.RUA, e.MODULO, e.NIVEL
ORDER BY FREQ_PICKS DESC;
```

### 2.4 Classificação ABC por Frequência
```sql
WITH ranked AS (
    SELECT
        CODPROD,
        FREQ_PICKS,
        SUM(FREQ_PICKS) OVER (ORDER BY FREQ_PICKS DESC) AS ACUM,
        SUM(FREQ_PICKS) OVER ()                          AS TOTAL
    FROM vw_freq_picks_90d
)
SELECT
    CODPROD,
    FREQ_PICKS,
    ROUND(ACUM * 100.0 / TOTAL, 2) AS PCT_ACUM,
    CASE
        WHEN ACUM * 100.0 / TOTAL <= 80  THEN 'A'
        WHEN ACUM * 100.0 / TOTAL <= 95  THEN 'B'
        ELSE 'C'
    END AS CLASSE_ABC
FROM ranked;
```

---

## 3. MODELO DE DADOS DO MÓDULO

### 3.1 Entidades Novas

#### `smartpick_abc_endereco` — Score ABC por endereço/produto
```
id                  UUID        PK
codfilial           INT         FK → filial
codprod             INT         FK → produto
codendereco         VARCHAR     FK → endereço atual
rua_atual           INT         rua atual do produto
freq_picks_90d      INT         total de picks nos últimos 90 dias
pct_picks           DECIMAL     percentual do total de picks
classe_abc          CHAR(1)     A, B, C ou D
rua_sugerida        INT         rua sugerida pela curva ABC
endereco_sugerido   VARCHAR     endereço-destino sugerido
ganho_metros        DECIMAL     economia estimada em metros por pick
status              VARCHAR     PENDENTE | APROVADO | EXECUTADO | IGNORADO
data_calculo        TIMESTAMP   data do cálculo
data_execucao       TIMESTAMP   data da movimentação física
```

#### `smartpick_zona_abc` — Mapeamento de zonas do CD
```
id                  UUID        PK
codfilial           INT         FK → filial
rua_inicio          INT         rua inicial da zona
rua_fim             INT         rua final da zona
zona                CHAR(1)     A, B, C ou D
distancia_doca_m    DECIMAL     distância média até a doca (metros)
capacidade_total    INT         total de endereços de picking na zona
capacidade_usada    INT         endereços ocupados
```

#### `smartpick_abc_historico` — Histórico de movimentações sugeridas
```
id                  UUID        PK
codfilial           INT         FK
codprod             INT         FK
endereco_origem     VARCHAR     de onde saiu
endereco_destino    VARCHAR     para onde foi
classe_abc_origem   CHAR(1)     classe no momento da movimentação
classe_abc_destino  CHAR(1)     zona de destino
ganho_metros        DECIMAL     ganho calculado
executado_por       VARCHAR     usuário que executou
data_execucao       TIMESTAMP
```

### 3.2 Regras de Negócio

| # | Regra | Descrição |
|---|---|---|
| RN01 | Frequência sobre Volume | A classificação ABC usa COUNT de picks, não SUM de quantidade separada |
| RN02 | Janela de 90 dias | O cálculo usa os últimos 90 dias corridos de movimentação |
| RN03 | Zona A = Ruas 01-10 | Configurável por filial. Ruas mais próximas das docas |
| RN04 | Zona B = Ruas 11-25 | Configurável por filial |
| RN05 | Zona C = Ruas 26-40 | Configurável por filial |
| RN06 | Zona D = Ruas 41+ | Sem movimentação ou giro mínimo |
| RN07 | Capacidade compatível | O endereço-destino deve ter capacidade ≥ capacidade calibrada do produto |
| RN08 | Tipo compatível | Respeitar tipo de armazenagem (pallet, fracionado, caixa fechada) |
| RN09 | Anti-congestionamento | Não alocar mais de 60% dos SKUs classe A na mesma rua |
| RN10 | Duplo alerta | Se calibração + zona estão erradas, gerar alerta combinado |
| RN11 | Sazonalidade | Permitir override manual para produtos sazonais |
| RN12 | Peso ergonômico | Itens > 15kg devem ficar em nível 1 (chão), independente da classe ABC |

---

## 4. FASES DE IMPLEMENTAÇÃO

### FASE 1 — Diagnóstico e Heatmap (Sprint 1-2)

**Objetivo:** Visibilidade. O gestor do CD e o CEO enxergam onde estão os problemas.

**Entregas:**
- [ ] Extração automatizada dos picks dos últimos 90 dias (query PCMOVIMENTOW)
- [ ] Cálculo da Curva ABC por produto baseado em frequência de picks
- [ ] Mapeamento de zonas do CD (A, B, C, D) por faixa de ruas
- [ ] Heatmap 2D das ruas (intensidade de picks por rua)
- [ ] Visualização 3D do CD para o CEO (ruas, módulos, níveis, coloridos por zona ABC)
- [ ] Lista de "Ofensores de Distância": SKUs classe A em zonas C/D
- [ ] Dashboard com KPIs: total de picks, % por zona, distância média estimada
- [ ] Importação via CSV (mesmo formato atual do SmartPick)

**Critérios de aceite:**
- O painel mostra corretamente a distribuição ABC por rua
- O heatmap destaca visualmente as ruas com maior volume de picks
- A visualização 3D renderiza o layout real do CD com cores por zona
- A lista de ofensores é exportável em CSV/PDF

### FASE 2 — Motor de Sugestão de Realocação (Sprint 3-4)

**Objetivo:** Inteligência. O sistema sugere movimentações com cálculo de ganho.

**Entregas:**
- [ ] Algoritmo de matching: para cada ofensor, encontrar endereço-destino na zona correta
- [ ] Cálculo de ganho em metros por pick (distância atual vs. distância sugerida)
- [ ] Priorização por impacto: ordenar sugestões por (freq_picks × ganho_metros)
- [ ] Validação de compatibilidade: capacidade, tipo de armazenagem, restrições
- [ ] Tela de aprovação: gestor aprova/rejeita cada sugestão
- [ ] Geração de ordem de movimentação para execução no WMS
- [ ] Relatório de impacto projetado: "Se executar tudo, economia de X metros/dia"
- [ ] Regra anti-congestionamento: distribuir classe A entre múltiplas ruas

**Critérios de aceite:**
- O motor sugere endereços compatíveis (nunca sugere endereço sem capacidade)
- O ganho em metros é calculado corretamente
- O gestor consegue aprovar/rejeitar em lote
- O sistema respeita a regra de anti-congestionamento (RN09)

### FASE 3 — Ciclo Contínuo e Integração (Sprint 5-6)

**Objetivo:** Sustentabilidade. O slotting vira um processo vivo, não um projeto pontual.

**Entregas:**
- [ ] Recálculo automático da curva ABC a cada 30 dias (configurável)
- [ ] Alerta automático quando um SKU muda de classe (ex: B→A ou A→C)
- [ ] Integração com módulo de calibração existente (alerta duplo: capacidade + zona)
- [ ] Histórico de movimentações com auditoria completa
- [ ] Dashboard de antes/depois: comparar KPIs pré e pós-realocação
- [ ] Relatório executivo mensal para o CEO (PDF automático)
- [ ] API para integração futura com Winthor (PCENDERECOWMS.CAPACIDADE + zona)

**Critérios de aceite:**
- O recálculo roda sem intervenção manual
- Alertas são enviados ao gestor quando há mudança de classe
- O relatório PDF é gerado automaticamente com comparativo temporal

---

## 5. MÉTRICAS DE SUCESSO

| KPI | Baseline | Meta Fase 1 | Meta Fase 3 |
|---|---|---|---|
| Distância média por pick (metros) | Medir atual | Visibilidade | Redução de 15-30% |
| % de SKUs classe A em zona A | Medir atual | Visibilidade | > 80% |
| % de SKUs classe A em zona C/D (ofensores) | Medir atual | Visibilidade | < 5% |
| Tempo médio de separação por pedido | Medir atual | Visibilidade | Redução de 20% |
| Picks por hora por operador | Medir atual | Visibilidade | Aumento de 25% |
| Frequência de recalibragem de zona | Manual/nunca | — | Automática mensal |

---

## 6. STACK TÉCNICA

| Componente | Tecnologia |
|---|---|
| Backend / API | **Golang** (net/http nativo, padrão do projeto) |
| Frontend / Dashboards | **React + TypeScript** (mesmo stack do SmartPick atual) |
| Visualização 3D | **Three.js** (instalar: `npm install three @types/three`) |
| Banco de dados | **PostgreSQL** |
| Heatmap 2D | **Recharts** (já instalado no projeto) |
| Relatórios PDF | Mesmo motor PDF do SmartPick atual (`sp_pdf.go`) |
| Importação de dados | CSV (mesmo formato atual) |
| Deploy | smartpick.fbtax.cloud (mesmo domínio) |

---

## 7. NOTAS DE INTEGRAÇÃO COM O PROJETO ATUAL

### Rotas novas (padrão `/api/sp/...` com `withSP` middleware)
```
POST /api/sp/abc/zonas              → configura faixas de ruas por filial
GET  /api/sp/abc/zonas              → retorna configuração de zonas
POST /api/sp/abc/recalcular         → dispara cálculo ABC manual
GET  /api/sp/abc/dashboard          → KPIs do painel
GET  /api/sp/abc/ruas               → dados por rua (alimenta o 3D)
GET  /api/sp/abc/sugestoes          → lista sugestões pendentes
GET  /api/sp/abc/sugestoes/resumo   → impacto projetado total
PUT  /api/sp/abc/sugestoes/:id      → aprovar/rejeitar individual
POST /api/sp/abc/sugestoes/lote     → aprovar/rejeitar em lote
```

### Migrations
- `114_sp_abc_zonas.sql` → tabela `smartpick_zona_abc`
- `115_sp_abc_endereco.sql` → tabela `smartpick_abc_endereco`
- `116_sp_abc_historico.sql` → tabela `smartpick_abc_historico`

### Arquivo de handler
- `backend/handlers/sp_abc.go` (novo)

### Página frontend
- `frontend/src/pages/SpCurvaABC.tsx` (novo)
- Rota: `/abc` com proteção `gestor_filial`
- Item no sidebar: entre Histórico e Reincidência

### Dependência crítica (dados Winthor)
Antes de iniciar o Sprint 1, verificar `erp-bridge-aws/` — pode já ter conexão Oracle/Winthor.
- Se sim: usar a ponte existente
- Se não: Fase 1 começa via CSV upload (template novo, mesmo uploader atual)

---

## 8. RISCOS E MITIGAÇÕES

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| Dados de picks incompletos no PCMOVIMENTOW | Alto | Média | Validar cobertura dos dados antes do diagnóstico |
| Resistência operacional à mudança de endereços | Alto | Alta | Piloto em 1 rua, mostrar ganhos mensuráveis |
| Layout do CD não é linear (ruas não sequenciais) | Médio | Baixa | Permitir configuração manual de distância por rua |
| Congestionamento ao concentrar classe A | Alto | Média | Regra RN09 de distribuição máxima por rua |
| Sazonalidade distorce a curva ABC | Médio | Média | Permitir override manual + janela configurável |

---

## 9. GLOSSÁRIO

| Termo | Definição |
|---|---|
| **Slotting** | Alocação estratégica de produtos nos endereços do CD baseada em dados |
| **Golden Zone** | Zona de ouro — endereços mais próximos das docas e na altura ergonômica ideal |
| **Ofensor de Distância** | SKU de alta frequência alocado em rua distante da doca |
| **Curva ABC** | Classificação de produtos por importância relativa (frequência de picks) |
| **Pick** | Ato de separar um item de seu endereço de picking |
| **Heatmap** | Mapa de calor visual mostrando intensidade de atividade por endereço |
| **Anti-congestionamento** | Regra que distribui SKUs classe A entre múltiplas ruas para evitar gargalo |
| **Calibração vertical** | Definir quanto cabe no endereço (módulo atual do SmartPick) |
| **Calibração horizontal** | Definir onde o produto deveria estar (módulo proposto) |

---

## 10. REFERÊNCIAS DE MERCADO

- **Método ABC Velocity Slotting** — padrão mundial para distribuição atacadista
- **Golden Zone Storage** (Petersen et al., 2005) — modelo acadêmico de referência
- **Forward Pick / Reserve Model** — usado por Amazon, DHL, XPO Logistics
- **Dynamic Slotting** — prática de revisão contínua adotada por CDs de alta performance

---

*Documento gerado em: 22/04/2026*  
*Projeto: SmartPick — fbtax.cloud*  
*Cliente: Grupo Jorge Costa*  
*Versão: 1.1*
