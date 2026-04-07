package handlers

// sp_propostas.go — Dashboard de Urgência e Aprovação de Propostas
//
// Story 5.1 — API do Dashboard de Urgência
//
// GET  /api/sp/propostas              → lista propostas (filtros: cd_id, job_id, tipo, status)
// GET  /api/sp/propostas/resumo       → contadores por tipo e status
// PUT  /api/sp/propostas/{id}         → edição inline (sugestao_editada)
// POST /api/sp/propostas/{id}/aprovar → aprovação individual
// POST /api/sp/propostas/{id}/rejeitar→ rejeição individual
// POST /api/sp/propostas/aprovar-lote → aprovação em lote por job_id ou cd_id
//
// Semântica de urgência (delta = sugestao_calibragem - capacidade_atual):
//   tipo=falta  → delta > 0  (sugestão aumenta capacidade → slot pequeno demais → falta de espaço no picking)
//   tipo=espaco → delta < 0  (sugestão reduz capacidade → slot grande demais → excesso de espaço)

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type PropostaResponse struct {
	ID                 int64   `json:"id"`
	JobID              string  `json:"job_id"`
	EnderecoID         int64   `json:"endereco_id"`
	CdID               int     `json:"cd_id"`
	CodFilial          int     `json:"cod_filial"`
	CodProd            int     `json:"codprod"`
	Produto            string  `json:"produto"`
	Rua                *int    `json:"rua"`
	Predio             *int    `json:"predio"`
	Apto               *int    `json:"apto"`
	ClasseVenda        *string `json:"classe_venda"`
	CapacidadeAtual    *int    `json:"capacidade_atual"`
	SugestaoCalibragem int     `json:"sugestao_calibragem"`
	Delta              int     `json:"delta"`
	Justificativa      *string `json:"justificativa"`
	Status             string  `json:"status"`
	AprovadoPor        *string `json:"aprovado_por,omitempty"`
	AprovadoEm         *string `json:"aprovado_em,omitempty"`
	SugestaoEditada    *int    `json:"sugestao_editada,omitempty"`
	EditadoPor         *string `json:"editado_por,omitempty"`
	EditadoEm          *string `json:"editado_em,omitempty"`
	CreatedAt          string  `json:"created_at"`
}

type PropostasResumo struct {
	TotalPendente  int `json:"total_pendente"`
	TotalAprovada  int `json:"total_aprovada"`
	TotalRejeitada int `json:"total_rejeitada"`
	FaltaPendente  int `json:"falta_pendente"`
	EspacoPendente int `json:"espaco_pendente"`
}

// ─── Lista de Propostas ───────────────────────────────────────────────────────

