---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
inputDocuments:
  - planning-artifacts/product-brief-FB_SMARTPICK-2026-04-06.md
workflowType: 'prd'
lastStep: 1
---

# Product Requirements Document - FB_SMARTPICK

**Author:** Claudio
**Date:** 2026-04-06

---

## Executive Summary

O FB_SMARTPICK é uma aplicação SaaS B2B greenfield desenvolvida a partir do
clone do repositório FB_APU02 (apuracao.fbtax.cloud), herdando toda a
infraestrutura de autenticação, segurança, gestão de ambiente e padrão visual,
com novos banco de dados e módulos de frontend específicos para o domínio de
recalibração de picking em Centros de Distribuição.

O sistema atende distribuidores que operam com WMS Winthor (Totvs) ou SAP
S4/HANA, automatizando o processo de recalibração de endereços de picking via
importação de dados CSV — eliminando interrupções operacionais causadas por
endereços subcalibrados (separador aguarda resuprimento) e desperdício de área
por supercalibração.

O primeiro cliente contratado é o **Grupo JC**, com operação em 9 CDs e
840 RCAs. O produto é comercializado de forma independente, com repositório Git,
deploy (Coolify/Hostinger) e acesso de usuários próprios, sem integração direta
com os demais produtos da plataforma fbtax.cloud.

### O que torna o FB_SMARTPICK especial

- **Motor de recalibração parametrizável:** fórmula e thresholds configuráveis
  por tenant/CD via painel admin, sem necessidade de deploy
- **Accountability logística:** histórico de até 4 propostas por endereço expõe
  padrões de resistência à calibragem — base para avaliação de desempenho
- **Anti-desfragmentação inteligente:** produtos Curva A aparecem bloqueados
  com aviso, nunca com proposta automática de redução
- **Fluxo operacional fechado:** upload CSV → dashboard de urgência → decisão
  do gestor → PDF operacional → execução pelo operador no Winthor
- **Segurança por design:** nenhuma escrita direta no ERP — o sistema é
  exclusivamente de sugestão e rastreamento

---

## Project Classification

**Technical Type:** SaaS B2B
**Domain:** Logistics / WMS / Supply Chain
**Complexity:** Média-Alta
**Project Context:** Greenfield — clone estrutural do FB_APU02 com novo banco
de dados e frontend específico

### Decisões Arquiteturais Fundamentais

**Base de código:**
O FB_SMARTPICK parte do clone do repositório FB_APU02. São herdados sem
modificação:
- Stack de autenticação (JWT, sessões, refresh tokens)
- Camada de segurança e middleware
- Estrutura de gestão de ambiente: tenant, grupos de empresas, empresas, usuários
- Fluxos de e-mail: recuperação de conta, alteração de senha, reset de senha
- Design system e política visual do frontend
- Estrutura de backend (framework, ORM, padrões de API)

**São criados do zero (específicos do SmartPick):**
- Banco de dados: tabelas e schemas para endereços, calibragens, propostas,
  histórico de compliance, parâmetros do motor
- Módulos de frontend: upload CSV, dashboard de urgência, motor de recalibração,
  histórico de propostas, geração de PDF
- Lógica de negócio: motor de recalibração com regras de Curva ABC

**Acesso de usuários:**
Cada usuário é cadastrado individualmente no FB_SMARTPICK — não há SSO nem
aproveitamento de cadastros de outros produtos fbtax.cloud. A estrutura de
gestão (tenant, grupos, empresas) segue o mesmo modelo do FB_APU02, mas com
base de dados própria.

**Deploy:**
Repositório Git independente. Deploy via Coolify no servidor Hostinger.
URL: smartpick.fbtax.cloud

**Banco de dados compartilhado com FB_FAROL:**
SmartPick e Farol compartilham instância PostgreSQL pois são operacionalmente
acoplados (mesmo cliente, dados correlacionados), mas com schemas isolados.

---

## Success Criteria

### User Success

**Gestor de CD:**
- Consegue fazer upload do CSV, identificar endereços críticos e gerar PDF
  operacional em menos de 10 minutos
- Visualiza claramente os ofensores de falta e de espaço com % de ofensa
  ordenada por criticidade
- Consegue trabalhar 1 rua por semana e ter 1 CD completamente calibrado
  em até 4 semanas
- Na carga seguinte, visualiza quais sugestões anteriores não foram executadas
  (accountability da equipe)

**Operador de CD:**
- Recebe PDF claro, completo e executável — sem necessidade de consultar
  o sistema para realizar a movimentação no Winthor

**Admin FBTax:**
- Consegue configurar um novo tenant (Grupo JC + empresas + usuários) e
  parametrizar o motor de calibragem sem necessidade de alteração de código
  ou novo deploy

