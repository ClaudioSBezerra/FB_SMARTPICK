---
stepsCompleted: [1, 2, 3, 4]\nstatus: 'complete'\ncompletedAt: '2026-04-06'
inputDocuments:
  - planning-artifacts/prd.md
  - planning-artifacts/architecture.md
  - planning-artifacts/project-context.md
workflowType: 'epics-and-stories'
project_name: 'FB_SMARTPICK'
user_name: 'Claudio'
date: '2026-04-06'
---

# FB_SMARTPICK - Epic Breakdown

## Overview

Este documento detalha o breakdown completo de épicos e histórias do FB_SMARTPICK, decompondo os requisitos do PRD, decisões arquiteturais e contexto de projeto em histórias implementáveis.

## Requirements Inventory

### Functional Requirements

**Importação e Processamento de Dados**
- FR1: Gestor pode fazer upload de arquivo CSV exportado do Winthor ou SAP S4/HANA para um CD específico vinculado ao seu perfil de acesso
- FR2: O sistema valida o CSV carregado e identifica campos obrigatórios ausentes com indicação da linha e coluna correspondentes
- FR3: O sistema detecta e converte automaticamente o encoding do arquivo CSV (ex: Windows-1252 → UTF-8) sem interromper o processamento
- FR4: Gestor pode visualizar o log de processamento após cada carga, incluindo quantidade de endereços carregados, erros encontrados e conversões aplicadas
- FR5: O sistema rejeita cargas com erros críticos e exibe mensagem acionável que permite ao gestor corrigir o arquivo sem suporte técnico

**Motor de Calibragem**
- FR6: O sistema identifica automaticamente endereços ofensores de falta (GIRO > CAPACIDADE) após cada carga
- FR7: O sistema identifica automaticamente endereços ofensores de espaço (CAPACIDADE > N × GIRO) após cada carga, usando o fator N configurado para o CD
- FR8: O sistema gera proposta de recalibração para ofensores de falta aplicando a fórmula: CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX
- FR9: O sistema gera proposta de redução de capacidade para ofensores de espaço com Curva B, C ou D
- FR10: O sistema bloqueia propostas automáticas de redução para endereços de Curva A e exibe aviso de restrição
- FR11: Admin FBTax pode configurar os parâmetros do motor por CD (fator N, dias por curva A/B/C/D, fórmula) sem necessidade de deploy
- FR12: O sistema aplica os parâmetros configurados do CD no momento do processamento de cada carga

**Dashboard de Urgência**
- FR13: Gestor pode visualizar o dashboard de urgência com endereços agrupados por rua e ordenados por percentual de ofensa decrescente
- FR14: Gestor pode visualizar separadamente ofensores de falta e ofensores de espaço no dashboard
- FR15: Gestor pode visualizar o indicador de recorrência de cada endereço (2ª, 3ª ou 4ª ocorrência não executada) diretamente no dashboard
- FR16: Gestor pode editar manualmente a proposta de recalibração de qualquer endereço antes de aprovar
- FR17: Gestor pode aprovar propostas individualmente ou em lote

**Geração de PDF Operacional**
- FR18: Gestor pode gerar PDF operacional das propostas aprovadas para um conjunto de endereços selecionados
- FR19: O PDF contém por endereço: produto, endereço físico (RUA-QD-ANDAR-APT), capacidade atual, nova capacidade proposta, perfil (pallet/fracionado) e prioridade
- FR20: O PDF é ordenado por prioridade (Alta → Média → Baixa) e formatado para impressão em A4
- FR21: O PDF pode ser executado pelo operador de CD sem necessidade de acesso ao sistema digital

**Histórico e Compliance**
- FR22: O sistema mantém histórico de até 4 propostas por endereço de picking com integridade referencial
- FR23: Gestor pode visualizar, para cada endereço, o histórico de propostas anteriores com status de execução (executada / não executada)
- FR24: O sistema identifica e destaca endereços cuja proposta não foi executada ao processar a carga subsequente
- FR25: Gestor pode visualizar o percentual de compliance por ciclo (propostas executadas vs. total gerado)

**Administração de Ambiente**
- FR26: Admin FBTax pode criar, editar e desativar tenants, grupos, empresas, filiais e CDs no painel administrativo
- FR27: Admin FBTax pode configurar os parâmetros do motor de calibragem individualmente por CD
- FR28: Admin FBTax pode duplicar a configuração de um CD existente como base para configurar um novo CD
- FR29: O sistema bloqueia operações de upload além do limite de CDs contratados no plano do tenant
- FR30: Admin FBTax pode alterar o plano de assinatura de um tenant, liberando ou bloqueando CDs conforme o novo limite

**Gestão de Usuários e Acesso**
- FR31: Admin FBTax pode criar, editar e desativar usuários com os perfis: Admin FBTax, Gestor Geral, Gestor de Filial, Somente Leitura
- FR32: Admin FBTax pode vincular um usuário a uma, múltiplas ou todas as filiais do tenant via popup de seleção no momento do cadastro
- FR33: Admin FBTax pode alterar as filiais vinculadas a um usuário a qualquer momento após o cadastro
- FR34: O sistema restringe o acesso de Gestor de Filial e Somente Leitura exclusivamente às filiais vinculadas ao seu perfil
- FR35: O sistema impede que usuários de um tenant acessem dados de qualquer outro tenant

**Comunicação e Notificações**
- FR36: O sistema envia e-mail automático de ativação de conta ao usuário recém-criado com link para definição de senha
- FR37: Usuário pode solicitar recuperação de acesso via e-mail com link de redefinição de senha
- FR38: Usuário pode alterar sua própria senha após autenticação

### NonFunctional Requirements

**Performance**
- NFR1: Upload e processamento de CSV com até 5.000 endereços em menos de 30 segundos
- NFR2: Motor de calibragem: geração de propostas em menos de 10 segundos
- NFR3: Geração de PDF operacional em menos de 5 segundos
- NFR4: Páginas do dashboard carregam em menos de 3 segundos

