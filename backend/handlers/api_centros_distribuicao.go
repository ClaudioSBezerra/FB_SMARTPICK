package handlers

// api_centros_distribuicao.go — endpoint machine-to-machine que lista os
// CDs (cd_id + nome) da empresa vinculada à API key, pra um agente de IA
// resolver nome → cd_id antes de chamar
// /api/relatorios/historico-calibragem. Sem isso, o único jeito de
// descobrir um cd_id válido era adivinhar por tentativa e erro (observado
// em produção em 17/09/2026, agente testou cd_id=1, cd_id=2... até
// acertar). Mesma trilha de auth (SmartPickAPIKeyAuth) e mesmo filtro por
// empresa fixa do api_historico_calibragem.go — ver
// FB_FAROL/_bmad-output/planning-artifacts/architecture/architecture-FB_FAROL-2026-09-16/ARCHITECTURE-SPINE.md,
// AD-5: endpoint novo devolve objeto no topo, nunca array solto.
//
// GET /api/relatorios/centros-distribuicao
// Header: X-API-Key: {SMARTPICK_API_KEY}

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type centroDistribuicaoAPI struct {
	CdID       int    `json:"cd_id"`
	CdNome     string `json:"cd_nome"`
	FilialNome string `json:"filial_nome"`
	CodFilial  string `json:"cod_filial"`
}

// CentrosDistribuicaoAPIHandler devolve todos os CDs ativos da empresa
// vinculada à API key, ordenados por filial/nome.
func CentrosDistribuicaoAPIHandler(db *sql.DB, empresaID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		rows, err := db.Query(`
			SELECT cd.id, cd.nome, f.nome, f.cod_filial
			FROM smartpick.sp_centros_dist cd
			JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
			WHERE cd.empresa_id = $1 AND cd.ativo = true
			ORDER BY f.nome, cd.nome
		`, empresaID)
		if err != nil {
			http.Error(w, `{"error":"Erro interno"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		centros := []centroDistribuicaoAPI{}
		for rows.Next() {
			var c centroDistribuicaoAPI
			if err := rows.Scan(&c.CdID, &c.CdNome, &c.FilialNome, &c.CodFilial); err != nil {
				continue
			}
			centros = append(centros, c)
		}
		if err := rows.Err(); err != nil {
			http.Error(w, `{"error":"Erro interno"}`, http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{"centros": centros})
	}
}