---

### Business Success

O foco do MVP é **excelência no atendimento ao Grupo JC** — não volume de
novos clientes. O sucesso de negócio neste momento é:

- ✅ Grupo JC com todos os 9 CDs operando no SmartPick até Dez/2026
- ✅ Gestor de cada CD executando ciclos de calibragem com regularidade
  (meta: pelo menos 1 ciclo/mês por CD)
- ✅ 0% de churn — Grupo JC retido e satisfeito
- ✅ CEO do Grupo JC utilizando o sistema como ferramenta de gestão (V2)
- ✅ Redução mensurável e documentada de rupturas de picking por
  subcalibração nos CDs do Grupo JC

A expansão para novos clientes (associação com 400+ membros) é consequência
natural do sucesso com o Grupo JC — sem prazo ou pressão comercial no MVP.

---

### Technical Success

A stack herdada do FB_APU02 (Go + parse inteligente de CSV) é o baseline de
qualidade e performance — estável e validada em produção.

Requisitos técnicos herdados e mantidos:
- Parser CSV em Go com tratamento de encoding, campos ausentes e erros
- Autenticação JWT com refresh tokens
- Isolamento de dados por tenant
- Fluxos de e-mail (recuperação de conta, reset de senha) funcionais
- Deploy via Coolify — zero-downtime desejável

Requisitos técnicos novos (específicos do SmartPick):
- Motor de calibragem executado no backend (Go) — lógica fora do frontend
- Parâmetros do motor persistidos por tenant/CD no banco de dados
- Geração de PDF server-side
- Histórico de propostas com integridade referencial (até 4 por endereço)
- Schema PostgreSQL compartilhado com FB_FAROL via schemas isolados

---

### Measurable Outcomes

| Resultado | Indicador | Alvo |
|---|---|---|
| Calibragem operacional | CDs com ≥ 1 ciclo/mês | 9/9 CDs até Dez/2026 |
| Qualidade da sugestão | % sugestões executadas | ≥ 70% por ciclo |
| Eficiência do gestor | Tempo CSV → PDF | < 10 minutos |
| Velocidade de calibragem | Tempo para calibrar 1 CD | ≤ 4 semanas |
| Retenção | Churn Grupo JC | 0% |
| Impacto operacional | Redução de esperas por resuprimento | Mensurável e documentada |

---

## Product Scope

### MVP — Minimum Viable Product

**SmartPick (FB_SMARTPICK):**
- Importação CSV (Winthor / SAP S4/HANA) com validação robusta
- Dashboard de urgência por rua (ofensores de falta e espaço)
- Motor de calibragem parametrizável (fórmula, fator N, dias por curva)
- Anti-desfragmentação: Curva A bloqueada com aviso; B/C/D com proposta automática
- Histórico de propostas (até 4 ocorrências por endereço)
- Geração de PDF operacional
- Gestão de acesso: Admin FBTax + Gestor de CD
- Multi-tenant: Grupo JC (9 CDs)
- Clone estrutural do FB_APU02 (auth, segurança, tenant, design system)
- Deploy independente: smartpick.fbtax.cloud

**Cadência operacional:**
Semana 1 → 1 rua → PDF → execução → Semana 2 → validação + nova rua
Meta: 1 CD calibrado em ~4 semanas

### Growth Features (Pós-MVP)

- CEO Executive/Supplier View — visão para reuniões com fornecedores
- erp_bridge — integração Oracle → TXT → SaaS
- Sazonalidade por área/departamento na fórmula de calibragem
- Histórico multi-anual na calibragem
- Expansão para os 9 CDs após validação no primeiro

### Vision (Futuro)

- Dashboard consolidado para CEO da associação (400+ distribuidores)
- Inteligência de mercado: benchmarking multi-tenant por segmento
- Módulos adicionais demandados pelo Grupo JC pós-entrega
- Expansão para novos tenants via rede da associação

---

## User Journeys

---

### Jornada 1 — Carlos, Gestor de CD: "A Semana que Mudou o CD"

Carlos é gestor do CD 03 do Grupo JC há seis anos. Todo mês o mesmo ritual:
ele abre o Winthor, percorre mentalmente as ruas que acha que estão com
problema e tenta ajustar algumas calibragens — na base da intuição. Nesta
semana, dois separadores pararam na Rua 07 esperando resuprimento do produto
X, e o gerente de operações cobrou explicação.

Na segunda-feira, Carlos recebe acesso ao SmartPick. Ele exporta o CSV do
Winthor seguindo o manual de exportação, faz o upload e em segundos vê algo
que nunca tinha visto antes: uma lista ordenada dos 18 endereços mais críticos
da Rua 07, com o percentual exato de ofensa de cada um. O produto X que parou
sua equipe está em primeiro lugar — calibrado em 40 caixas, girando 82.