// SpPropostasHandler lista propostas com filtros opcionais.
// GET /api/sp/propostas?cd_id=X&job_id=Y&tipo=falta|espaco&status=pendente&limit=100
func SpPropostasHandler(db *sql.DB) http.HandlerFunc {
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

		q := r.URL.Query()
		cdIDStr := q.Get("cd_id")
		jobIDStr := q.Get("job_id")
		tipo     := q.Get("tipo")   // falta | espaco | "" (todos)
		status   := q.Get("status") // pendente | aprovada | rejeitada | "" (todos)
		limitStr := q.Get("limit")

		limit := 200
		if limitStr != "" {
			if v, err := strconv.Atoi(limitStr); err == nil && v > 0 && v <= 1000 {
				limit = v
			}
		}

		query := `
			SELECT id, job_id, endereco_id, cd_id, cod_filial, codprod,
			       COALESCE(produto,''), rua, predio, apto, classe_venda,
			       capacidade_atual, sugestao_calibragem, delta, justificativa,
			       status, aprovado_por::text, TO_CHAR(aprovado_em,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       sugestao_editada, editado_por::text,
			       TO_CHAR(editado_em,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')
			FROM smartpick.sp_propostas
			WHERE empresa_id = $1
		`
		args := []interface{}{spCtx.EmpresaID}
		idx := 2

		if cdIDStr != "" {
			query += fmt.Sprintf(" AND cd_id = $%d", idx)
			args = append(args, cdIDStr)
			idx++
		}
		if jobIDStr != "" {
			query += fmt.Sprintf(" AND job_id = $%d", idx)
			args = append(args, jobIDStr)
			idx++
		}
		if status != "" {
			query += fmt.Sprintf(" AND status = $%d", idx)
			args = append(args, status)
			idx++
		}
		switch tipo {
		case "falta":
			query += " AND delta > 0"
		case "espaco":
			query += " AND delta < 0"
		}

		query += fmt.Sprintf(" ORDER BY ABS(delta) DESC LIMIT $%d", idx)
		args = append(args, limit)

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var propostas []PropostaResponse
		for rows.Next() {
			var p PropostaResponse
			if err := rows.Scan(
				&p.ID, &p.JobID, &p.EnderecoID, &p.CdID, &p.CodFilial, &p.CodProd,
				&p.Produto, &p.Rua, &p.Predio, &p.Apto, &p.ClasseVenda,
				&p.CapacidadeAtual, &p.SugestaoCalibragem, &p.Delta, &p.Justificativa,
				&p.Status, &p.AprovadoPor, &p.AprovadoEm,
				&p.SugestaoEditada, &p.EditadoPor, &p.EditadoEm,
				&p.CreatedAt,
			); err != nil {
				continue
			}
			propostas = append(propostas, p)
		}
		if propostas == nil {
			propostas = []PropostaResponse{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(propostas)
	}
}

// ─── Resumo / Contadores ──────────────────────────────────────────────────────

// SpPropostasResumoHandler retorna contadores agregados por tipo e status.
// GET /api/sp/propostas/resumo?cd_id=X&job_id=Y
func SpPropostasResumoHandler(db *sql.DB) http.HandlerFunc {
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

		q := r.URL.Query()
		cdIDStr := q.Get("cd_id")
		jobIDStr := q.Get("job_id")

		filter := "WHERE empresa_id = $1"
		args := []interface{}{spCtx.EmpresaID}
		idx := 2

		if cdIDStr != "" {
			filter += fmt.Sprintf(" AND cd_id = $%d", idx)
			args = append(args, cdIDStr)
			idx++
		}
		if jobIDStr != "" {
			filter += fmt.Sprintf(" AND job_id = $%d", idx)
			args = append(args, jobIDStr)
		}

		query := fmt.Sprintf(`
			SELECT
				COUNT(*) FILTER (WHERE status = 'pendente')   AS total_pendente,
				COUNT(*) FILTER (WHERE status = 'aprovada')   AS total_aprovada,
				COUNT(*) FILTER (WHERE status = 'rejeitada')  AS total_rejeitada,
				COUNT(*) FILTER (WHERE status = 'pendente' AND delta > 0) AS falta_pendente,
				COUNT(*) FILTER (WHERE status = 'pendente' AND delta < 0) AS espaco_pendente
			FROM smartpick.sp_propostas
			%s
		`, filter)

		var resumo PropostasResumo
		err := db.QueryRow(query, args...).Scan(
			&resumo.TotalPendente, &resumo.TotalAprovada, &resumo.TotalRejeitada,
			&resumo.FaltaPendente, &resumo.EspacoPendente,
		)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resumo)
	}
}

// ─── Item: edição, aprovação, rejeição ───────────────────────────────────────

// SpPropostaItemHandler despacha por método e sufixo do path.
// PUT  /api/sp/propostas/{id}          → edição inline
// POST /api/sp/propostas/{id}/aprovar  → aprovar
// POST /api/sp/propostas/{id}/rejeitar → rejeitar
func SpPropostaItemHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if !spCtx.CanApprove() {
			http.Error(w, "Forbidden: gestor_geral+ necessário", http.StatusForbidden)
			return
		}

		path := r.URL.Path // /api/sp/propostas/{id} ou /api/sp/propostas/{id}/aprovar
		parts := strings.Split(strings.TrimPrefix(path, "/api/sp/propostas/"), "/")
		if len(parts) == 0 || parts[0] == "" {
			http.Error(w, "ID da proposta obrigatório", http.StatusBadRequest)
			return
		}
		propostaID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			http.Error(w, "ID inválido", http.StatusBadRequest)
			return
		}

		action := ""
		if len(parts) > 1 {
			action = parts[1] // "aprovar" | "rejeitar"
		}

		switch {
		case r.Method == http.MethodPut && action == "":
			editarProposta(db, spCtx, propostaID, w, r)
		case r.Method == http.MethodPost && action == "aprovar":
			mudarStatusProposta(db, spCtx, propostaID, "aprovada", w)
		case r.Method == http.MethodPost && action == "rejeitar":
			mudarStatusProposta(db, spCtx, propostaID, "rejeitada", w)
		default:
			http.Error(w, "Not found", http.StatusNotFound)
		}
	}
}

