---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
date: 2026-04-06
author: Claudio
---

# Product Brief: FB_SMARTPICK

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

O FB_SMARTPICK é um módulo SaaS da plataforma fbtax.cloud destinado a distribuidores
que utilizam o WMS Winthor (Totvs) ou SAP S4/HANA. O sistema automatiza o processo de
recalibração de endereços de picking, substituindo um processo manual, esporádico e sem
rastreabilidade por um fluxo orientado a dados — com propostas inteligentes baseadas em
curva ABC, histórico de vendas e perfil de armazenagem.

O produto serve dois perfis de usuário distintos: o **Gestor de CD** (visão operacional
de ação imediata) e o **CEO/Diretoria** (visão estratégica para reuniões com fornecedores
e indústrias). O primeiro cliente contratado é o **Grupo JC**, com 9 CDs a serem
integrados até o final de 2026.

O SmartPick integra-se operacionalmente ao **FB_FAROL** — painel semáforo de performance
comercial para 3.000 RCAs — compartilhando base de dados PostgreSQL, pois juntos formam
a cadeia de visibilidade completa: picking subcalibrado → queda de vendas → produto
crítico no Farol → ação corretiva do CEO com o fornecedor.

A plataforma fbtax.cloud posiciona-se como o **Sistema Nervoso Digital do Distribuidor
Brasileiro**, unindo fiscal/tributário (reforma tributária como macro tailwind),
eficiência logística e inteligência comercial em um único painel SaaS.

---

## Core Vision

### Problem Statement

Distribuidores que operam com WMS Winthor ou SAP S4/HANA dependem de calibragem
manual de endereços de picking — realizada esporadicamente (~1x/mês), sem algoritmo
de suporte, sem rastreamento de compliance e sem visibilidade para a liderança. A
ausência de um sistema orientado a dados gera dois tipos de ofensores crônicos:

- **Ofensores de Falta:** Endereços calibrados abaixo do giro real, causando rupturas
  no picking (ex: calibrado em 50 cx, girando 70 cx/dia).
- **Ofensores de Espaço:** Endereços supercalibrados que imobilizam área útil do CD
  sem necessidade operacional.

Paralelamente, gestores e diretores não têm visibilidade consolidada de quais
sugestões de calibragem foram ou não executadas — inviabilizando avaliação de
desempenho e tomada de decisão estratégica com fornecedores.

### Problem Impact

- Rupturas frequentes no picking comprometem o nível de serviço e as vendas
- Desperdício de área útil com produtos de baixo giro supercalibrados
- Gestores não têm pressão de accountability — sugestões ignoradas sem consequência
- CEO entra em reuniões com fornecedores/indústrias sem dados objetivos de performance
- Sem histórico de propostas vs. execuções, é impossível avaliar o time logístico
- A cadeia causal picking → venda → RCA não é visível para nenhum nível da organização

### Why Existing Solutions Fall Short

O Winthor possui calibragem manual baseada em giro diário, mas:
- Não propõe recalibração automaticamente com algoritmos de curva ABC
- Não rastreia histórico de propostas vs. execuções (compliance)
- Não diferencia endereço pallet vs. fracionado nas sugestões
- Não considera histórico multi-anual na fórmula de calibragem
- Não gera relatórios de não-acatamento para avaliação de desempenho
- Não oferece visão executiva para reuniões com fornecedores

O SAP S4/HANA, embora robusto, não entrega essa inteligência específica para a
realidade operacional de distribuidores brasileiros de médio/grande porte.

### Proposed Solution

O FB_SMARTPICK é uma aplicação web SaaS, integrada ao painel fbtax.cloud
(notebook/tablet), com duas visões complementares:

**Operations View — Gestor de CD:**
1. Importação via CSV exportado do Winthor ou SAP S4/HANA
2. Dashboard de urgência: endereços críticos primeiro, com % de ofensa e ação imediata
3. Cálculo de recalibração: `CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX`, considerando
   perfil do endereço (pallet/fracionado), caixa fechada vs. fracionado e histórico
   multi-anual
4. Histórico de até 4 propostas anteriores por endereço para avaliação de compliance
5. Registro de propostas não executadas que retornam na próxima carga como indicador
   de desempenho do gestor/equipe