Carlos revisa as propostas de recalibração, ajusta 2 endereços onde conhece
particularidades do produto (pallet de tamanho diferente) e aprova os demais.
Clica em "Gerar PDF" e em menos de 10 minutos tem um documento operacional
pronto para o Diego executar no Winthor.

Na semana seguinte, Carlos faz uma nova carga. O sistema mostra que 14 dos
16 endereços foram executados — 87% de compliance. Dois endereços aparecem
marcados em laranja: "Proposta não executada — 2ª ocorrência". Carlos sabe
exatamente com quem conversar. Pela primeira vez em seis anos, ele tem dados
para justificar cada decisão para o gerente de operações.

**Esta jornada revela requisitos para:**
- Upload e validação de CSV
- Dashboard de urgência com ordenação por % de ofensa
- Edição manual de propostas antes de aprovar
- Geração de PDF operacional
- Rastreamento de compliance ciclo a ciclo
- Indicador visual de propostas não executadas (histórico)

---

### Jornada 2 — Carlos, Gestor de CD: "O CSV que Deu Errado"

Na terceira semana de uso, Carlos tenta fazer upload de um CSV exportado do
SAP S4/HANA de uma das empresas do Grupo JC. O arquivo abre normalmente no
Excel, mas ao fazer o upload no SmartPick, o sistema retorna uma mensagem
clara: "Campo CLASSEVENDA ausente em 47 linhas — verifique as colunas do
arquivo."

Carlos não precisa ligar para o suporte. A mensagem mostra exatamente quais
linhas estão com problema e sugere o mapeamento correto. Ele abre o arquivo,
ajusta a coluna com o nome correto para o SAP e faz o upload novamente. Desta
vez, o sistema confirma: "312 endereços carregados com sucesso — 0 erros."

Em um caso mais extremo, Carlos tenta carregar um arquivo com encoding
diferente (Windows-1252 ao invés de UTF-8). O sistema detecta automaticamente,
converte e processa sem interrupção — registrando no log que a conversão foi
aplicada.

**Esta jornada revela requisitos para:**
- Validação detalhada de campos obrigatórios com mensagem acionável
- Indicação da linha/coluna com problema
- Detecção e tratamento automático de encoding
- Log de processamento acessível ao gestor
- Suporte a múltiplos formatos de exportação (Winthor e SAP S4/HANA)

---

### Jornada 3 — Admin FBTax: "Ligando o CD 01 do Grupo JC"

O Admin da FBTax recebe o contrato do Grupo JC assinado. Acessa o painel
administrativo do SmartPick e cria o tenant "Grupo JC". Em seguida, cadastra
a estrutura: 4 empresas do grupo, 9 CDs mapeados para suas respectivas
empresas. Para o CD 01 (o CD piloto), configura os parâmetros do motor de
calibragem: fator N = 2, fórmula padrão, dias por curva (A=2, B=14, C=21,
D=30).

Cria o usuário de Carlos (Gestor do CD 01) com o perfil correto — acesso
restrito ao CD 01 da empresa X. Carlos recebe e-mail automático com link de
ativação, define sua senha e já está operacional.

Três semanas depois, o Grupo JC pede para adicionar o CD 02. O Admin duplica
a configuração do CD 01 como base, ajusta apenas o nome e o gestor responsável.
Em menos de 5 minutos o CD 02 está disponível no sistema.

**Esta jornada revela requisitos para:**
- CRUD de tenant, empresas e CDs no painel admin
- Configuração de parâmetros do motor por CD
- CRUD de usuários com perfis e restrições de acesso por CD
- E-mail automático de ativação de conta (herdado do FB_APU02)
- Duplicação de configuração de CD como atalho de onboarding

---

### Jornada 4 — Diego, Operador de CD: "Executando Sem Errar"

Diego trabalha no chão do CD. Ele não usa o SmartPick — nunca vai usar. Mas
ele é quem transforma as decisões do Carlos em realidade física.

Na quinta-feira à tarde, Carlos chega com o PDF impresso: 12 endereços para
recalibrar na Rua 07 e Rua 08. O documento tem uma linha por endereço:
produto, endereço atual (RUA-QD-ANDAR-APT), capacidade atual, nova capacidade
proposta, perfil (pallet/fracionado) e prioridade (Alta/Média).

Diego começa pelos 4 itens de prioridade Alta — os ofensores de falta mais
críticos. Para cada um, vai até o endereço físico, faz a movimentação
necessária e registra a nova capacidade no Winthor. O processo é linear e
sem ambiguidade: o PDF foi desenhado para ser executado de cima para baixo.

