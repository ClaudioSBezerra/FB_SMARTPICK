package handlers

// smartpick_auth.go — SmartPickAuthMiddleware
//
// Implementa o RBAC SmartPick em cima do AuthMiddleware herdado (auth.go — nunca modificar).
// Cadeia de execução:
//   1. AuthMiddleware  → valida JWT, verifica blacklist, injeta claims no contexto
//   2. SmartPickAuthMiddleware → lê user_id do contexto, carrega sp_role + filiais do banco
//
// Perfis (sp_role_type em 101_sp_rbac.sql):
//   admin_fbtax     → acesso total; ignora restrições de empresa/filial
//   gestor_geral    → acesso a todas as filiais do tenant (empresa)
//   gestor_filial   → acesso apenas às filiais vinculadas em sp_user_filiais
//   somente_leitura → apenas leitura; sem aprovação ou edição inline

import (
	"context"
	"database/sql"
	"net/http"
)

// ─── Contexto SmartPick ───────────────────────────────────────────────────────

type spCtxKey string

const SpContextKey spCtxKey = "sp_context"

// SmartPickContext é injetado no request context por SmartPickAuthMiddleware.
type SmartPickContext struct {
	UserID     string
	SpRole     string  // admin_fbtax | gestor_geral | gestor_filial | somente_leitura
	EmpresaID  string
	FilialIDs  []int   // IDs de filiais acessíveis; vazio quando AllFiliais = true
	AllFiliais bool    // true para admin_fbtax e gestor_geral
}

// GetSpContext extrai o SmartPickContext do request. Retorna nil se não encontrado.
func GetSpContext(r *http.Request) *SmartPickContext {
	ctx, _ := r.Context().Value(SpContextKey).(*SmartPickContext)
	return ctx
}

// ─── Hierarquia de perfis ─────────────────────────────────────────────────────

// spRoleLevel mapeia cada perfil a um nível numérico. Quanto maior, mais privilégios.
var spRoleLevel = map[string]int{
	"somente_leitura": 1,
	"gestor_filial":   2,
	"gestor_geral":    3,
	"admin_fbtax":     4,
}

// hasSpRole retorna true se o perfil do usuário satisfaz o nível mínimo exigido.
func hasSpRole(userRole, required string) bool {
	return spRoleLevel[userRole] >= spRoleLevel[required]
}

// CanWrite retorna true se o perfil permite escrita (gestor_filial ou acima).
func (s *SmartPickContext) CanWrite() bool {
	return hasSpRole(s.SpRole, "gestor_filial")
}

// CanApprove retorna true se o perfil permite aprovar propostas (gestor_geral ou acima).
func (s *SmartPickContext) CanApprove() bool {
	return hasSpRole(s.SpRole, "gestor_geral")
}

// IsAdminFbtax retorna true para admin_fbtax (acesso cross-tenant).
func (s *SmartPickContext) IsAdminFbtax() bool {
	return s.SpRole == "admin_fbtax"
}

// HasFilialAccess verifica se o usuário tem acesso à filial informada.
func (s *SmartPickContext) HasFilialAccess(filialID int) bool {
	if s.AllFiliais {
		return true
	}
	for _, id := range s.FilialIDs {
		if id == filialID {
			return true
		}
	}
	return false
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// SmartPickAuthMiddleware valida JWT (via AuthMiddleware) e carrega o perfil SmartPick.
//
// requiredSpRole: perfil mínimo exigido (ex: "gestor_filial"). Passar "" para apenas validar
// autenticação sem checar perfil específico.
func SmartPickAuthMiddleware(db *sql.DB, next http.HandlerFunc, requiredSpRole string) http.HandlerFunc {
	// Encadeia sobre o AuthMiddleware herdado (auth.go). "" = sem exigência de role APU02.
	return AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		userID := GetUserIDFromContext(r)
		if userID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Determina a empresa ativa (X-Company-ID header ou preferred_company_id)
		empresaID, err := GetEffectiveCompanyID(db, userID, r.Header.Get("X-Company-ID"))
		if err != nil || empresaID == "" {
			http.Error(w, "Could not determine active company", http.StatusUnauthorized)
			return
		}

		// Carrega sp_role do banco (campo adicionado pela migration 101_sp_rbac.sql)
		var spRole string
		if err := db.QueryRow(
			"SELECT sp_role FROM users WHERE id = $1", userID,
		).Scan(&spRole); err != nil {
			if err == sql.ErrNoRows {
				http.Error(w, "User not found", http.StatusUnauthorized)
			} else {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
			return
		}

		// Verifica perfil mínimo exigido pela rota
		if requiredSpRole != "" && !hasSpRole(spRole, requiredSpRole) {
			http.Error(w, "Forbidden: SmartPick role insuficiente", http.StatusForbidden)
			return
		}

		// Monta SmartPickContext com escopo de filiais
		spCtx := &SmartPickContext{
			UserID:    userID,
			SpRole:    spRole,
			EmpresaID: empresaID,
		}

		// admin_fbtax e gestor_geral têm acesso irrestrito às filiais do tenant
		if spRole == "admin_fbtax" || spRole == "gestor_geral" {
			spCtx.AllFiliais = true
		} else {
			// gestor_filial e somente_leitura: carrega filiais via sp_user_filiais
			rows, err := db.Query(`
				SELECT filial_id, all_filiais
				FROM smartpick.sp_user_filiais
				WHERE user_id = $1 AND empresa_id = $2
			`, userID, empresaID)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var filialID *int
					var allFiliais bool
					if scanErr := rows.Scan(&filialID, &allFiliais); scanErr != nil {
						continue
					}
					if allFiliais {
						spCtx.AllFiliais = true
						spCtx.FilialIDs = nil
						break
					}
					if filialID != nil {
						spCtx.FilialIDs = append(spCtx.FilialIDs, *filialID)
					}
				}
			}
		}

		ctx := context.WithValue(r.Context(), SpContextKey, spCtx)
		next(w, r.WithContext(ctx))
	}, "")
}

// ─── Helpers de resposta ──────────────────────────────────────────────────────

// RequireWrite aborta com 403 se o perfil não permite escrita.
func RequireWrite(spCtx *SmartPickContext, w http.ResponseWriter) bool {
	if !spCtx.CanWrite() {
		http.Error(w, "Forbidden: perfil somente_leitura não permite alterações", http.StatusForbidden)
		return false
	}
	return true
}

// RequireApprove aborta com 403 se o perfil não permite aprovação de propostas.
func RequireApprove(spCtx *SmartPickContext, w http.ResponseWriter) bool {
	if !spCtx.CanApprove() {
		http.Error(w, "Forbidden: apenas gestor_geral ou admin_fbtax podem aprovar propostas", http.StatusForbidden)
		return false
	}
	return true
}