**Segurança**
- NFR5: Todo tráfego via TLS 1.2 ou superior
- NFR6: Dados isolados por schema de tenant — nenhuma query referencia dados de outro tenant
- NFR7: JWT com expiração configurável + refresh token com rotação
- NFR8: Invalidação imediata de tokens ao logout
- NFR9: Audit log em todas as operações de escrita com user_id e timestamp

**Escalabilidade**
- NFR10: Adição de novos tenants sem alteração de código — operação puramente administrativa
- NFR11: Banco suporta crescimento de histórico por 3 anos sem degradação nas queries principais
- NFR12: Suporte a até 50 usuários simultâneos por tenant

**Confiabilidade**
- NFR13: Disponibilidade mínima 99% em dias úteis (07h–22h, Brasília)
- NFR14: Deploy zero-downtime via Coolify
- NFR15: Falha no CSV de um tenant não afeta outros tenants

**Integração**
- NFR16: Suporte a CSV encoding UTF-8 e Windows-1252
- NFR17: PDFs compatíveis com Adobe Reader, Chrome PDF, impressoras A4 padrão

### Additional Requirements

**Da Arquitetura — Impacto direto na implementação:**
- Clone do repositório FB_APU02 como starter template: `git clone <fb_apu02_repo> FB_SMARTPICK && rm -rf .git && git init`
- Banco de dados separado: `fb_smartpick` — não compartilhado com outros produtos
- Schema `smartpick.*` para todas as tabelas de domínio SmartPick (prefixo `sp_`)
- 13 migrations numeradas 100–112 (separadas das migrations herdadas 001–09x)
- Porta API: 8082 (evitar conflito com APU02:8081)
- Módulo Go: `fb_smartpick` (renomear de `fb_apu02` no go.mod)
- RBAC: coluna `role_smartpick VARCHAR(50)` na tabela `users` + tabela `sp_user_filiais`
- `SmartPickContext` React: novo contexto independente do `AuthContext`
- Worker goroutine para CSV assíncrono: padrão `sp_csv_jobs` (idêntico ao `import_jobs` do APU02)
- PDF server-side via `github.com/johnfercher/maroto`
- URLs da API: padrão `/api/smartpick/...` para endpoints de domínio SmartPick
- Middleware `SmartPickAuthMiddleware`: valida `role_smartpick` + `sp_user_filiais` em cada request
- `AuthContext.tsx` e `services/email.go`: NUNCA modificar — herdados diretos do clone
- Deploy: Coolify + Traefik, `smartpick.fbtax.cloud`, Let's Encrypt TLS

**UX — Dashboard de Urgência (decisões definidas):**
- Layout: duas abas — "Ofensores de Falta" | "Ofensores de Espaço" (padrão ModuleTabs do clone)
- Edição de proposta: inline na tabela (sem modal)
- Aprovação em lote: checkbox por linha + botão "Aprovar Selecionadas"
- Indicador de recorrência: coluna visível na tabela (ícone + número da ocorrência)
- Curva A: linha bloqueada com badge de aviso — sem campo de edição

**UX — Demais telas novas (padrões herdados do APU02):**
- Upload CSV: formulário simples + polling de status via TanStack Query
- Geração de PDF: tabela com checkbox de seleção + botão "Gerar PDF" → download direto
- Histórico de Compliance: tabela por endereço, 4 colunas de ciclo com status (executada/não executada)

### FR Coverage Map

| FR | Épico | Descrição |
|---|---|---|
| FR1 | Epic 4 | Upload CSV (Winthor/SAP) por CD |
| FR2 | Epic 4 | Validação de campos obrigatórios |
| FR3 | Epic 4 | Detecção e conversão de encoding |
| FR4 | Epic 4 | Log de processamento |
| FR5 | Epic 4 | Rejeição de cargas com erros críticos |
| FR6 | Epic 4 | Detecção de ofensores de falta |
| FR7 | Epic 4 | Detecção de ofensores de espaço |
| FR8 | Epic 4 | Proposta de aumento para ofensores de falta |
| FR9 | Epic 4 | Proposta de redução para ofensores de espaço B/C/D |
| FR10 | Epic 4 | Bloqueio de redução para Curva A |
| FR11 | Epic 4 | Configuração de parâmetros do motor por CD |
| FR12 | Epic 4 | Aplicação dos parâmetros no processamento |
| FR13 | Epic 5 | Dashboard urgência agrupado por rua |
| FR14 | Epic 5 | Duas abas: ofensores de falta / espaço |
| FR15 | Epic 5 | Indicador de recorrência no dashboard |
| FR16 | Epic 5 | Edição inline de proposta |
| FR17 | Epic 5 | Aprovação individual e em lote |
| FR18 | Epic 6 | Geração de PDF das propostas aprovadas |
| FR19 | Epic 6 | Campos obrigatórios no PDF |
| FR20 | Epic 6 | PDF ordenado por prioridade, formato A4 |
| FR21 | Epic 6 | PDF executável sem acesso ao sistema |
| FR22 | Epic 7 | Histórico de até 4 propostas por endereço |
| FR23 | Epic 7 | Visualização de histórico com status de execução |
| FR24 | Epic 7 | Destaque de propostas não executadas |
| FR25 | Epic 7 | Percentual de compliance por ciclo |
| FR26 | Epic 3 | CRUD de tenants, grupos, empresas, filiais, CDs |
| FR27 | Epic 3 | Configuração de parâmetros do motor por CD |
| FR28 | Epic 3 | Duplicação de configuração de CD |
| FR29 | Epic 3 | Bloqueio de upload além do limite do plano |
| FR30 | Epic 3 | Alteração de plano de assinatura do tenant |
| FR31 | Epic 2 | CRUD de usuários com 4 perfis SmartPick |
| FR32 | Epic 2 | Vínculo de usuário a filiais no cadastro |
| FR33 | Epic 2 | Alteração de filiais vinculadas pós-cadastro |
| FR34 | Epic 2 | Restrição de acesso por filial (gestor_filial/somente_leitura) |
| FR35 | Epic 2 | Isolamento de dados entre tenants |
| FR36 | Epic 2 | E-mail de ativação de conta (herdado) |
| FR37 | Epic 2 | Recuperação de acesso via e-mail (herdado) |
| FR38 | Epic 2 | Alteração de senha após autenticação (herdado) |