Quando um dos endereços listados está temporariamente bloqueado por
inventário, Diego pula aquele item e faz uma anotação manual no PDF. Carlos
verá na próxima carga que esse endereço não foi executado — e poderá
reagendar com contexto.

**Esta jornada revela requisitos para:**
- PDF com campos: produto, endereço, capacidade atual, nova capacidade,
  perfil, prioridade
- Ordenação do PDF por prioridade (Alta → Média → Baixa)
- Layout limpo e imprimível (A4, sem elementos decorativos desnecessários)
- Nenhuma dependência do sistema digital para executar o PDF

---

### Journey Requirements Summary

| Capacidade | Jornadas que a revelam |
|---|---|
| Upload e validação de CSV (campos, encoding, linhas com erro) | J1, J2 |
| Dashboard de urgência ordenado por % de ofensa por rua | J1 |
| Motor de recalibração com regras de Curva ABC | J1 |
| Edição manual de propostas antes de aprovação | J1 |
| Geração de PDF operacional (campos específicos, ordenação, A4) | J1, J4 |
| Rastreamento de compliance e histórico de não-execuções | J1 |
| Indicador visual de recorrência (2ª, 3ª, 4ª ocorrência) | J1 |
| Suporte a múltiplos formatos de exportação (Winthor, SAP) | J2 |
| Log de processamento acessível ao gestor | J2 |
| CRUD de tenant, empresas, CDs no painel admin | J3 |
| Configuração de parâmetros do motor por CD (admin) | J3 |
| CRUD de usuários com restrição de acesso por CD | J3 |
| E-mail de ativação de conta (herdado do FB_APU02) | J3 |
| Duplicação de configuração de CD (atalho de onboarding) | J3 |

---

## Innovation & Novel Patterns

### Detected Innovation Areas

**Agente de Inteligência Analítica Restrita (V2)**

O FB_SMARTPICK V2 introduzirá um agente de consulta inteligente embutido na
aplicação — um sistema Text-to-SQL que permite ao gestor de CD ou ao Admin
fazer perguntas em linguagem natural sobre os dados de calibragem carregados,
com geração automática de SQL executado exclusivamente contra o banco de dados
do tenant.

**Características do agente:**

1. **Interface dual:**
   - *Linguagem natural:* o usuário digita "qual rua tem mais ofensores de
     falta no CD 03 comparado ao CD 01?" e o sistema gera, valida e executa
     o SQL automaticamente
   - *Query builder visual:* interface de construção estruturada por filtros
     encadeados para usuários que preferem precisão sobre naturalidade

2. **Escopo de comparativo:** CDs da mesma empresa dentro do tenant
   - Permite: CD 01 vs CD 02 (mesma empresa do Grupo JC)
   - Não permite: comparativo entre empresas diferentes do grupo
   - Não permite: qualquer acesso a dados de outros tenants

3. **Histórico persistente de sessões:**
   - Cada consulta é armazenada com: pergunta original, SQL gerado, resultado
     retornado e timestamp
   - Permite reutilização, auditoria e identificação de padrões de uso
   - O gestor pode revisar o SQL gerado — total transparência sobre o que
     foi executado

4. **Isolamento absoluto por design:**
   - O agente opera exclusivamente sobre o schema do tenant autenticado
   - Nenhuma query pode referenciar tabelas fora do schema autorizado
   - Validação de segurança antes da execução de qualquer SQL gerado

---

### Market Context & Competitive Landscape

No domínio de WMS e otimização de CD, não existem soluções SaaS de médio
porte que ofereçam agentes de linguagem natural restritos ao dado operacional
do próprio cliente. As ferramentas de BI (Power BI, Tableau) exigem
conhecimento técnico para configuração e não têm restrição nativa por tenant.

O FB_SMARTPICK V2 posiciona-se como o primeiro sistema de recalibração de
picking com inteligência analítica conversacional nativa — sem dependência
de ferramentas externas de BI e com segurança por design.

---

### Validation Approach

- Fase 1: Testar com 10–15 perguntas recorrentes dos gestores de CD
- Fase 2: Avaliar qualidade do SQL gerado vs. resultado esperado
- Fase 3: Medir adoção — % de gestores usando agente vs. query builder visual
- Critério de sucesso: ≥ 80% das perguntas retornam resultado correto na
  primeira tentativa

---

### Risk Mitigation

| Risco | Mitigação |
|---|---|
| SQL injection via linguagem natural | Validação e sanitização antes de execução; queries em read-only |
| Resultado enganoso | Exibir sempre o SQL gerado para revisão pelo usuário |
| Acesso a dados proibidos | Middleware de validação de schema antes da execução |
| Custo de LLM | Cachear perguntas frequentes; histórico reutilizável reduz chamadas repetidas |

