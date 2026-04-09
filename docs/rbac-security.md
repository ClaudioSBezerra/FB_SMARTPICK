# RBAC e Segurança — SmartPick

---

## Perfis SmartPick (`sp_role`)

Definido na coluna `public.users.sp_role` (tipo `sp_role_type` criado na migration 101).

| Perfil | Nível | Capacidades |
|--------|-------|-------------|
| `somente_leitura` | 1 | Leitura de dados, dashboards, histórico |
| `gestor_filial` | 2 | + Upload CSV, edição inline de propostas |
| `gestor_geral` | 3 | + Execução do motor, aprovação de propostas, CRUD CDs/filiais |
| `admin_fbtax` | 4 | + Gestão de usuários, limpar dados, configuração de plano; acesso cross-tenant |

### Hierarquia de verificação

```go
// hasSpRole: retorna true se o perfil do usuário ≥ nível mínimo exigido
spRoleLevel = { somente_leitura: 1, gestor_filial: 2, gestor_geral: 3, admin_fbtax: 4 }
```

### Métodos de verificação no SmartPickContext

| Método | Nível mínimo | Usado em |
|--------|-------------|---------|
| `CanWrite()` | `gestor_filial` | Upload CSV |
| `CanApprove()` | `gestor_geral` | Execução motor, aprovação, CRUD ambiente |
| `IsAdminFbtax()` | `admin_fbtax` | Gestão usuários, limpeza, plano, purga |
| `HasFilialAccess(id)` | — | Verifica se usuário tem acesso à filial específica |

---

## Middleware de autenticação

### Cadeia de execução

```
Request
  └─→ AuthMiddleware (auth.go — herdado, nunca modificar)
        - Valida JWT (Bearer token)
        - Verifica blacklist (tokens invalidados via logout)
        - Injeta user_id no contexto HTTP
  └─→ SmartPickAuthMiddleware (smartpick_auth.go)
        - Lê user_id do contexto
        - Determina empresa ativa: X-Company-ID header → preferred_company_id
        - Carrega sp_role do banco
        - Verifica nível mínimo da rota (se requiredSpRole != "")
        - Carrega filiais acessíveis (sp_user_filiais)
        - Injeta SmartPickContext no contexto HTTP
```

### SmartPickContext (injetado em cada request)

```go
type SmartPickContext struct {
    UserID     string   // UUID do usuário autenticado
    SpRole     string   // perfil atual
    EmpresaID  string   // UUID da empresa ativa
    FilialIDs  []int    // filiais acessíveis (vazio quando AllFiliais = true)
    AllFiliais bool     // true para admin_fbtax e gestor_geral
}
```

---

## Escopo de filiais

| Perfil | AllFiliais | FilialIDs |
|--------|-----------|-----------|
| `admin_fbtax` | `true` | ignorado |
| `gestor_geral` | `true` | ignorado |
| `gestor_filial` | Depende de `sp_user_filiais` | Lista específica ou all |
| `somente_leitura` | Depende de `sp_user_filiais` | Lista específica ou all |

Para `gestor_filial` e `somente_leitura`, o acesso é definido na tabela `sp_user_filiais`:
- Uma linha com `all_filiais = true` → acesso irrestrito à empresa
- Linhas com `filial_id` específico → acesso apenas às filiais listadas

---

## Isolamento de tenant (multi-tenancy)

- Todas as queries SmartPick incluem `WHERE empresa_id = $1` usando `spCtx.EmpresaID`
- `EmpresaID` é derivado do JWT + `X-Company-ID` header — nunca aceito no body do request
- `admin_fbtax` pode operar em qualquer empresa via `X-Company-ID` header
- O schema `smartpick` está fisicamente separado do schema `public` no PostgreSQL

---

## Segurança adicional

### Senhas
- Hashed com bcrypt (via `HashPassword` em `handlers/crypto.go`)
- Mínimo 6 caracteres (validado no frontend e backend)

### Upload de arquivos
- Aceita apenas `.csv` e `.txt`
- Limite de 50 MB
- Salvo em diretório `uploads/` com nome sanitizado: `sp_{timestamp}_{cdID}_{filename}`
- Path de arquivos: sanitizado com `filepath.Clean()` antes de operações de disco

### Operações destrutivas
- `DELETE /api/sp/admin/limpar-calibragem` → exige `admin_fbtax`
- Remove arquivos do disco com best-effort (só dentro do diretório `uploads/`)
- Executa em transação; rollback automático em caso de erro

### PDF
- Gerado server-side (nunca expõe dados de outros tenants)
- Filtrado por `empresa_id` antes de qualquer query

---

## RBAC no Frontend

### AppRail (barra de módulos)

Módulos visíveis por perfil:
- **Dashboard** → todos os perfis
- **Upload CSV** → todos os perfis (restrição server-side em gestor_filial+)
- **Histórico** → todos
- **Reincidência** → todos
- **PDF** → todos
- **Resultados** → `gestor_filial` e acima (oculto para `somente_leitura`)
- **Gestão** (Filiais/Regras) → `gestor_geral` e acima
- **Configurações** (Plano/Manutenção/Usuários) → apenas `admin_fbtax`

### Verificação no frontend

```typescript
const isAdmin = user?.role === 'admin'
// Equivalente a sp_role === 'admin_fbtax' no contexto SmartPick

const { spRole } = useAuth()
// spRole: carregado de GET /api/sp/me após login; null enquanto carrega
// Uso: filtrar módulos que exigem sp_role >= gestor_filial
const canAccessResultados = spRole !== 'somente_leitura'  // optimistic show durante loading
```

`spRole` é exposto pelo `AuthContext` via `GET /api/sp/me` (endpoint SmartPick). É carregado após login e ao restaurar sessão; não muda ao trocar de empresa (campo global em `public.users`).

Nota: o frontend usa `user.role` (da auth pública) para exibir/ocultar botões de admin, e `spRole` para módulos SmartPick. O servidor sempre verifica `sp_role` independentemente.
