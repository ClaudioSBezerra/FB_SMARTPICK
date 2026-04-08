package handlers

// filiais.go — Selector global de filiais (SmartPick)
// Reescrito na Story 3.2 para usar smartpick.sp_filiais ao invés da
// view APU02 mv_mercadorias_agregada que foi removida na Story 1.3.

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
)

// FilialInfo representa uma filial para o selector global do frontend.
type FilialInfo struct {
	ID        int    `json:"id"`
	CodFilial int    `json:"cod_filial"`
	Nome      string `json:"nome"`
	Ativo     bool   `json:"ativo"`
}

// GetFiliaisHandler retorna as filiais ativas da empresa autenticada.
// GET /api/filiais
func GetFiliaisHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		claims, ok := r.Context().Value(ClaimsKey).(jwt.MapClaims)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		userID := claims["user_id"].(string)

		companyID, err := GetEffectiveCompanyID(db, userID, r.Header.Get("X-Company-ID"))
		if err != nil {
			http.Error(w, "Error getting company: "+err.Error(), http.StatusInternalServerError)
			return
		}

		rows, err := db.Query(`
			SELECT id, cod_filial, nome, ativo
			FROM smartpick.sp_filiais
			WHERE empresa_id = $1 AND ativo = TRUE
			ORDER BY nome ASC, cod_filial ASC
		`, companyID)
		if err != nil {
			http.Error(w, "Error querying filiais: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		filiais := make([]FilialInfo, 0)
		for rows.Next() {
			var f FilialInfo
			if err := rows.Scan(&f.ID, &f.CodFilial, &f.Nome, &f.Ativo); err != nil {
				continue
			}
			filiais = append(filiais, f)
		}

		json.NewEncoder(w).Encode(filiais)
	}
}

// SpFiliaisByEmpresaHandler retorna filiais de uma empresa específica (admin_fbtax).
// GET /api/sp/filiais-empresa?empresa_id=xxx
func SpFiliaisByEmpresaHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		empresaID := r.URL.Query().Get("empresa_id")
		if empresaID == "" {
			http.Error(w, "empresa_id required", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
			SELECT id, cod_filial, nome, ativo
			FROM smartpick.sp_filiais
			WHERE empresa_id = $1 AND ativo = TRUE
			ORDER BY nome ASC, cod_filial ASC
		`, empresaID)
		if err != nil {
			http.Error(w, "Error querying filiais: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		filiais := make([]FilialInfo, 0)
		for rows.Next() {
			var f FilialInfo
			if err := rows.Scan(&f.ID, &f.CodFilial, &f.Nome, &f.Ativo); err != nil {
				continue
			}
			filiais = append(filiais, f)
		}

		json.NewEncoder(w).Encode(filiais)
	}
}