> **Nota:** Esta funcionalidade está planejada para V2. O MVP não inclui
> nenhum componente de IA generativa — toda a lógica do motor de calibragem
> é determinística e parametrizável.

---

## SaaS B2B Specific Requirements

### Tenant Model

O FB_SMARTPICK utiliza arquitetura multi-tenant com isolamento completo de
dados por tenant. Cada tenant representa um cliente contratante.

**Hierarquia de dados completa:**

```
Servidor (instância de infraestrutura — ex: Servidor 01)
└── Tenant (ex: GRUPO JC)
    └── Grupo (ex: GRUPO JC)
        └── Empresas
            ├── JC DISTRIB
            ├── Costa Atacadão
            ├── REAL Dist. Perfm.
            ├── Real Distrb. Medicamentos
            └── Multicanal
                └── Filiais (identificadas por estado + número e CNPJ próprio)
                    Exemplos:
                    - GO 01 → CNPJ 10.230.480/0001-30
                    - BA 03 → CNPJ 10.230.480/0003-00
                    └── CD 01 (1 CD por filial, vinculado ao CNPJ da filial)
```

**Regras do modelo:**
- Cada filial possui CNPJ próprio e exatamente 1 CD (CD 01)
- O CD é identificado pela combinação Empresa + Filial + CD 01
- Parâmetros do motor de calibragem configurados por CD (por filial)
- Nenhum dado de um tenant é acessível por outro tenant

---

### RBAC Matrix

**Perfis disponíveis:**

| Perfil | Escopo de acesso | Quem usa |
|---|---|---|
| **Admin FBTax** | Total — todos os tenants | Equipe interna FBTax |
| **Gestor Geral** | Todas as filiais do tenant | Diretor de operações |
| **Gestor de Filial** | 1 ou N filiais (definido no cadastro) | Gestor por filial |
| **Somente Leitura** | 1, N ou todas as filiais (definido no cadastro) | Gerentes/diretores |

**Regra de vinculação de filiais:**
No cadastro do usuário, Admin FBTax abre popup de seleção com três modos:
- **Uma filial:** seleciona exatamente 1
- **Múltiplas filiais:** seleciona N via checkbox
- **Todas as filiais:** atalho para acesso completo ao tenant

Vinculação editável pelo Admin FBTax a qualquer momento.

**Matriz de permissões:**

| Capacidade | Admin FBTax | Gestor Geral | Gestor de Filial | Somente Leitura |
|---|---|---|---|---|
| Criar/editar tenant, grupos, empresas | ✅ | ❌ | ❌ | ❌ |
| Criar/editar filiais e CDs | ✅ | ❌ | ❌ | ❌ |
| Configurar parâmetros do motor (por CD) | ✅ | ❌ | ❌ | ❌ |
| Criar/editar usuários e vincular filiais | ✅ | ❌ | ❌ | ❌ |
| Upload de CSV | ✅ | ✅ | ✅ filiais vinculadas | ❌ |
| Visualizar dashboard de urgência | ✅ | ✅ | ✅ filiais vinculadas | ✅ filiais vinculadas |
| Aprovar/rejeitar propostas | ✅ | ✅ | ✅ filiais vinculadas | ❌ |
| Gerar PDF operacional | ✅ | ✅ | ✅ filiais vinculadas | ❌ |
| Visualizar histórico de propostas | ✅ | ✅ | ✅ filiais vinculadas | ✅ filiais vinculadas |
| Visualizar log de processamento CSV | ✅ | ✅ | ✅ filiais vinculadas | ✅ filiais vinculadas |
| Duplicar configuração de CD | ✅ | ❌ | ❌ | ❌ |

---

### Subscription Tiers

| Plano | CDs (= filiais) | Caso de uso |
|---|---|---|
| Starter | 1 CD | Piloto em 1 filial |
| Basic | 3 CDs | Operação regional pequena |
| Professional | 5 CDs | Grupo em expansão |
| Enterprise | 9 CDs | Cobertura ampla |
| Custom | Sob consulta | Acima de 9 filiais |

**Regras MVP:** Admin FBTax ativa manualmente cada CD dentro do limite
contratado. Sistema bloqueia upload além do limite do plano.

**V2:** Avaliação de tokens por empresa com liberação via comprovante de
pagamento. Mecanismo a definir.

---

### Integration List

**MVP:**