## Epic List

### Epic 1: Fundação do Projeto
Setup do clone FB_APU02: renomeação do módulo Go para `fb_smartpick`, criação do banco `fb_smartpick`, schema `smartpick`, execução das migrations 100–112, configuração da porta 8082 e Traefik para `smartpick.fbtax.cloud`. Ao final: sistema rodando localmente e em produção com autenticação herdada funcional.
**FRs cobertos:** — (requisitos arquiteturais — base para todos os épicos seguintes)

### Epic 2: Gestão de Usuários e Controle de Acesso SmartPick
Admin FBTax pode criar e gerenciar usuários com os 4 perfis SmartPick (admin_fbtax, gestor_geral, gestor_filial, somente_leitura), vincular usuários a filiais específicas por empresa e o sistema restringe acesso conforme o perfil. Usuários recebem e-mail de ativação e podem recuperar senha.
**FRs cobertos:** FR31, FR32, FR33, FR34, FR35, FR36, FR37, FR38

### Epic 3: Administração de Ambiente e Planos
Admin FBTax pode configurar a hierarquia operacional completa (filiais, CDs), parametrizar o motor de calibragem por CD, duplicar configurações e gerenciar limites de plano por tenant — sem necessidade de deploy.
**FRs cobertos:** FR26, FR27, FR28, FR29, FR30

### Epic 4: Importação de Dados e Motor de Calibragem
Gestor pode fazer upload de CSV exportado do Winthor ou SAP S4/HANA para um CD. O sistema valida, converte encoding, processa assincronamente e executa o motor de calibragem — gerando propostas de recalibração para todos os endereços ofensores com log detalhado.
**FRs cobertos:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12

### Epic 5: Dashboard de Urgência e Aprovação de Propostas
Gestor pode visualizar o dashboard de urgência com duas abas (ofensores de falta / ofensores de espaço), ver indicadores de recorrência, editar propostas inline e aprovar individualmente ou em lote via "Aprovar Selecionadas".
**FRs cobertos:** FR13, FR14, FR15, FR16, FR17

### Epic 6: Geração de PDF Operacional
Gestor pode gerar PDF operacional das propostas aprovadas — ordenado por prioridade (Alta → Média → Baixa), formatado para impressão A4 — pronto para execução pelo operador no Winthor sem acesso ao sistema digital.
**FRs cobertos:** FR18, FR19, FR20, FR21

### Epic 7: Histórico e Compliance
Gestor pode acompanhar o histórico de propostas por endereço de picking (até 4 ciclos), identificar propostas não executadas com destaque visual e visualizar o percentual de compliance por ciclo — base para avaliação de desempenho operacional.
**FRs cobertos:** FR22, FR23, FR24, FR25

---

## Epic 1: Fundação do Projeto

Clone funcional do FB_APU02 rodando com identidade FB_SMARTPICK — banco renomeado, módulo Go renomeado, infra configurada para `smartpick.fbtax.cloud`. Auth herdado funcional ao final.

### Story 1.1: Setup do Clone e Renomeação do Projeto

As a desenvolvedor,
I want clonar o FB_APU02 e renomear todos os identificadores do projeto,
So that o FB_SMARTPICK existe como repositório independente com sua própria identidade.

**Acceptance Criteria:**

**Given** o repositório FB_APU02 clonado localmente
**When** o setup inicial é executado
**Then** o histórico Git do APU02 é removido e novo repositório iniciado
**And** `backend/go.mod` tem `module fb_smartpick`
**And** todas as referências a `fb_apu02` nos arquivos Go são substituídas por `fb_smartpick`
**And** `backend/go.mod` compila sem erros com `go build ./...`

**Given** o arquivo `docker-compose.yml`
**When** revisado após o setup
**Then** a variável `DATABASE_URL` aponta para `fb_smartpick`
**And** a porta mapeada da API é `8082:8080`
**And** labels Traefik apontam para `smartpick.fbtax.cloud`
**And** `APP_URL` e `ALLOWED_ORIGINS` incluem `https://smartpick.fbtax.cloud`

### Story 1.2: Criação do Banco de Dados e Schema SmartPick

As a desenvolvedor,
I want criar o banco `fb_smartpick` com o schema `smartpick` via migration,
So that a fundação de dados do SmartPick está separada de outros produtos e pronta para receber as tabelas de domínio.

**Acceptance Criteria:**

**Given** o banco PostgreSQL rodando via Docker Compose
**When** a aplicação inicia pela primeira vez
**Then** o `onDBConnected()` executa a migration `100_sp_schema.sql` automaticamente
**And** o banco `fb_smartpick` existe com o schema `smartpick` criado
**And** a tabela `schema_migrations` registra a migration `100` como executada
**And** o AppRail, login e rotas de auth herdadas funcionam normalmente

**Given** uma reinicialização da aplicação
**When** a migration `100` já foi executada
**Then** o sistema não tenta re-executá-la (idempotente)

### Story 1.3: Remoção dos Módulos de Domínio do APU02

As a desenvolvedor,
I want remover os handlers, páginas e rotas específicas do APU02 que não pertencem ao SmartPick,
So that o projeto contém apenas o código base reutilizável mais placeholders para os módulos SmartPick.

**Acceptance Criteria:**

**Given** o clone inicial do APU02
**When** a limpeza de domínio é executada
**Then** handlers removidos: todos os de domínio fiscal (RFB, apuração, ERP bridge, malha fina, CFOP, alíquotas)
**And** handlers mantidos: `auth.go`, `middleware.go`, `environment.go`, `hierarchy.go`, `admin_users.go`
**And** `services/email.go` mantido intacto sem modificação
**And** `App.tsx` tem apenas rotas de auth mais placeholder "/" → "Em breve SmartPick"
**And** `main.go` compila e o servidor inicia na porta 8082 sem erros

---

## Epic 2: Gestão de Usuários e Controle de Acesso SmartPick

Admin FBTax pode criar e gerenciar usuários com os 4 perfis SmartPick, vincular usuários a filiais específicas por empresa e o sistema restringe acesso conforme o perfil. Usuários recebem e-mail de ativação e podem recuperar senha.

