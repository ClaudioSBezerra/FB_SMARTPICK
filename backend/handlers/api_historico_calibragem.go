package handlers

// api_historico_calibragem.go — Endpoint machine-to-machine consumido por
// agentes de IA (Paperclip) pra montar dashboards de evolução de
// calibragem por CD. Autenticação por API key estática, vinculada a UMA
// empresa fixa via env vars — mesmo padrão do FAROL_API_KEY (ver
// FB_FAROL/backend/handlers/farol_api_produtos_faturados.go), decisão de
// manter consistência entre os módulos (16/09/2026). Não usa withSP nem
// GetSpContext (sessão de usuário) — é um caminho de auth separado, só
// pra chamada de máquina.
//
// GET /api/relatorios/historico-calibragem?cd_id={id}&ano_inicio={YYYY}
// Header: X-API-Key: {SMARTPICK_API_KEY}
//
// Mesma consulta que alimenta a tela de Histórico (SpHistoricoHandler em
// sp_historico.go) — reusa o tipo HistoricoResponse já definido lá, só
// filtra por empresa fixa (da API key) em vez de sessão, e aceita
// ano_inicio pra montar uma série histórica (ex: "desde 2026") em vez de
// só os últimos N ciclos.

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
)

// SmartPickAPIKeyAuth valida o header X-API-Key contra SMARTPICK_API_KEY
// (comparação em tempo constante) e resolve a empresa fixa vinculada à
// key (SMARTPICK_API_KEY_EMPRESA_ID). Sem as duas env vars configuradas,
// a integração fica desabilitada por padrão (503) — nunca aceita chamada
// não configurada.
func SmartPickAPIKeyAuth(next func(db *sql.DB, empresaID string) http.HandlerFunc) func(db *sql.DB) http.HandlerFunc {
	return func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")

			expectedKey := os.Getenv("SMARTPICK_API_KEY")
			empresaID := os.Getenv("SMARTPICK_API_KEY_EMPRESA_ID")
			if expectedKey == "" || empresaID == "" {
				http.Error(w, `{"error":"Integração não configurada"}`, http.StatusServiceUnavailable)
				return
			}

			got := r.Header.Get("X-API-Key")
			if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expectedKey)) != 1 {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}

			next(db, empresaID)(w, r)
		}
	}
}

// HistoricoCalibragemAPIHandler devolve a série histórica de calibragem de
// um CD, ordenada do mais antigo pro mais recente (pra montar gráfico de
// evolução direto, sem o consumidor precisar inverter a lista).
func HistoricoCalibragemAPIHandler(db *sql.DB, empresaID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		cdIDStr := r.URL.Query().Get("cd_id")
		if cdIDStr == "" {
			http.Error(w, `{"error":"parâmetro obrigatório: cd_id"}`, http.StatusBadRequest)
			return
		}
		cdID, err := strconv.Atoi(cdIDStr)
		if err != nil {
			http.Error(w, `{"error":"cd_id inválido"}`, http.StatusBadRequest)
			return
		}

		query := `
			SELECT h.id, h.job_id::text, h.cd_id,
			       cd.nome, f.nome,
			       h.total_propostas, h.aprovadas, h.rejeitadas, h.pendentes,
			       h.curva_a, h.curva_b, h.curva_c,
			       h.executado_por::text,
			       TO_CHAR(h.executado_em,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(h.concluido_em,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       h.status, h.observacao
			FROM smartpick.sp_historico h
			JOIN smartpick.sp_centros_dist cd ON cd.id = h.cd_id
			JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
			WHERE h.empresa_id = $1 AND h.cd_id = $2
		`
		args := []any{empresaID, cdID}

		if anoStr := r.URL.Query().Get("ano_inicio"); anoStr != "" {
			ano, err := strconv.Atoi(anoStr)
			if err != nil || ano < 2000 || ano > 2100 {
				http.Error(w, `{"error":"ano_inicio inválido (use YYYY)"}`, http.StatusBadRequest)
				return
			}
			query += " AND h.executado_em >= ($3 || '-01-01')::date"
			args = append(args, ano)
		}
		query += " ORDER BY h.executado_em ASC"

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, `{"error":"Erro interno"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		historico := []HistoricoResponse{}
		for rows.Next() {
			var h HistoricoResponse
			if err := rows.Scan(
				&h.ID, &h.JobID, &h.CdID, &h.CdNome, &h.FilialNome,
				&h.TotalPropostas, &h.Aprovadas, &h.Rejeitadas, &h.Pendentes,
				&h.CurvaA, &h.CurvaB, &h.CurvaC,
				&h.ExecutadoPor, &h.ExecutadoEm, &h.ConcluidoEm,
				&h.Status, &h.Observacao,
			); err != nil {
				continue
			}
			historico = append(historico, h)
		}
		if err := rows.Err(); err != nil {
			http.Error(w, `{"error":"Erro interno"}`, http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(historico)
	}
}