| Integração | Tipo | Direção | Status |
|---|---|---|---|
| Winthor (Totvs) | CSV export | Entrada — upload manual | MVP |
| SAP S4/HANA | CSV export | Entrada — upload manual | MVP |
| PDF operacional | Geração server-side (Go) | Saída — download | MVP |
| E-mail transacional | SMTP herdado FB_APU02 | Saída | MVP |

**V2:**

| Integração | Tipo | Status |
|---|---|---|
| erp_bridge | Oracle DB → TXT automático | V2 |
| Agente Text-to-SQL | LLM externo (TBD) | V2 |

> O sistema **nunca escreve no ERP** — decisão permanente de segurança.

---

### Compliance Requirements

**LGPD:** Sem dados pessoais sensíveis nos dados operacionais. Dados de
usuários tratados conforme stack herdada do FB_APU02.

**Segurança:** Isolamento total por tenant, JWT com refresh tokens,
sistema exclusivamente de leitura em relação ao ERP, logs auditáveis.

**Sem certificações obrigatórias** para o domínio WMS/logística.

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**Abordagem MVP:** Experience MVP + Platform MVP

O FB_SMARTPICK MVP entrega a jornada completa do Gestor de CD com
excelência operacional (Experience MVP), sobre uma base técnica multi-tenant
parametrizável que suporta a expansão para todos os 9 CDs e futuros tenants
sem reescrita (Platform MVP).

**Justificativa:** O Grupo JC não quer uma solução parcial — quer o fluxo
completo funcionando (upload → dashboard → PDF → compliance). A stack clonada
do FB_APU02 viabiliza essa entrega sem overhead de infraestrutura.

**Equipe estimada:** 1–2 desenvolvedores full-stack (Go + frontend).
O clone elimina ~40% do escopo de desenvolvimento.

---

### MVP Feature Set (Phase 1 — Entrega Grupo JC)

**Jornadas core suportadas:** J1 (fluxo completo do gestor), J2 (resiliência
de CSV), J3 (onboarding admin), J4 (PDF executável pelo operador)

**Capacidades Must-Have:**

**1. Importação de Dados**
- Upload de CSV (Winthor e SAP S4/HANA) via interface web
- Validação detalhada: campos obrigatórios, indicação de linha/coluna com erro
- Detecção e conversão automática de encoding (UTF-8, Windows-1252)
- Log de processamento acessível ao gestor

**2. Motor de Calibragem (backend Go)**
- Ofensores de falta: `GIRO > CAPACIDADE` → proposta `CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX`
- Ofensores de espaço: `CAPACIDADE > N × GIRO` (N configurável, padrão = 2)
- Anti-desfragmentação Curva A: endereços bloqueados com aviso — sem proposta automática de redução
- Curvas B/C/D: proposta automática de redução
- Todos os parâmetros (N, fórmula, dias por curva A/B/C/D) configuráveis
  por tenant/CD via painel admin, sem deploy

**3. Dashboard de Urgência**
- Visualização por rua com endereços ordenados por % de ofensa
- Separação visual: ofensores de falta vs. ofensores de espaço
- Indicador visual de recorrência (2ª, 3ª, 4ª ocorrência) com histórico
- Edição manual de propostas antes da aprovação

**4. Geração de PDF Operacional**
- Campos: produto, endereço (RUA-QD-ANDAR-APT), capacidade atual,
  nova capacidade proposta, perfil (pallet/fracionado), prioridade
- Ordenação: Alta → Média → Baixa
- Layout A4 limpo e imprimível — sem dependência do sistema digital
- Geração server-side (Go)

**5. Histórico e Compliance**
- Histórico de até 4 propostas por endereço com integridade referencial
- Rastreamento de compliance por ciclo: % de propostas executadas
- Indicação de propostas não executadas na carga seguinte

**6. Gestão e Administração**
- CRUD de tenant, grupos, empresas, filiais e CDs no painel admin
- Configuração de parâmetros do motor por CD (sem deploy)
- CRUD de usuários com popup de vinculação de filiais (1, N ou todas)
- 4 perfis RBAC: Admin FBTax, Gestor Geral, Gestor de Filial, Somente Leitura
- E-mail automático de ativação de conta (herdado do FB_APU02)
- Multi-tenant com isolamento completo de dados por schema

---

### Post-MVP Features

**Phase 2 — Growth (após validação com Grupo JC):**
- CEO Executive / Supplier View — visão consolidada para reuniões com fornecedores
- Duplicação de configuração de CD — atalho de onboarding para CDs adicionais
- erp_bridge — integração Oracle DB → TXT para carga automatizada (sem upload manual)
- Sazonalidade no motor de calibragem (com histórico multi-anual como base)
- Expansão para novos tenants via rede da associação (400+ distribuidores)