**Executive/Supplier View — CEO em reunião com fornecedores:**
1. Visão limpa e visual por produto/SKU por CD
2. Indicadores de calibragem, giro e compliance histórico
3. Narrativa de dados pronta para apresentação a indústrias/fornecedores
4. Integrada ao FB_FAROL: visão de semáforo (Verde/Laranja/Vermelho) por SKU,
   região e empresa do Grupo

### Key Differentiators

- **Zero dependência de API:** integração via CSV funciona com qualquer versão do
  Winthor e SAP S4/HANA, eliminando barreiras de adoção
- **Accountability logística:** histórico de até 4 propostas por endereço expõe
  padrões de resistência — primeiro sistema de avaliação de desempenho de equipe
  logística baseado em compliance de calibragem
- **Dual persona nativo:** mesma base de dados, duas visões otimizadas —
  operacional (gestor) e estratégica (CEO/fornecedor)
- **Cadeia causal completa:** integração com FB_FAROL conecta picking subcalibrado →
  queda de venda do RCA → produto crítico → ação corretiva do CEO com a indústria
- **Anti-desfragmentação inteligente:** não propõe redução para produtos curva A
  (diário, 2d, 7d) sem necessidade real
- **Plataforma unificada:** mesmo painel fbtax.cloud que gerencia apuração e simulação
  fiscal — menos ferramentas, mais contexto, um único login
- **Macro tailwind:** reforma tributária posiciona o fbtax.cloud como parceiro
  estratégico indispensável para distribuidores do lucro presumido e real
- **Ativo de dados único:** 9 CDs + 3.000 RCAs em 12 meses criam inteligência de
  mercado sem precedente no segmento de distribuidores brasileiro

---

## Target Users

### Primary Users

---

#### Persona 1 — Carlos, Gestor de CD (SmartPick)

**Perfil:**
Responsável pela operação logística de 1 ou mais CDs do Grupo JC.
Trabalha em ambiente de armazém, acessa o sistema em notebook no escritório
do CD. Conhece o Winthor profundamente, mas não tem ferramentas analíticas —
seu processo atual é manual e baseado em experiência.

**Problema que enfrenta:**
- Calibra endereços de picking esporadicamente, sem dados que orientem prioridade ou urgência
- Não tem visibilidade de quantos endereços estão ofendendo por falta ou excesso
- Não consegue justificar para a diretoria por que há rupturas no picking
- O processo de calibragem depende de ele lembrar de fazer — não há gatilho automático

**Como usa o SmartPick:**
1. Faz upload do CSV exportado do Winthor
2. Visualiza dashboard de urgência: endereços críticos com % de ofensa
3. Decide quais endereços recalibrar e quais adiar
4. Gera relatório PDF com as recalibragens aprovadas
5. Entrega o PDF ao operador de CD para execução física
6. Na próxima carga, vê quais sugestões anteriores não foram executadas

**Momento de valor ("aha!"):**
Quando vê pela primeira vez o percentual exato de ofensa por endereço e percebe
que tem 23 endereços críticos que nunca apareceriam no seu processo manual.

**Sucesso:**
Zero rupturas de picking causadas por subcalibração. Equipe executando
as recalibragens dentro do prazo sugerido.

---

#### Persona 2 — Roberto, Supervisor de Vendas (Farol)

**Perfil:**
Lidera uma equipe de RCAs em uma filial do Grupo JC. Acessa o sistema por
notebook, tablet ou smartphone — frequentemente em campo ou em reuniões rápidas.
Precisa de visão ágil da sua equipe sem se perder em relatórios densos.

**Problema que enfrenta:**
- Não tem visibilidade em tempo real de quais produtos/regiões sua equipe está deixando cair
- Descobre problemas de performance tardiamente — só no fechamento do mês
- Não consegue agir preventivamente para corrigir desvios de RCAs específicos

**Como usa o Farol:**
1. Acessa seu painel limitado à sua equipe (sua filial, seus RCAs)
2. Vê o semáforo de produtos: Verde (OK), Laranja (atenção), Vermelho (crítico)
3. Identifica qual RCA está com quais produtos em queda
4. Age preventivamente — contato com RCA antes do problema virar ruptura
5. Acompanha evolução após intervenção