### Story 2.1: Migrations de RBAC SmartPick

As a desenvolvedor,
I want criar as migrations que estendem o modelo de usuários com RBAC SmartPick,
So that o banco suporta os 4 perfis SmartPick e o scoping de acesso por empresa/filial.

**Acceptance Criteria:**

**Given** o schema `public` herdado do clone
**When** as migrations `101_sp_role_smartpick.sql` e `102_sp_user_filiais.sql` são executadas
**Then** a coluna `role_smartpick VARCHAR(50) DEFAULT 'somente_leitura'` existe na tabela `users`
**And** a tabela `smartpick.sp_user_filiais` existe com colunas `user_id`, `empresa_id`, `filial_id (nullable)`, `all_filiais`, `created_at`
**And** a PK composta usa `COALESCE(filial_id, '00000000-...')` para permitir registro com `filial_id NULL`
**And** os valores válidos para `role_smartpick` são: `admin_fbtax | gestor_geral | gestor_filial | somente_leitura`

### Story 2.2: SmartPickAuthMiddleware

As a desenvolvedor,
I want implementar o `SmartPickAuthMiddleware` que valida perfil e filiais autorizadas,
So that todos os endpoints SmartPick recebem no contexto do request o `smartpick_role` e `filiais_autorizadas` do usuário autenticado.

**Acceptance Criteria:**

**Given** um request autenticado com JWT válido
**When** o `SmartPickAuthMiddleware` processa o request
**Then** `smartpick_role` é extraído da tabela `users` e injetado no contexto
**And** para perfis `gestor_filial` e `somente_leitura`: `filiais_autorizadas` é lista de UUIDs de `sp_user_filiais` para a empresa do request
**And** para perfis `admin_fbtax` e `gestor_geral`: `filiais_autorizadas` é `nil` (sem restrição)
**And** request sem JWT válido retorna `401 Unauthorized`
**And** o middleware funciona em cadeia: `SecurityMiddleware → AuthMiddleware → SmartPickAuthMiddleware → handler`

### Story 2.3: CRUD de Usuários SmartPick no Backend

As a Admin FBTax,
I want criar, editar e desativar usuários com perfil SmartPick via API,
So that consigo gerenciar quem acessa o sistema e com qual nível de permissão.

**Acceptance Criteria:**

**Given** Admin FBTax autenticado
**When** `POST /api/smartpick/users` com `{ email, full_name, role_smartpick }`
**Then** usuário é criado com `role_smartpick` definido
**And** e-mail de ativação é enviado via `services/email.go` herdado
**And** retorna `201` com o usuário criado

**Given** Admin FBTax autenticado
**When** `PUT /api/smartpick/users/:id` para alterar `role_smartpick`
**Then** o perfil é atualizado e registrado em `sp_audit_log`

**Given** Admin FBTax autenticado
**When** `DELETE /api/smartpick/users/:id` (soft delete: `is_active = false`)
**Then** usuário não consegue mais autenticar
**And** seus dados históricos são preservados

**Given** usuário sem perfil `admin_fbtax`
**When** tenta acessar endpoints `/api/smartpick/users`
**Then** retorna `403 Forbidden`

### Story 2.4: Vínculo de Filiais a Usuários

As a Admin FBTax,
I want vincular um usuário a uma, múltiplas ou todas as filiais de uma empresa,
So that o sistema restringe o acesso desse usuário apenas às filiais autorizadas.

**Acceptance Criteria:**

**Given** Admin FBTax autenticado
**When** `POST /api/smartpick/users/:id/filiais` com `{ empresa_id, filial_ids: [], all_filiais: bool }`
**Then** se `all_filiais = true`: insere registro com `filial_id = NULL` em `sp_user_filiais`
**And** se `all_filiais = false`: insere um registro por `filial_id` informado

**Given** Admin FBTax atualiza filiais de um usuário
**When** `PUT /api/smartpick/users/:id/filiais`
**Then** registros anteriores para a `empresa_id` são removidos e novos inseridos (replace completo)
**And** operação é registrada em `sp_audit_log`

**Given** Gestor de Filial autenticado fazendo qualquer request SmartPick
**When** o `SmartPickAuthMiddleware` processa o request
**Then** injeta apenas as `filiais_autorizadas` correspondentes ao seu vínculo em `sp_user_filiais`

### Story 2.5: Página de Gestão de Usuários SmartPick (Frontend)

As a Admin FBTax,
I want gerenciar usuários SmartPick via painel web,
So that consigo criar, editar perfis e vincular filiais sem precisar de acesso técnico ao banco.

**Acceptance Criteria:**

**Given** Admin FBTax na página `/admin/usuarios`
**When** a página carrega
**Then** exibe lista de usuários com colunas: nome, e-mail, perfil SmartPick, status, filiais vinculadas
**And** botão "Novo Usuário" abre formulário com campos: nome, e-mail, `role_smartpick` (select)

**Given** Admin FBTax cria novo usuário
**When** submete o formulário
**Then** usuário é criado via `POST /api/smartpick/users`
**And** toast de sucesso é exibido
**And** lista é atualizada via TanStack Query `invalidateQueries`

**Given** Admin FBTax clica em "Editar Filiais" de um usuário
**When** o popup de seleção abre
**Then** exibe empresas do tenant com toggle "Todas as filiais" por empresa
**And** permite seleção granular de filiais individuais
**And** salva via `PUT /api/smartpick/users/:id/filiais`

**Given** usuário sem perfil `admin_fbtax`
**When** tenta acessar `/admin/usuarios`
**Then** é redirecionado para `/` (proteção de rota)

---

## Epic 3: Administração de Ambiente e Planos

Admin FBTax pode configurar a hierarquia operacional completa (filiais, CDs), parametrizar o motor de calibragem por CD, duplicar configurações e gerenciar limites de plano por tenant — sem necessidade de deploy.

### Story 3.1: Migrations de Filiais e CDs

As a desenvolvedor,
I want criar as migrations das tabelas `sp_filiais`, `sp_centros_dist` e `sp_subscription_limits`,
So that a hierarquia operacional SmartPick (empresa → filial → CD) e o controle de planos existem no banco.