**Phase 3 — Expansion (Vision):**
- Agente Text-to-SQL com interface de linguagem natural
- Query builder visual para consultas estruturadas
- Histórico persistente de perguntas com SQL gerado para auditoria
- Comparativo entre CDs da mesma empresa via agente
- Dashboard CEO associação (400+ distribuidores)
- Benchmarking multi-tenant por segmento

---

### Risk Mitigation Strategy

**Riscos Técnicos:**

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Motor de calibragem com regras incorretas | Média | Alto | Validação das regras com Carlos (Grupo JC) antes de produção; bateria de testes com CSVs reais |
| PDF com layout inadequado para impressão | Média | Médio | Revisão do PDF com Diego (operador real) na primeira entrega |
| Schema compartilhado com FB_FAROL — conflito de migrations | Baixa | Alto | Schemas isolados no PostgreSQL; migrations coordenadas entre produtos |
| Parsing de CSV com formatos inesperados do SAP S4/HANA | Média | Médio | Parser herdado do FB_APU02 já é battle-tested; adicionar testes específicos para SAP |

**Riscos de Mercado:**

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Resistência do gestor (sistema substitui intuição) | Média | Médio | Onboarding guiado no CD piloto; primeiros resultados validam credibilidade |
| PDF não auto-explicativo — Diego precisa de suporte | Baixa | Médio | Teste de usabilidade com operador real antes do lançamento no CD 01 |
| Grupo JC insatisfeito com precisão das propostas | Baixa | Alto | Fator N e parâmetros ajustáveis sem deploy — gestor tem controle imediato |

**Riscos de Recurso:**

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Equipe menor que o planejado | Média | Médio | Clone elimina 40% do escopo; motor de calibragem é a peça crítica — priorizar |
| Atraso no onboarding do Grupo JC | Baixa | Baixo | Sem prazo comercial — foco em qualidade sobre velocidade |
| Escopo creep (pedidos do CEO antes do MVP) | Média | Médio | CEO Executive View está explicitamente na Phase 2; contrato de escopo claro |

---

## Functional Requirements

### Importação e Processamento de Dados

- FR1: Gestor pode fazer upload de arquivo CSV exportado do Winthor
  ou SAP S4/HANA para um CD específico vinculado ao seu perfil de acesso
- FR2: O sistema valida o CSV carregado e identifica campos obrigatórios
  ausentes com indicação da linha e coluna correspondentes
- FR3: O sistema detecta e converte automaticamente o encoding do arquivo
  CSV (ex: Windows-1252 → UTF-8) sem interromper o processamento
- FR4: Gestor pode visualizar o log de processamento após cada carga,
  incluindo quantidade de endereços carregados, erros encontrados e
  conversões aplicadas
- FR5: O sistema rejeita cargas com erros críticos e exibe mensagem
  acionável que permite ao gestor corrigir o arquivo sem suporte técnico

### Motor de Calibragem

- FR6: O sistema identifica automaticamente endereços ofensores de falta
  (GIRO > CAPACIDADE) após cada carga
- FR7: O sistema identifica automaticamente endereços ofensores de espaço
  (CAPACIDADE > N × GIRO) após cada carga, usando o fator N configurado
  para o CD
- FR8: O sistema gera proposta de recalibração para ofensores de falta
  aplicando a fórmula: CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX
- FR9: O sistema gera proposta de redução de capacidade para ofensores
  de espaço com Curva B, C ou D
- FR10: O sistema bloqueia propostas automáticas de redução para endereços
  de Curva A e exibe aviso de restrição
- FR11: Admin FBTax pode configurar os parâmetros do motor por CD (fator N,
  dias por curva A/B/C/D, fórmula) sem necessidade de deploy
- FR12: O sistema aplica os parâmetros configurados do CD no momento do
  processamento de cada carga

### Dashboard de Urgência

- FR13: Gestor pode visualizar o dashboard de urgência com endereços
  agrupados por rua e ordenados por percentual de ofensa decrescente
- FR14: Gestor pode visualizar separadamente ofensores de falta e
  ofensores de espaço no dashboard
- FR15: Gestor pode visualizar o indicador de recorrência de cada endereço
  (2ª, 3ª ou 4ª ocorrência não executada) diretamente no dashboard
- FR16: Gestor pode editar manualmente a proposta de recalibração de
  qualquer endereço antes de aprovar
- FR17: Gestor pode aprovar propostas individualmente ou em lote

### Geração de PDF Operacional

- FR18: Gestor pode gerar PDF operacional das propostas aprovadas para
  um conjunto de endereços selecionados
- FR19: O PDF contém por endereço: produto, endereço físico
  (RUA-QD-ANDAR-APT), capacidade atual, nova capacidade proposta,
  perfil (pallet/fracionado) e prioridade