**Visão de acesso:** Tenant → Grupo → Empresa → Filial → seus Supervisores → seus RCAs
*(sem acesso a dados de outros supervisores ou filiais)*

**Dispositivos:** notebook, tablet e smartphone (visão responsiva, limitada à sua equipe)

**Momento de valor:**
Quando consegue intervir com um RCA 2 semanas antes do fechamento e reverter
um produto vermelho para laranja — algo impossível sem o Farol.

**Sucesso:**
Redução de produtos vermelhos na sua equipe mês a mês. RCAs atingindo metas.

---

#### Persona 3 — Paulo, CEO do Grupo JC (SmartPick + Farol)

**Perfil:**
CEO do grupo, acessa a plataforma em notebook ou tablet. Tem visão consolidada
de todas as empresas, filiais e CDs do grupo. Usa o fbtax.cloud em reuniões
estratégicas com fornecedores/indústrias para apresentar dados de performance
de SKUs específicos.

**Problema que enfrenta:**
- Entra em reuniões com fornecedores sem dados objetivos de performance por produto
- Não tem visibilidade do impacto logístico (picking) na performance comercial (RCA)
- Não consegue cobrar gestores de CD e supervisores com dados concretos

**Como usa a plataforma:**
1. Acessa dashboard executivo do Farol: semáforo por SKU, região, empresa do grupo
2. Identifica produtos críticos antes de reuniões com a indústria
3. Usa SmartPick Executive View para mostrar ao fornecedor histórico de calibragem e compliance
4. Cobra resultados de gestores de CD e supervisores com dados rastreáveis

**Visão de acesso:** Tenant completo — todas as empresas, filiais, supervisores, RCAs e CDs

**Dispositivos:** notebook e tablet (visão executiva, apresentável em reuniões)

**Momento de valor:**
Quando chega a uma reunião com a Mars e apresenta dados precisos de por que o
Tic Tac está vermelho em SP — picking subcalibrado há 3 meses, sugestões
ignoradas pela equipe — e negocia com o fornecedor a partir de fatos.

**Sucesso:**
Decisões estratégicas baseadas em dados. Redução de produtos críticos no
consolidado do grupo. Fornecedores reconhecendo a gestão profissional da operação.

---

### Secondary Users

#### Persona 4 — Diego, Operador de CD (SmartPick — usuário indireto)

**Perfil:**
Operador físico do CD. **Não acessa o SmartPick diretamente.**
Recebe o relatório PDF gerado pelo Gestor de CD com a lista de recalibragens
aprovadas. Executa a movimentação física dos itens e alimenta manualmente
o Winthor com as novas calibragens.

**Importância para o produto:**
É o elo entre a decisão digital (SmartPick) e a execução física (Winthor).
O PDF precisa ser claro, objetivo e operacionalmente executável — com endereço
origem, endereço destino, produto e nova capacidade.

**Restrição de segurança:**
O SmartPick **nunca escreve diretamente no Winthor**. O operador é o agente
humano de validação e execução — decisão intencional de segurança de dados.

---

#### Persona 5 — Admin da Plataforma (fbtax.cloud)

**Perfil:**
Responsável pelo onboarding de novos tenants, configuração de hierarquias
(Tenant → Grupo → Empresas → Filiais) e gestão de acessos de usuários.
Inicialmente da equipe FBTax; pode evoluir para admin do próprio tenant.

**Papel crítico no MVP:**
- Configura a estrutura multi-tenant do cliente
- Garante que os uploads de CSV/TXT estejam mapeados corretamente
- Gerencia permissões por nível hierárquico

---

### User Journey — SmartPick (Gestor de CD)

| Etapa | Ação | Canal | Resultado esperado |
|---|---|---|---|
| **Carga** | Upload do CSV do Winthor | Web (notebook) | Sistema valida e processa dados |
| **Triagem** | Visualiza endereços críticos por % ofensa | Dashboard urgência | Prioridade clara de ação |
| **Decisão** | Aprova/adia recalibragens por endereço | Interface web | Lista de ações confirmadas |
| **Execução** | Gera PDF da lista de recalibragens | PDF export | Documento operacional pronto |
| **Handoff** | Entrega PDF ao operador de CD | Físico/impresso | Operador executa movimentação |
| **Rastreamento** | Próxima carga mostra não-executados | Dashboard | Accountability da equipe |

