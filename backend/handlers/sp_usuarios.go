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
	SpRole   string `json:"sp_role"`   // admin_fbtax | gestor_geral | gestor_filial | somente_leitura
	FullName string `json:"full_name"` // opcional — atualiza nome se informado
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

		// Lista apenas usuários com vínculo explícito nesta empresa + o próprio usuário autenticado
		rows, err := db.Query(`
			SELECT DISTINCT u.id, u.email, u.full_name, u.sp_role, u.is_verified, u.trial_ends_at, u.created_at
			FROM users u
			WHERE u.id = $2
			   OR EXISTS (
			       SELECT 1 FROM smartpick.sp_user_filiais uf
			       WHERE uf.user_id = u.id AND uf.empresa_id = $1
			   )
			ORDER BY u.full_name
		`, spCtx.EmpresaID, spCtx.UserID)
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
			`UPDATE users SET sp_role = $1, full_name = CASE WHEN $2 != '' THEN $2 ELSE full_name END WHERE id = $3`,
			req.SpRole, req.FullName, targetID,
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

// SpCriarUsuarioRequest — payload para POST /api/sp/usuarios
type SpCriarUsuarioRequest struct {
	FullName      string `json:"full_name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	SpRole        string `json:"sp_role"`        // gestor_geral | gestor_filial | somente_leitura
	TrialDias     int    `json:"trial_dias"`     // fallback: 0 = 365 dias
	TrialEndsAt   string `json:"trial_ends_at"`  // "2006-01-02" — tem prioridade sobre trial_dias
	AllFiliais    bool   `json:"all_filiais"`
	FilialIDs     []int  `json:"filial_ids"`
	EnvironmentID string `json:"environment_id"` // opcional — override do auto-detect
	GroupID       string `json:"group_id"`       // opcional
	CompanyID     string `json:"company_id"`     // opcional — override da empresa ativa para filiais
}

// SpCriarUsuarioHandler cria um novo usuário vinculado à empresa ativa (admin_fbtax only).
// POST /api/sp/usuarios
func SpCriarUsuarioHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden: apenas admin_fbtax pode criar usuários", http.StatusForbidden)
			return
		}

		var req SpCriarUsuarioRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if req.FullName == "" || req.Email == "" || req.Password == "" {
			http.Error(w, "full_name, email e password são obrigatórios", http.StatusBadRequest)
			return
		}

		validRoles := map[string]bool{
			"gestor_geral": true, "gestor_filial": true, "somente_leitura": true,
		}
		if req.SpRole == "" {
			req.SpRole = "somente_leitura"
		}
		if !validRoles[req.SpRole] {
			http.Error(w, "sp_role inválido", http.StatusBadRequest)
			return
		}

		var trialEndsAt time.Time
		if req.TrialEndsAt != "" {
			if t, err2 := time.Parse("2006-01-02", req.TrialEndsAt); err2 == nil {
				trialEndsAt = t.UTC()
			}
		}
		if trialEndsAt.IsZero() {
			dias := req.TrialDias
			if dias <= 0 {
				dias = 365
			}
			trialEndsAt = time.Now().Add(time.Duration(dias) * 24 * time.Hour)
		}

		hash, err := HashPassword(req.Password)
		if err != nil {
			http.Error(w, "Erro ao processar senha", http.StatusInternalServerError)
			return
		}

		// Cria usuário na tabela pública
		var userID string
		err = db.QueryRow(`
			INSERT INTO users (email, password_hash, full_name, trial_ends_at, is_verified, role, sp_role)
			VALUES ($1, $2, $3, $4, TRUE, 'user', $5)
			RETURNING id
		`, req.Email, hash, req.FullName, trialEndsAt, req.SpRole).Scan(&userID)
		if err != nil {
			if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
				http.Error(w, "E-mail já cadastrado", http.StatusConflict)
				return
			}
			log.Printf("SpCriarUsuario: insert user error: %v", err)
			http.Error(w, "Erro ao criar usuário", http.StatusInternalServerError)
			return
		}

		// Vincula ao environment (usa o fornecido ou auto-detecta pela empresa ativa)
		envIDToUse := req.EnvironmentID
		if envIDToUse == "" {
			var derivedEnv string
			_ = db.QueryRow(`
				SELECT eg.environment_id
				FROM companies c
				JOIN enterprise_groups eg ON eg.id = c.group_id
				WHERE c.id = $1
				LIMIT 1
			`, spCtx.EmpresaID).Scan(&derivedEnv)
			envIDToUse = derivedEnv
		}
		if envIDToUse != "" {
			_, _ = db.Exec(
				"INSERT INTO user_environments (user_id, environment_id, role) VALUES ($1, $2, 'user') ON CONFLICT DO NOTHING",
				userID, envIDToUse,
			)
		}

		// Empresa para vínculo de filiais (usa company_id fornecido ou empresa ativa)
		empresaIDToUse := spCtx.EmpresaID
		if req.CompanyID != "" {
			empresaIDToUse = req.CompanyID
		}

		// Vincula filiais no SmartPick
		if req.AllFiliais {
			_, _ = db.Exec(`
				INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
				VALUES ($1, $2, NULL, TRUE) ON CONFLICT DO NOTHING
			`, userID, empresaIDToUse)
		} else {
			for _, fid := range req.FilialIDs {
				_, _ = db.Exec(`
					INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
					VALUES ($1, $2, $3, FALSE) ON CONFLICT DO NOTHING
				`, userID, empresaIDToUse, fid)
			}
		}

		log.Printf("SpCriarUsuario: criado user %s (%s) sp_role=%s empresa=%s por %s",
			userID, req.Email, req.SpRole, spCtx.EmpresaID, spCtx.UserID)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": userID, "message": "Usuário criado com sucesso"})
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

// ─── Vínculos multi-empresa ───────────────────────────────────────────────────

type SpVinculoResponse struct {
	EmpresaID   string `json:"empresa_id"`
	EmpresaNome string `json:"empresa_nome"`
	AllFiliais  bool   `json:"all_filiais"`
	FilialIDs   []int  `json:"filial_ids"`
}

type SpSaveVinculoItem struct {
	EmpresaID  string `json:"empresa_id"`
	AllFiliais bool   `json:"all_filiais"`
	FilialIDs  []int  `json:"filial_ids"`
}

// SpGetVinculosHandler retorna todas as associações empresa→filiais de um usuário.
// GET /api/sp/usuarios/{id}/vinculos
func SpGetVinculosHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/sp/usuarios/")
		targetID := strings.TrimSuffix(path, "/vinculos")
		if targetID == "" || targetID == path {
			http.Error(w, "User ID required", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
			SELECT uf.empresa_id, COALESCE(c.name, ''), uf.all_filiais, uf.filial_id
			FROM smartpick.sp_user_filiais uf
			LEFT JOIN companies c ON c.id = uf.empresa_id
			WHERE uf.user_id = $1
			ORDER BY c.name, uf.filial_id
		`, targetID)
		if err != nil {
			log.Printf("SpGetVinculos: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		vinculoMap := map[string]*SpVinculoResponse{}
		var order []string
		for rows.Next() {
			var empID, empNome string
			var allFiliais bool
			var filialID *int
			if err := rows.Scan(&empID, &empNome, &allFiliais, &filialID); err != nil {
				continue
			}
			if _, ok := vinculoMap[empID]; !ok {
				vinculoMap[empID] = &SpVinculoResponse{
					EmpresaID: empID, EmpresaNome: empNome, FilialIDs: []int{},
				}
				order = append(order, empID)
			}
			v := vinculoMap[empID]
			if allFiliais {
				v.AllFiliais = true
			} else if filialID != nil {
				v.FilialIDs = append(v.FilialIDs, *filialID)
			}
		}

		result := make([]SpVinculoResponse, 0, len(order))
		for _, id := range order {
			result = append(result, *vinculoMap[id])
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// SpSaveVinculosHandler substitui associações empresa→filiais de um usuário (multi-empresa).
// PUT /api/sp/usuarios/{id}/vinculos
// Body: [{empresa_id, all_filiais, filial_ids}] — empresas sem entradas ficam sem acesso.
func SpSaveVinculosHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/sp/usuarios/")
		targetID := strings.TrimSuffix(path, "/vinculos")
		if targetID == "" || targetID == path {
			http.Error(w, "User ID required", http.StatusBadRequest)
			return
		}

		var vinculos []SpSaveVinculoItem
		if err := json.NewDecoder(r.Body).Decode(&vinculos); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		for _, v := range vinculos {
			if _, err = tx.Exec(
				"DELETE FROM smartpick.sp_user_filiais WHERE user_id = $1 AND empresa_id = $2",
				targetID, v.EmpresaID,
			); err != nil {
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			if v.AllFiliais {
				_, err = tx.Exec(`
					INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
					VALUES ($1, $2, NULL, TRUE)
				`, targetID, v.EmpresaID)
			} else {
				for _, fid := range v.FilialIDs {
					_, err = tx.Exec(`
						INSERT INTO smartpick.sp_user_filiais (user_id, empresa_id, filial_id, all_filiais)
						VALUES ($1, $2, $3, FALSE)
					`, targetID, v.EmpresaID, fid)
					if err != nil {
						break
					}
				}
			}
			if err != nil {
				http.Error(w, "Database error ao vincular filiais", http.StatusInternalServerError)
				return
			}
		}

		if err = tx.Commit(); err != nil {
			http.Error(w, "Commit error", http.StatusInternalServerError)
			return
		}

		log.Printf("SpSaveVinculos: user %s atualizado com %d empresas por %s", targetID, len(vinculos), spCtx.UserID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Vínculos atualizados com sucesso"})
	}
}