**Acceptance Criteria:**

**Given** o schema `smartpick` criado na migration 100
**When** as migrations `103_sp_filiais.sql`, `104_sp_centros_dist.sql` e `105_sp_subscription_limits.sql` são executadas
**Then** `sp_filiais` existe com: `id UUID PK`, `empresa_id FK companies`, `nome`, `cnpj`, `estado`, `ativo`, `created_at`
**And** `sp_centros_dist` existe com: `id UUID PK`, `filial_id FK sp_filiais`, `nome`, `codigo`, `ativo`, `created_at`
**And** `sp_subscription_limits` existe com: `tenant_id FK environments`, `max_cds INT`, `plano VARCHAR`, `created_at`
**And** índices em `filial_id` e `empresa_id` criados para performance

### Story 3.2: CRUD de Filiais e CDs no Backend

As a Admin FBTax,
I want criar, editar e desativar filiais e CDs via API,
So that consigo configurar a estrutura operacional de cada tenant antes de liberar o uso.

**Acceptance Criteria:**

**Given** Admin FBTax autenticado
**When** `POST /api/smartpick/filiais` com `{ empresa_id, nome, cnpj, estado }`
**Then** filial é criada vinculada à empresa e retorna `201`
**And** operação registrada em `sp_audit_log`

**Given** Admin FBTax autenticado
**When** `POST /api/smartpick/cds` com `{ filial_id, nome, codigo }`
**Then** CD é criado vinculado à filial e retorna `201`
**And** se o número de CDs ativos do tenant já atingiu `sp_subscription_limits.max_cds`, retorna `403` com mensagem de limite atingido

**Given** `GET /api/smartpick/filiais?empresa_id=:id`
**When** consultado por Admin FBTax
**Then** retorna lista de filiais da empresa com seus CDs aninhados

**Given** `DELETE /api/smartpick/cds/:id`
**When** executado por Admin FBTax
**Then** CD é desativado (`ativo = false`) e dados históricos preservados

### Story 3.3: Migrations de Parâmetros do Motor

As a desenvolvedor,
I want criar a migration da tabela `sp_motor_params`,
So that cada CD pode ter seus parâmetros de calibragem configurados independentemente.

**Acceptance Criteria:**

**Given** o schema `smartpick` com `sp_centros_dist` já criado
**When** a migration `106_sp_motor_params.sql` é executada
**Then** `sp_motor_params` existe com: `cd_id UUID FK sp_centros_dist PK`, `fator_n DECIMAL`, `dias_curva_a INT`, `dias_curva_b INT`, `dias_curva_c INT`, `dias_curva_d INT`, `updated_at`, `updated_by UUID FK users`
**And** valores default estão documentados no comentário da migration (ex: `fator_n = 3.0`)

### Story 3.4: CRUD de Parâmetros do Motor e Duplicação de CD

As a Admin FBTax,
I want configurar os parâmetros do motor por CD e duplicar configurações entre CDs,
So that posso ajustar a sensibilidade da calibragem por operação e agilizar o setup de novos CDs.

**Acceptance Criteria:**

**Given** Admin FBTax autenticado
**When** `PUT /api/smartpick/cds/:id/motor-params` com `{ fator_n, dias_curva_a, dias_curva_b, dias_curva_c, dias_curva_d }`
**Then** parâmetros são atualizados em `sp_motor_params`
**And** `updated_by` e `updated_at` são registrados
**And** operação registrada em `sp_audit_log`

**Given** Admin FBTax autenticado
**When** `POST /api/smartpick/cds/:id/duplicar` com `{ nome, filial_id }`
**Then** novo CD é criado com os mesmos parâmetros do motor do CD origem
**And** retorna o novo CD criado com `201`

**Given** `GET /api/smartpick/cds/:id/motor-params`
**When** consultado
**Then** retorna os parâmetros atuais; se não existir registro, retorna os valores default

### Story 3.5: Gestão de Planos e Limites de CDs

As a Admin FBTax,
I want configurar o plano de assinatura de cada tenant e alterar o limite de CDs,
So that o sistema bloqueia automaticamente operações acima do contratado e libera quando o plano muda.

**Acceptance Criteria:**

**Given** Admin FBTax autenticado
**When** `PUT /api/smartpick/tenants/:id/plano` com `{ plano, max_cds }`
**Then** `sp_subscription_limits` é atualizado com o novo limite
**And** operação registrada em `sp_audit_log`

**Given** tenant com `max_cds = 3` e 3 CDs ativos
**When** Admin tenta criar um 4º CD
**Then** API retorna `403` com mensagem: "Limite de CDs do plano atingido (3/3)"

**Given** plano alterado para `max_cds = 9`
**When** Admin tenta criar novos CDs
**Then** criação é permitida até o novo limite

### Story 3.6: Página de Administração de Ambiente (Frontend)

As a Admin FBTax,
I want gerenciar filiais, CDs, parâmetros do motor e planos via painel web,
So that consigo configurar completamente um novo tenant sem precisar acessar o banco.

**Acceptance Criteria:**

**Given** Admin FBTax na página `/admin/ambiente`
**When** a página carrega
**Then** exibe hierarquia: empresa → filiais → CDs com indicador de limite de plano usado/total

**Given** Admin FBTax clica em "Configurar Motor" de um CD
**When** o formulário abre
**Then** exibe os campos `fator_n`, `dias_curva_a/b/c/d` com valores atuais
**And** salva via `PUT /api/smartpick/cds/:id/motor-params`

**Given** Admin FBTax clica em "Duplicar CD"
**When** informa nome e filial destino
**Then** chama `POST /api/smartpick/cds/:id/duplicar` e exibe o novo CD na hierarquia

**Given** Admin FBTax na aba "Planos"
**When** altera o `max_cds` de um tenant
**Then** o indicador de limite atualiza imediatamente via `invalidateQueries`

---

## Epic 4: Importação de Dados e Motor de Calibragem

Gestor pode fazer upload de CSV exportado do Winthor ou SAP S4/HANA para um CD. O sistema valida, converte encoding, processa assincronamente e executa o motor de calibragem — gerando propostas de recalibração para todos os endereços ofensores com log detalhado.