---

### User Journey — Farol (Supervisor de Vendas)

| Etapa | Ação | Canal | Resultado esperado |
|---|---|---|---|
| **Acesso** | Login no fbtax.cloud/farol | Notebook/tablet/smartphone | Painel da sua equipe |
| **Visão** | Semáforo por produto/RCA | Dashboard hierárquico | Identifica críticos rapidamente |
| **Drill-down** | Clica no produto vermelho | Detalhe por RCA | Vê qual RCA e qual região |
| **Ação** | Contata RCA e define plano | Fora do sistema | Intervenção preventiva |
| **Acompanhamento** | Retorna na próxima semana | Dashboard | Verifica se houve melhora |

---

## Success Metrics

### Sucesso do Usuário

**SmartPick — Gestor de CD:**
- Redução do número de interrupções por espera de resuprimento no picking
  (separador vai ao endereço e encontra área vazia ou insuficiente)
- % de endereços de picking com calibragem dentro da faixa ideal após cada ciclo
- % de sugestões de recalibração aceitas e executadas pelo time do CD
- Redução de ocorrências de "ofensores de falta" ciclo a ciclo
- Tempo médio entre upload do CSV e emissão do PDF de recalibração (< 10 min)

**Farol — Supervisor de Vendas:**
- % de RCAs atingindo seus objetivos por período (por filial, empresa, indústria)
- Redução de produtos no status Vermelho ao longo do tempo (mês a mês)
- Tempo médio de resposta do supervisor a um alerta Vermelho
- % de produtos que saem do Vermelho para Laranja ou Verde após intervenção

**Farol — CEO:**
- Visibilidade consolidada de todas as empresas do grupo em < 30 segundos
- Número de reuniões com fornecedores realizadas com dados do fbtax.cloud
- Redução de produtos críticos (Vermelho) no consolidado do grupo trimestre a trimestre

---

### Business Objectives

**Curto prazo (0–6 meses):**
- Concluir e entregar SmartPick + Farol para o Grupo JC com todos os 9 CDs integrados
- Onboarding de pelo menos 3 CDs do Grupo JC no SmartPick ainda no Q2 2026
- 3.000 RCAs ativos no Farol até o final de 2026
- Zero churning nos clientes ativos

**Médio prazo (6–12 meses):**
- Ativar o efeito promoter do CEO do Grupo JC junto à associação (400+ membros)
- Converter 5% da associação (≥ 20 novos tenants) até o final de 2026
- Lançar pelo menos 1 novo módulo demandado pelo Grupo JC após a conclusão dos 2 módulos atuais
- Expandir Grupo FC para além do FB_APU02 (SmartPick ou Farol)

**Longo prazo (12+ meses):**
- Tornar-se a plataforma de referência para distribuidores de lucro presumido e real no Brasil
- Ativo de dados: 50+ CDs e 10.000+ RCAs na plataforma
- Receita recorrente mensal (MRR) crescendo via expansão dentro dos grupos e aquisição via associação

---

### Key Performance Indicators

| KPI | Métrica | Alvo | Prazo |
|---|---|---|---|
| **Produtividade picking** | Redução de esperas por resuprimento | -40% ciclo a ciclo | 3 meses após go-live |
| **Compliance SmartPick** | % sugestões executadas | ≥ 70% por ciclo | 6 meses |
| **Ofensores ativos** | Endereços em falta ou excesso | Redução de 50% | 6 meses |
| **Objetivos Farol** | % RCAs atingindo objetivos | Crescimento MoM | Contínuo |
| **Alertas resolvidos** | Produtos saindo do Vermelho | ≥ 60% após intervenção | Contínuo |
| **CDs integrados** | CDs ativos no SmartPick | 9 CDs | Dez/2026 |
| **RCAs ativos** | RCAs carregados no Farol | 3.000 | Dez/2026 |
| **Novos tenants** | Via associação CEO JC | ≥ 20 | Dez/2026 |
| **Churn** | Clientes ativos retidos | 0% churn | Contínuo |
| **Expansão interna** | Módulos por tenant | ≥ 2 módulos/tenant | 12 meses |