func editarProposta(db *sql.DB, spCtx *SmartPickContext, id int64, w http.ResponseWriter, r *http.Request) {
	var body struct {
		SugestaoEditada int `json:"sugestao_editada"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.SugestaoEditada <= 0 {
		http.Error(w, "sugestao_editada inválida (deve ser > 0)", http.StatusBadRequest)
		return
	}

	res, err := db.Exec(`
		UPDATE smartpick.sp_propostas
		SET sugestao_editada = $1, editado_por = $2::uuid, editado_em = $3
		WHERE id = $4 AND empresa_id = $5 AND status = 'pendente'
	`, body.SugestaoEditada, spCtx.UserID, time.Now().UTC(), id, spCtx.EmpresaID)
	if err != nil {
		http.Error(w, "Erro ao editar proposta: "+err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "Proposta não encontrada ou não está pendente", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Proposta editada"})
}

func mudarStatusProposta(db *sql.DB, spCtx *SmartPickContext, id int64, novoStatus string, w http.ResponseWriter) {
	// Ao aprovar, usa sugestao_editada se disponível, senão sugestao_calibragem
	res, err := db.Exec(`
		UPDATE smartpick.sp_propostas
		SET status = $1, aprovado_por = $2::uuid, aprovado_em = $3
		WHERE id = $4 AND empresa_id = $5 AND status = 'pendente'
	`, novoStatus, spCtx.UserID, time.Now().UTC(), id, spCtx.EmpresaID)
	if err != nil {
		http.Error(w, "Erro ao atualizar proposta: "+err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "Proposta não encontrada ou não está pendente", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Status atualizado para " + novoStatus})
}

// ─── Aprovação em Lote ────────────────────────────────────────────────────────

// SpPropostasAprovarLoteHandler aprova todas as propostas pendentes de um job ou CD.
// POST /api/sp/propostas/aprovar-lote
// Body: { "job_id": "uuid" } ou { "cd_id": 123 } ou { "tipo": "falta|espaco", "cd_id": 123 }
func SpPropostasAprovarLoteHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		if !spCtx.CanApprove() {
			http.Error(w, "Forbidden: gestor_geral+ necessário", http.StatusForbidden)
			return
		}

		var body struct {
			JobID string `json:"job_id"`
			CdID  *int   `json:"cd_id"`
			Tipo  string `json:"tipo"` // falta | espaco | "" (todos)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}
		if body.JobID == "" && body.CdID == nil {
			http.Error(w, "job_id ou cd_id obrigatório", http.StatusBadRequest)
			return
		}

		filter := "WHERE empresa_id = $2 AND status = 'pendente'"
		args := []interface{}{time.Now().UTC(), spCtx.EmpresaID}
		idx := 3

		if body.JobID != "" {
			filter += fmt.Sprintf(" AND job_id = $%d", idx)
			args = append(args, body.JobID)
			idx++
		}
		if body.CdID != nil {
			filter += fmt.Sprintf(" AND cd_id = $%d", idx)
			args = append(args, *body.CdID)
			idx++
		}
		switch body.Tipo {
		case "falta":
			filter += " AND delta > 0"
		case "espaco":
			filter += " AND delta < 0"
		}

		// Passa user como $idx
		filter += fmt.Sprintf(" RETURNING id")
		query := fmt.Sprintf(`
			UPDATE smartpick.sp_propostas
			SET status = 'aprovada', aprovado_por = $%d::uuid, aprovado_em = $1
			%s
		`, idx, filter)
		args = append(args, spCtx.UserID)

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, "Erro ao aprovar em lote: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		count := 0
		for rows.Next() {
			var id int64
			rows.Scan(&id)
			count++
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message":  fmt.Sprintf("%d propostas aprovadas", count),
			"aprovadas": count,
		})
	}
}