### Story 4.1: Migrations de Endereços, Jobs CSV e Audit Log

As a desenvolvedor,
I want criar as migrations das tabelas de suporte ao processamento de CSV,
So that o sistema tem estrutura para armazenar jobs assíncronos, endereços de picking e audit log.

**Acceptance Criteria:**

**Given** o schema `smartpick`
**When** as migrations `107_sp_csv_jobs.sql`, `108_sp_enderecos.sql` e `109_sp_audit_log.sql` são executadas
**Then** `sp_csv_jobs` existe com: `id UUID PK`, `cd_id FK sp_centros_dist`, `user_id FK users`, `status VARCHAR` (pending|processing|done|error), `filename`, `total_enderecos INT`, `error_message`, `created_at`, `updated_at`
**And** `sp_enderecos` existe com: `id UUID PK`, `job_id FK sp_csv_jobs`, `cd_id`, `rua`, `quadra`, `andar`, `apto`, `sku`, `descricao`, `curva VARCHAR`, `giro DECIMAL`, `capacidade_atual INT`, `perfil VARCHAR`, `created_at`
**And** `sp_audit_log` existe com: `id UUID PK`, `user_id FK users`, `action VARCHAR`, `table_name VARCHAR`, `record_id UUID`, `payload JSONB`, `created_at`
**And** índices em `cd_id`, `job_id` e `status` criados para performance

### Story 4.2: Worker Assíncrono de CSV

As a desenvolvedor,
I want implementar o worker goroutine que processa jobs de CSV em background,
So that uploads grandes não bloqueiam o servidor e o frontend pode fazer polling do status.

**Acceptance Criteria:**

**Given** a aplicação iniciando
**When** `main.go` executa `go startCSVWorker(db)`
**Then** a goroutine worker está rodando em background
**And** o worker faz polling em `sp_csv_jobs WHERE status = 'pending'` a cada 5 segundos
**And** ao pegar um job: atualiza `status = 'processing'`, processa, atualiza para `done` ou `error`
**And** apenas um job é processado por vez (sequencial)
**And** falha em um job não derruba o worker (recover de panic com log)

**Given** o worker processando um job de um tenant
**When** outro tenant tem um job pendente simultaneamente
**Then** o job do segundo tenant aguarda na fila sem interferência (NFR15)

### Story 4.3: Upload de CSV e Enfileiramento

As a Gestor,
I want fazer upload de arquivo CSV exportado do Winthor ou SAP S4/HANA para um CD,
So that o sistema processa o arquivo e gera as propostas de calibragem automaticamente.

**Acceptance Criteria:**

**Given** Gestor autenticado com acesso ao CD
**When** `POST /api/smartpick/csv-upload` com `{ cd_id }` e arquivo CSV (multipart)
**Then** o sistema valida que `cd_id` pertence a uma filial autorizada do usuário
**And** cria registro em `sp_csv_jobs` com `status = 'pending'`
**And** retorna `202 Accepted` com `{ job_id }` imediatamente

**Given** arquivo CSV com encoding Windows-1252
**When** processado pelo worker
**Then** o encoding é detectado e convertido para UTF-8 automaticamente (NFR16)

**Given** arquivo CSV com campos obrigatórios ausentes
**When** o worker tenta processar
**Then** `sp_csv_jobs.status = 'error'` com `error_message` indicando linha e coluna do problema

**Given** tenant com limite de CDs atingido
**When** Gestor tenta novo upload
**Then** retorna `403` com mensagem de limite de plano

### Story 4.4: Migrations de Propostas

As a desenvolvedor,
I want criar a migration da tabela `sp_propostas`,
So that o sistema tem onde armazenar as propostas geradas pelo motor.

**Acceptance Criteria:**

**Given** o schema `smartpick` com `sp_enderecos` já criado
**When** a migration `110_sp_propostas.sql` é executada
**Then** `sp_propostas` existe com: `id UUID PK`, `endereco_id FK sp_enderecos`, `cd_id`, `job_id`, `capacidade_atual INT`, `nova_capacidade INT`, `tipo VARCHAR` (falta|espaco), `prioridade VARCHAR` (alta|media|baixa), `status VARCHAR` (pendente|aprovada|rejeitada), `bloqueado BOOL DEFAULT false`, `motivo_bloqueio VARCHAR`, `editado_por UUID FK users`, `aprovado_por UUID FK users`, `created_at`, `updated_at`
**And** índice em `(cd_id, status)` e `(endereco_id)` para queries do dashboard

### Story 4.5: Motor de Calibragem

As a sistema,
I want executar o motor de calibragem após a carga de endereços,
So that propostas de recalibração são geradas automaticamente para todos os endereços ofensores.

**Acceptance Criteria:**

**Given** job CSV com `status = 'processing'` e endereços carregados em `sp_enderecos`
**When** o worker executa `runCalibrationEngine(db, job)`
**Then** para cada endereço com `GIRO > CAPACIDADE_ATUAL`: gera proposta de aumento usando `CLASSEVENDA_DIAS × MED_VENDA_DIAS_CX`
**And** para cada endereço com `CAPACIDADE_ATUAL > fator_n × GIRO` e curva B/C/D: gera proposta de redução
**And** para endereços Curva A com `CAPACIDADE_ATUAL > fator_n × GIRO`: registra proposta bloqueada com `bloqueado = true` e `motivo = 'Curva A'` sem proposta de redução
**And** `fator_n` e `dias_curva_*` são lidos de `sp_motor_params` para o CD do job
**And** todas as propostas são inseridas em `sp_propostas` com `status = 'pendente'`
**And** processamento completo de 5.000 endereços ocorre em menos de 30s (NFR1, NFR2)

### Story 4.6: Página de Upload CSV e Log de Processamento (Frontend)

As a Gestor,
I want fazer upload do CSV e acompanhar o processamento em tempo real,
So that sei quando as propostas estão prontas e posso identificar problemas no arquivo.

**Acceptance Criteria:**

**Given** Gestor na página `/upload`
**When** a página carrega
**Then** exibe seletor de CD (filiais autorizadas do usuário) e input de arquivo CSV