> **Nota terminológica:** No Farol, o termo correto é **"objetivos"** (não "metas"),
> por decisão jurídica para evitar vínculo empregatício. Aplicável em toda a
> interface, documentação e comunicação do produto.

---

### Contexto Estratégico de Crescimento

O CEO do Grupo JC ocupa a presidência de uma associação com **mais de 400 empresas
associadas** no segmento de distribuidores — o mesmo público-alvo da plataforma
fbtax.cloud. Sua satisfação com SmartPick e Farol é o principal ativo de GTM
(Go-To-Market) da FBTax para 2026-2027.

O sucesso mensurável dos produtos dentro do Grupo JC (redução de rupturas, evolução
dos objetivos dos RCAs, compliance de calibragem) é o **caso de uso e prova social**
que habilitará a conversão dos associados — transformando o produto em crescimento
orgânico via rede de confiança do segmento.

Clientes ativos em 2026-04-06:
- **Grupo JC** — SmartPick + Farol (em desenvolvimento)
- **Grupo FC (Ferreira Costa)** — FB_APU02 / Apuração Assistida (ativo)

---

## MVP Scope

### Arquitetura de Produtos

Cada produto da plataforma fbtax.cloud é uma aplicação **independente**, com:
- Repositório Git próprio
- Deploy independente via Coolify (Hostinger)
- URL própria (ex: smartpick.fbtax.cloud, farol.fbtax.cloud)
- Comercialização independente — podem ser contratados separadamente

O `fbtax.cloud` funciona como **portal hub**: exibe ícones/links para cada
produto contratado pelo tenant. Produtos não contratados aparecem desabilitados
com call-to-action comercial.

---

### SmartPick — Core Features (MVP)

**1. Importação de dados via CSV**
- Upload de arquivo CSV exportado do Winthor ou SAP S4/HANA
- Validação de campos obrigatórios, encoding e formato
- Suporte à carga completa de todos os endereços do CD (todos os 9 CDs do Grupo JC)
- Feedback claro de erros de importação

**2. Dashboard de urgência por rua**
- Seleção de rua para análise (gestor escolhe qual rua trabalhar)
- Listagem de endereços ordenada por % de ofensa (falta e excesso)
- Indicadores visuais de criticidade por endereço
- Filtros por tipo de ofensor (falta / excesso) e perfil (pallet / fracionado)

**3. Motor de recalibração**

*Ofensores de Falta:*
Condição: `GIRO > CAPACIDADE`
Proposta: `CAPACIDADE_NOVA = CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX`
Ação: sistema gera proposta de aumento automática

*Ofensores de Espaço:*
Condição: `CAPACIDADE > N × GIRO`
- Onde `N` = fator parametrizável por tenant/CD (padrão: N = 2)
- Configurável via painel admin — sem necessidade de deploy

| Curva | Dias | Comportamento |
|---|---|---|
| A — Diário | 1d | ⚠️ Bloqueado — "Curva A: redução não recomendada" |
| A — 2 dias | 2d | ⚠️ Bloqueado — "Curva A: redução não recomendada" |
| A — 7 dias | 7d | ⚠️ Bloqueado — "Curva A: redução não recomendada" |
| B | 14d | ✅ Gera proposta de redução automática |
| C | 21d | ✅ Gera proposta de redução automática |
| D | 30d | ✅ Gera proposta de redução automática |

*Parametrização do Motor (admin):*
- Fator de excesso `N` (padrão: 2)
- Fórmula de calibragem (padrão: `CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX`)
- Dias por classe de venda (A=2, B=14, C=21, D=30)
- Configurável por tenant e por CD

**4. Histórico de propostas (até 4 ocorrências)**
- Registro de cada proposta gerada por endereço
- Indicação de propostas não executadas na carga seguinte
- Base para avaliação de desempenho do gestor/equipe