- FR20: O PDF é ordenado por prioridade (Alta → Média → Baixa) e
  formatado para impressão em A4
- FR21: O PDF pode ser executado pelo operador de CD sem necessidade
  de acesso ao sistema digital

### Histórico e Compliance

- FR22: O sistema mantém histórico de até 4 propostas por endereço de
  picking com integridade referencial
- FR23: Gestor pode visualizar, para cada endereço, o histórico de
  propostas anteriores com status de execução (executada / não executada)
- FR24: O sistema identifica e destaca endereços cuja proposta não foi
  executada ao processar a carga subsequente
- FR25: Gestor pode visualizar o percentual de compliance por ciclo
  (propostas executadas vs. total gerado)

### Administração de Ambiente

- FR26: Admin FBTax pode criar, editar e desativar tenants, grupos,
  empresas, filiais e CDs no painel administrativo
- FR27: Admin FBTax pode configurar os parâmetros do motor de calibragem
  individualmente por CD
- FR28: Admin FBTax pode duplicar a configuração de um CD existente como
  base para configurar um novo CD
- FR29: O sistema bloqueia operações de upload além do limite de CDs
  contratados no plano do tenant
- FR30: Admin FBTax pode alterar o plano de assinatura de um tenant,
  liberando ou bloqueando CDs conforme o novo limite

### Gestão de Usuários e Acesso

- FR31: Admin FBTax pode criar, editar e desativar usuários com os
  perfis: Admin FBTax, Gestor Geral, Gestor de Filial, Somente Leitura
- FR32: Admin FBTax pode vincular um usuário a uma, múltiplas ou todas as
  filiais do tenant via popup de seleção no momento do cadastro
- FR33: Admin FBTax pode alterar as filiais vinculadas a um usuário a
  qualquer momento após o cadastro
- FR34: O sistema restringe o acesso de Gestor de Filial e Somente
  Leitura exclusivamente às filiais vinculadas ao seu perfil
- FR35: O sistema impede que usuários de um tenant acessem dados de
  qualquer outro tenant

### Comunicação e Notificações

- FR36: O sistema envia e-mail automático de ativação de conta ao usuário
  recém-criado com link para definição de senha
- FR37: Usuário pode solicitar recuperação de acesso via e-mail com
  link de redefinição de senha
- FR38: Usuário pode alterar sua própria senha após autenticação

---

## Non-Functional Requirements

### Performance

- NFR1: Upload e processamento de CSV com até 5.000 endereços deve
  ser concluído em menos de 30 segundos
- NFR2: O motor de calibragem deve processar e gerar todas as propostas
  em menos de 10 segundos após a conclusão do upload
- NFR3: A geração do PDF operacional deve ser concluída em menos de
  5 segundos independentemente do número de endereços incluídos
- NFR4: Páginas do dashboard devem carregar em menos de 3 segundos
  sob condições normais de uso

### Segurança

- NFR5: Todo tráfego entre cliente e servidor deve ser criptografado
  via TLS 1.2 ou superior
- NFR6: Dados persistidos no banco de dados devem ser isolados por schema
  de tenant — nenhuma query pode referenciar dados de outro tenant
- NFR7: Tokens JWT devem ter tempo de expiração configurado com suporte
  a refresh token com rotação
- NFR8: O sistema deve invalidar imediatamente tokens de sessão ao logout
- NFR9: Operações de criação, edição e exclusão de dados devem ser
  registradas em log de auditoria com identificação do usuário e timestamp

### Escalabilidade

- NFR10: A adição de novos tenants não deve exigir alteração de código
  ou schema compartilhado — deve ser operação puramente administrativa
- NFR11: O banco de dados deve suportar crescimento de histórico de
  propostas por até 3 anos sem degradação de performance nas consultas
  principais do dashboard
- NFR12: O sistema deve suportar até 50 usuários simultâneos por tenant
  sem degradação perceptível de performance

### Confiabilidade

- NFR13: O sistema deve ter disponibilidade mínima de 99% durante
  dias úteis (07h–22h, horário de Brasília)
- NFR14: Deploy de novas versões deve ocorrer sem interrupção do serviço
  (zero-downtime deploy via Coolify)
- NFR15: Falha no processamento de CSV de um tenant não deve afetar
  operações em andamento de outros tenants

### Integração

- NFR16: O sistema deve aceitar arquivos CSV com encoding UTF-8 e
  Windows-1252 como formatos primários suportados
- NFR17: PDFs gerados devem ser compatíveis com visualizadores e
  impressoras padrão A4 (Adobe Reader, Chrome PDF, impressoras comuns)