**Given** Gestor seleciona CD, arquivo CSV e clica "Processar"
**When** o upload é submetido
**Then** chama `POST /api/smartpick/csv-upload` e recebe `job_id`
**And** inicia polling via TanStack Query em `GET /api/smartpick/csv-jobs/:job_id` a cada 3 segundos
**And** exibe barra de progresso com status: "Aguardando → Processando → Concluído"

**Given** job com `status = 'done'`
**When** o polling detecta a conclusão
**Then** exibe resumo: total de endereços, total de propostas geradas, erros encontrados
**And** botão "Ver Dashboard" navega para `/dashboard`

**Given** job com `status = 'error'`
**When** o polling detecta o erro
**Then** exibe `error_message` com orientação para corrigir o arquivo
**And** polling é interrompido

---

## Epic 5: Dashboard de Urgência e Aprovação de Propostas

Gestor pode visualizar o dashboard de urgência com duas abas (ofensores de falta / ofensores de espaço), ver indicadores de recorrência, editar propostas inline e aprovar individualmente ou em lote via "Aprovar Selecionadas".

### Story 5.1: API do Dashboard de Urgência

As a Gestor,
I want consultar as propostas pendentes organizadas por rua via API,
So that o frontend pode exibir o dashboard com ordenação e filtros de forma eficiente.

**Acceptance Criteria:**

**Given** Gestor autenticado com acesso ao CD
**When** `GET /api/smartpick/dashboard?cd_id=:id&tipo=falta` (ou `tipo=espaco`)
**Then** retorna propostas pendentes filtradas por tipo, agrupadas por rua
**And** cada item inclui: endereço físico (RUA-QD-ANDAR-APT), SKU, descrição, curva, `capacidade_atual`, `nova_capacidade`, `prioridade`, `recorrencia`, `bloqueado`, `motivo_bloqueio`
**And** ordenado por `prioridade DESC` e `percentual_ofensa DESC` dentro de cada rua
**And** para `gestor_filial` e `somente_leitura`: retorna apenas propostas de filiais em `filiais_autorizadas`
**And** resposta em menos de 3 segundos (NFR4)

### Story 5.2: Dashboard de Urgência — Duas Abas (Frontend)

As a Gestor,
I want visualizar o dashboard de urgência com duas abas separadas por tipo de ofensor,
So that consigo focar em um tipo de problema por vez e priorizar as ações de calibragem.

**Acceptance Criteria:**

**Given** Gestor na página `/dashboard`
**When** a página carrega
**Then** exibe duas abas: "Ofensores de Falta" e "Ofensores de Espaço" (padrão ModuleTabs)
**And** cada aba carrega independentemente via `useQuery` com `tipo` como parâmetro
**And** tabela com colunas: Endereço, SKU, Curva, Capacidade Atual, Nova Capacidade, Prioridade, Recorrência, Ações

**Given** endereço com Curva A bloqueado
**When** exibido na tabela
**Then** a linha exibe badge "Curva A — Bloqueado" na coluna Ações sem campo de edição
**And** a linha tem estilo visual distinto

**Given** endereço com `recorrencia >= 2`
**When** exibido na tabela
**Then** exibe ícone de alerta mais número da ocorrência na coluna Recorrência

### Story 5.3: Edição Inline de Propostas

As a Gestor,
I want editar a nova capacidade proposta diretamente na tabela sem abrir modal,
So that consigo ajustar rapidamente propostas antes de aprovar.

**Acceptance Criteria:**

**Given** Gestor na aba do dashboard
**When** clica no campo "Nova Capacidade" de uma proposta não bloqueada
**Then** o campo vira input numérico editável inline
**And** ao sair do campo (blur) ou pressionar Enter: chama `PATCH /api/smartpick/propostas/:id` com `{ nova_capacidade }`
**And** a linha atualiza com o novo valor sem recarregar a tabela inteira
**And** TanStack Query invalida o cache do dashboard após sucesso

**Given** `PATCH /api/smartpick/propostas/:id` no backend
**When** recebido com `{ nova_capacidade }`
**Then** atualiza `sp_propostas.nova_capacidade` e `editado_por` com o user_id do request
**And** registra em `sp_audit_log`
**And** usuário com perfil `somente_leitura` recebe `403`

### Story 5.4: Aprovação Individual e em Lote

As a Gestor,
I want aprovar propostas individualmente ou selecionar múltiplas para aprovar em lote,
So that posso liberar as calibragens para geração de PDF de forma ágil.

**Acceptance Criteria:**

**Given** Gestor clica em "Aprovar" em uma única linha
**When** o request é processado
**Then** `PATCH /api/smartpick/propostas/:id/aprovar` muda `status` para `aprovada` e registra `aprovado_por`
**And** a linha sai da tabela de pendentes imediatamente
**And** registra em `sp_audit_log`

**Given** Gestor seleciona múltiplas propostas via checkbox
**When** clica em "Aprovar Selecionadas"
**Then** chama `POST /api/smartpick/propostas/aprovar-lote` com `{ ids: [] }`
**And** todas as propostas são aprovadas em transação única no banco
**And** toast exibe: "N propostas aprovadas com sucesso"
**And** tabela atualiza via `invalidateQueries`

**Given** usuário com perfil `somente_leitura`
**When** tenta aprovar qualquer proposta
**Then** botões de aprovação não são exibidos na UI
**And** a API retorna `403` se o endpoint for chamado diretamente

---

## Epic 6: Geração de PDF Operacional

Gestor pode gerar PDF operacional das propostas aprovadas — ordenado por prioridade (Alta → Média → Baixa), formatado para impressão A4 — pronto para execução pelo operador no Winthor sem acesso ao sistema digital.

### Story 6.1: Geração de PDF no Backend

As a sistema,
I want gerar o PDF operacional das propostas aprovadas server-side,
So that o operador de CD recebe um documento imprimível pronto para execução no Winthor.

**Acceptance Criteria:**