**5. Geração de PDF operacional**
- Relatório de recalibragens aprovadas pelo gestor
- Campos: produto, endereço atual, nova capacidade, perfil, prioridade
- Formato claro para execução pelo operador de CD no Winthor

**6. Gestão de acesso multi-tenant**
- Login por tenant
- Perfis: Admin FBTax, Gestor de CD
- Isolamento de dados por tenant

**Cadência operacional:**
Semana 1: upload CSV → trabalha Rua 01 → gera PDF → operador executa no Winthor
Semana 2: nova carga → valida Rua 01 → libera Rua 02 → e assim sucessivamente
Meta: 1 CD totalmente calibrado em ~4 semanas

---

### Farol — Core Features (MVP)

**1. Importação de dados via CSV**
- Upload de CSV com dados de vendas/objetivos por RCA
- Validação de estrutura e mapeamento por hierarquia
- Carga inicial: 840 RCAs do Grupo JC

**2. Dashboard semáforo**
- Visualização por produto: Verde / Laranja / Vermelho
- Drill-down: Tenant → Grupo → Empresa → Filial → Supervisor → RCA
- Filtros por indústria atendida, período e status

**3. Gestão de objetivos**
- Cadastro e acompanhamento de objetivos por RCA, Supervisor, Filial, Empresa e indústria
- **Nomenclatura:** "objetivos" (nunca "metas") — decisão jurídica
- Comparativo realizado vs. objetivo por período

**4. Acesso hierárquico com visão limitada**
- Supervisor: acessa apenas sua equipe
- Interface responsiva para smartphone (web browser — sem app nativo)
- CEO/Admin: visão consolidada de todo o tenant

**5. Gestão de acesso multi-tenant**
- Login por tenant com isolamento de dados
- Perfis: Admin FBTax, CEO/Diretoria, Supervisor

---

### fbtax.cloud — Portal Hub (MVP)

- Página central autenticada com ícones por produto contratado
- Links para produtos ativos: `apuracao.fbtax.cloud`, `simulador.fbtax.cloud`,
  `smartpick.fbtax.cloud`, `farol.fbtax.cloud`
- Produtos não contratados: visíveis porém desabilitados
- Deploy independente do portal

---

### Fora do Escopo — MVP

| Feature | Motivo | Versão |
|---|---|---|
| CEO Executive/Supplier View (SmartPick) | Operacional primeiro | V2 |
| erp_bridge (Oracle → TXT) | Validar CSV antes | V2 |
| Farol para 3.000 RCAs completos | Piloto com 840 RCAs | V2 |
| App nativo mobile (iOS/Android) | Web responsivo suficiente | Não planejado |
| Escrita direta no Winthor | Decisão de segurança permanente | Fora do escopo |
| Sazonalidade por área/departamento | Aguarda validação do MVP | V2 |
| Histórico multi-anual na fórmula | CSV inicial pode não ter dado | V2 |

---

### MVP Success Criteria

**SmartPick:**
- ✅ 1 CD do Grupo JC com todas as ruas calibradas em ≤ 4 semanas
- ✅ Gestor gera PDF de recalibração em < 10 minutos após upload
- ✅ Redução mensurável de interrupções do separador por espera de resuprimento
- ✅ ≥ 70% das sugestões da primeira rua executadas pelo operador

**Farol:**
- ✅ 840 RCAs do Grupo JC visíveis com semáforo funcional
- ✅ Supervisor identifica produtos críticos da sua equipe em < 1 minuto
- ✅ CEO usa o painel em pelo menos 1 reunião com fornecedor

---

### Future Vision (V2+)

- **SmartPick Executive View:** visão para CEO em reuniões com indústrias
- **erp_bridge:** conexão automática Oracle → TXT → SaaS
- **Sazonalidade:** calibragem com dados históricos por área/departamento
- **9 CDs completos:** escala após validação no primeiro CD
- **Farol 3.000 RCAs:** após validação com 840 RCAs
- **Dashboard da associação:** 400+ membros do CEO-presidente
- **Módulos adicionais:** novos desafios do Grupo JC pós-entrega
- **Expansão Grupo FC:** SmartPick ou Farol para segundo cliente
- **Inteligência de mercado:** benchmarking multi-tenant por segmento
