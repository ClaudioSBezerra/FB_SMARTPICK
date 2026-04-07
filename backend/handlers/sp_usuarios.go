package handlers

// sp_usuarios.go — CRUD de usuários SmartPick
//
// Endpoints protegidos por SmartPickAuthMiddleware (perfil mínimo: admin_fbtax).
// Operações:
//   GET    /api/sp/usuarios         → lista usuários da empresa ativa
//   POST   /api/sp/usuarios         → cria usuário (admin_fbtax)
//   PUT    /api/sp/usuarios/{id}    → atualiza sp_role (admin_fbtax)
//   DELETE /api/sp/usuarios/{id}    → remove usuário (admin_fbtax)
//   PUT    /api/sp/usuarios/{id}/filiais → define filiais acessíveis

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type SpUsuarioResponse struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	FullName    string    `json:"full_name"`
	SpRole      string    `json:"sp_role"`
	IsVerified  bool      `json:"is_verified"`
	TrialEndsAt time.Time `json:"trial_ends_at"`
	CreatedAt   string    `json:"created_at"`
	// Filiais vinculadas (preenchidas pela query de listagem)
	AllFiliais bool  `json:"all_filiais"`
	FilialIDs  []int `json:"filial_ids"`
}

type SpUpdateRoleRequest struct {
	SpRole string `json:"sp_role"` // admin_fbtax | gestor_geral | gestor_filial | somente_leitura
}

type SpVincularFiliaisRequest struct {
	AllFiliais bool  `json:"all_filiais"`
	FilialIDs  []int `json:"filial_ids"` // ignorado quando all_filiais = true
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// SpListUsuariosHandler lista os usuários com acesso SmartPick para a empresa ativa.
func SpListUsuariosHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Lista usuários que têm vínculo com a empresa ativa ou são admin_fbtax
		rows, err := db.Query(`
			SELECT DISTINCT u.id, u.email, u.full_name, u.sp_role, u.is_verified, u.trial_ends_at, u.created_at
			FROM users u
			WHERE u.sp_role != 'somente_leitura'
			   OR EXISTS (
			       SELECT 1 FROM smartpick.sp_user_filiais uf
			       WHERE uf.user_id = u.id AND uf.empresa_id = $1
			   )
			ORDER BY u.full_name
		`, spCtx.EmpresaID)
		if err != nil {
			log.Printf("SpListUsuarios: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var usuarios []SpUsuarioResponse
		for rows.Next() {
			var u SpUsuarioResponse
			if err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.SpRole,
				&u.IsVerified, &u.TrialEndsAt, &u.CreatedAt); err != nil {
				continue
			}
			// Carrega filiais vinculadas para este usuário nessa empresa
			fRows, err := db.Query(`
				SELECT filial_id, all_filiais
				FROM smartpick.sp_user_filiais
				WHERE user_id = $1 AND empresa_id = $2
			`, u.ID, spCtx.EmpresaID)
			if err == nil {
				defer fRows.Close()
				for fRows.Next() {
					var fid *int
					var all bool
					if err := fRows.Scan(&fid, &all); err == nil {
						if all {
							u.AllFiliais = true
						} else if fid != nil {
							u.FilialIDs = append(u.FilialIDs, *fid)
						}
					}
				}
			}
			if u.FilialIDs == nil {
				u.FilialIDs = []int{}
			}
			usuarios = append(usuarios, u)
		}
		if usuarios == nil {
			usuarios = []SpUsuarioResponse{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(usuarios)
	}
}

// SpUpdateRoleHandler atualiza o sp_role de um usuário (admin_fbtax only).
func SpUpdateRoleHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden: apenas admin_fbtax pode alterar perfis", http.StatusForbidden)
			return
		}

		targetID := strings.TrimPrefix(r.URL.Path, "/api/sp/usuarios/")
		targetID = strings.TrimSuffix(targetID, "/role")
		if targetID == "" {
			http.Error(w, "User ID required", http.StatusBadRequest)
			return
		}

		var req SpUpdateRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		validRoles := map[string]bool{
			"admin_fbtax": true, "gestor_geral": true,
			"gestor_filial": true, "somente_leitura": true,
		}
		if !validRoles[req.SpRole] {
			http.Error(w, "sp_role inválido", http.StatusBadRequest)
			return
		}

		res, err := db.Exec(
			"UPDATE users SET sp_role = $1 WHERE id = $2",
			req.SpRole, targetID,
		)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		log.Printf("SpUpdateRole: user %s → sp_role=%s (by %s)", targetID, req.SpRole, spCtx.UserID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Perfil atualizado com sucesso"})
	}
}

// SpVincularFiliaisHandler define (replace) as filiais acessíveis para um usuário.
func SpVincularFiliaisHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden: apenas admin_fbtax pode vincular filiais", http.StatusForbidden)
			return
		}

		// Path: /api/sp/usuarios/{id}/filiais
		path := strings.TrimPrefix(r.URL.Path, "/api/sp/usuarios/")
		targetID := strings.TrimSuffix(path, "/filiais")
		if targetID == "" || targetID == path {
			http.Error(w, "User ID required", http.StatusBadRequest)
			return
		}

		var req SpVincularFiliaisRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		// Remove vínculos anteriores deste usuário nesta empresa
		if _, err = tx.Exec(
			"DELETE FROM smartpick.sp_user_filiais WHERE user_id = $1 AND empresa_id = $2",
			targetID, spCtx.EmpresaID,
		); err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		if req.AllFiliais {
			// Insere vínculo "todas as filiais"
			_, err = tx.Exec(`
				INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
				VALUES ($1, $2, NULL, TRUE)
			`, targetID, spCtx.EmpresaID)
		} else {
			// Insere uma linha por filial específica
			for _, fid := range req.FilialIDs {
				_, err = tx.Exec(`
					INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
					VALUES ($1, $2, $3, FALSE)
				`, targetID, spCtx.EmpresaID, fid)
				if err != nil {
					break
				}
			}
		}
		if err != nil {
			http.Error(w, "Database error ao vincular filiais", http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "Commit error", http.StatusInternalServerError)
			return
		}

		log.Printf("SpVincularFiliais: user %s empresa %s all=%v filiais=%v (by %s)",
			targetID, spCtx.EmpresaID, req.AllFiliais, req.FilialIDs, spCtx.UserID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Filiais vinculadas com sucesso"})
	}
}