**Given** Gestor autenticado
**When** `POST /api/smartpick/pdf` com `{ cd_id, proposta_ids: [] }`
**Then** o handler busca as propostas aprovadas pelos IDs informados
**And** gera PDF via `github.com/johnfercher/maroto` com tabela A4
**And** cada linha contém: endereço físico (RUA-QD-ANDAR-APT), SKU, descrição, capacidade atual, nova capacidade, perfil (pallet/fracionado), prioridade
**And** o PDF é ordenado por prioridade (Alta → Média → Baixa) e depois por rua
**And** resposta com `Content-Type: application/pdf` e `Content-Disposition: attachment; filename="smartpick-CD-YYYYMMDD.pdf"`
**And** geração concluída em menos de 5 segundos para qualquer volume (NFR3)
**And** somente propostas com `status = 'aprovada'` são incluídas

**Given** `proposta_ids` vazio ou com IDs inválidos
**When** o endpoint é chamado
**Then** retorna `400 Bad Request` com mensagem descritiva

### Story 6.2: Página de Geração de PDF (Frontend)

As a Gestor,
I want selecionar propostas aprovadas e gerar o PDF operacional com um clique,
So that o operador do CD recebe o documento de calibragem sem precisar de acesso ao sistema.

**Acceptance Criteria:**

**Given** Gestor na página `/pdf`
**When** a página carrega
**Then** exibe tabela de propostas aprovadas do CD selecionado com checkbox por linha
**And** colunas: Endereço, SKU, Prioridade, Capacidade Atual, Nova Capacidade
**And** botão "Selecionar Todas" e contador "N propostas selecionadas"

**Given** Gestor seleciona propostas e clica "Gerar PDF"
**When** o request é enviado
**Then** chama `POST /api/smartpick/pdf` com os IDs selecionados
**And** o browser inicia o download do arquivo PDF automaticamente
**And** botão fica desabilitado com "Gerando..." durante o request

**Given** nenhuma proposta aprovada disponível
**When** a página carrega
**Then** exibe estado vazio: "Nenhuma proposta aprovada. Acesse o Dashboard para aprovar propostas."
**And** link direto para `/dashboard`

---

## Epic 7: Histórico e Compliance

Gestor pode acompanhar o histórico de propostas por endereço de picking (até 4 ciclos), identificar propostas não executadas com destaque visual e visualizar o percentual de compliance por ciclo — base para avaliação de desempenho operacional.

### Story 7.1: Migrations de Histórico

As a desenvolvedor,
I want criar a migration da tabela `sp_historico`,
So that o sistema armazena o histórico de compliance por endereço com integridade referencial.

**Acceptance Criteria:**

**Given** o schema `smartpick` com `sp_propostas` já criado
**When** a migration `111_sp_historico.sql` é executada
**Then** `sp_historico` existe com: `id UUID PK`, `endereco_id FK sp_enderecos`, `cd_id`, `proposta_id FK sp_propostas`, `ciclo INT`, `status_execucao VARCHAR` (executada|nao_executada), `data_ciclo TIMESTAMPTZ`, `created_at`
**And** constraint de máximo 4 registros por `endereco_id` (rolling window)
**And** índice em `(endereco_id, ciclo)` para queries de histórico

### Story 7.2: Registro Automático de Histórico e Detecção de Não-Execução

As a sistema,
I want registrar o histórico de execução e detectar propostas não executadas ao processar nova carga,
So that o indicador de recorrência no dashboard e o compliance por ciclo são calculados corretamente.

**Acceptance Criteria:**

**Given** nova carga CSV sendo processada pelo worker para um CD
**When** o motor identifica um endereço com proposta aprovada no ciclo anterior sem registro de execução
**Then** insere em `sp_historico` com `status_execucao = 'nao_executada'`
**And** o campo `recorrencia` na proposta nova reflete o número de ocorrências não executadas consecutivas

**Given** proposta aprovada e executada pelo operador
**When** `PATCH /api/smartpick/historico/:id/executar`
**Then** `sp_historico.status_execucao` muda para `executada`
**And** registra em `sp_audit_log`

**Given** endereço com 4 registros em `sp_historico`
**When** nova proposta seria inserida
**Then** o registro mais antigo é removido e o novo inserido (rolling window de 4)

### Story 7.3: API de Histórico e Compliance

As a Gestor,
I want consultar o histórico de propostas por endereço e o percentual de compliance do ciclo via API,
So that tenho visibilidade sobre padrões de resistência à calibragem e desempenho operacional.

**Acceptance Criteria:**

**Given** Gestor autenticado
**When** `GET /api/smartpick/historico?cd_id=:id`
**Then** retorna lista de endereços com seus últimos 4 ciclos de proposta e status de execução
**And** para `gestor_filial`: apenas endereços de filiais autorizadas

**Given** Gestor autenticado
**When** `GET /api/smartpick/compliance?cd_id=:id&ciclo=:n`
**Then** retorna: total de propostas geradas, total executadas, total não executadas, percentual de compliance

**Given** endereço com `status_execucao = 'nao_executada'` em 2 ou mais ciclos consecutivos
**When** retornado pela API de histórico
**Then** campo `destaque = true` indica destaque visual

### Story 7.4: Página de Histórico e Compliance (Frontend)

As a Gestor,
I want visualizar o histórico de propostas por endereço e o compliance do ciclo,
So that posso identificar endereços problemáticos e avaliar o desempenho operacional do CD.

**Acceptance Criteria:**

**Given** Gestor na página `/historico`
**When** a página carrega
**Then** exibe tabela com colunas: Endereço, SKU, Ciclo 1, Ciclo 2, Ciclo 3, Ciclo 4 (cada coluna com ícone executada/não-executada)
**And** card de resumo no topo: "Compliance do ciclo atual: X%"

**Given** endereço com `destaque = true`
**When** exibido na tabela
**Then** a linha tem estilo visual destacado (borda ou ícone de alerta)

**Given** Gestor clica em "Marcar como Executada" em uma proposta
**When** o request é enviado
**Then** chama `PATCH /api/smartpick/historico/:id/executar`
**And** a célula atualiza para ícone "executada" via `invalidateQueries`

**Given** usuário com perfil `somente_leitura`
**When** visualiza a página de histórico
**Then** vê os dados mas não tem o botão "Marcar como Executada"
