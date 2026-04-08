package handlers

// sp_reincidencia.go — Dashboard de Reincidência de Calibragem
//
// Story 8.1 — Produtos que foram sugeridos para recalibração em múltiplos ciclos
//             porém nunca foram ajustados no Winthor (mesma CAPACIDADE em todas as cargas).
//
// GET /api/sp/reincidencia?cd_id=X&min_ciclos=2

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
)

// ─── DTO ─────────────────────────────────────────────────────────────────────

type ReincidenciaItem struct {
	CdID            int     `json:"cd_id"`
	CdNome          string  `json:"cd_nome"`
	FilialNome      string  `json:"filial_nome"`
	CodFilial       int     `json:"cod_filial"`
	Codprod         int     `json:"codprod"`
	Produto         string  `json:"produto"`
	Rua             *int    `json:"rua"`
	Predio          *int    `json:"predio"`
	Apto            *int    `json:"apto"`
	ClasseVenda     *string `json:"classe_venda"`
	Capacidade      *int    `json:"capacidade"`           // capacidade atual (nunca mudou)
	UltimaSugestao  *int    `json:"ultima_sugestao"`      // última sugestão do motor
	UltimoDelta     *int    `json:"ultimo_delta"`         // último delta calculado
	CiclosRepetidos int     `json:"ciclos_repetidos"`     // quantas cargas com mesma cap
	PrimeiroCiclo   string  `json:"primeiro_ciclo"`       // data da primeira carga
	UltimoCiclo     string  `json:"ultimo_ciclo"`         // data da última carga
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// SpReincidenciaHandler lista produtos com sugestão repetida mas sem ajuste no Winthor.
// GET /api/sp/reincidencia?cd_id=X&min_ciclos=2
func SpReincidenciaHandler(db *sql.DB) http.HandlerFunc {
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

		cdIDFilter  := r.URL.Query().Get("cd_id")
		minCiclosStr := r.URL.Query().Get("min_ciclos")
		minCiclos := 2
		if minCiclosStr != "" {
			fmt.Sscan(minCiclosStr, &minCiclos)
			if minCiclos < 2 {
				minCiclos = 2
			}
		}

		// Encontra endereços onde:
		// - O produto apareceu em ≥ min_ciclos importações concluídas
		// - A CAPACIDADE é a mesma em todas essas cargas (nunca foi ajustada no Winthor)
		// - Houve proposta com delta != 0 em pelo menos um ciclo (ou seja, motor sugeriu mudança)
		query := `
			WITH enderecos_agrupados AS (
				SELECT
					j.cd_id,
					e.codprod,
					e.produto,
					e.rua,
					e.predio,
					e.apto,
					e.classe_venda,
					e.capacidade,
					COUNT(DISTINCT j.id)                                    AS ciclos_repetidos,
					MIN(j.created_at)                                       AS primeiro_ciclo,
					MAX(j.created_at)                                       AS ultimo_ciclo
				FROM smartpick.sp_enderecos e
				JOIN smartpick.sp_csv_jobs j
					ON j.id = e.job_id
					AND j.empresa_id = $1
					AND j.status = 'done'
				WHERE e.capacidade IS NOT NULL
				GROUP BY j.cd_id, e.codprod, e.produto, e.rua, e.predio, e.apto, e.classe_venda, e.capacidade
				HAVING COUNT(DISTINCT j.id) >= $2
			),
			com_propostas AS (
				SELECT
					ea.*,
					-- última sugestão do motor para este endereço (qualquer ciclo)
					(
						SELECT p.sugestao_calibragem
						FROM smartpick.sp_propostas p
						JOIN smartpick.sp_csv_jobs jj ON jj.id = p.job_id
						WHERE p.codprod      = ea.codprod
						  AND p.cd_id        = ea.cd_id
						  AND p.empresa_id   = $1
						  AND p.rua          IS NOT DISTINCT FROM ea.rua
						  AND p.predio       IS NOT DISTINCT FROM ea.predio
						  AND p.apto         IS NOT DISTINCT FROM ea.apto
						  AND p.delta        != 0
						ORDER BY jj.created_at DESC
						LIMIT 1
					) AS ultima_sugestao,
					(
						SELECT p.delta
						FROM smartpick.sp_propostas p
						JOIN smartpick.sp_csv_jobs jj ON jj.id = p.job_id
						WHERE p.codprod      = ea.codprod
						  AND p.cd_id        = ea.cd_id
						  AND p.empresa_id   = $1
						  AND p.rua          IS NOT DISTINCT FROM ea.rua
						  AND p.predio       IS NOT DISTINCT FROM ea.predio
						  AND p.apto         IS NOT DISTINCT FROM ea.apto
						  AND p.delta        != 0
						ORDER BY jj.created_at DESC
						LIMIT 1
					) AS ultimo_delta
				FROM enderecos_agrupados ea
			)
			SELECT
				cp.cd_id, cd.nome, f.nome, f.cod_filial,
				cp.codprod, COALESCE(cp.produto,''),
				cp.rua, cp.predio, cp.apto,
				cp.classe_venda,
				cp.capacidade,
				cp.ultima_sugestao,
				cp.ultimo_delta,
				cp.ciclos_repetidos,
				TO_CHAR(cp.primeiro_ciclo, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
				TO_CHAR(cp.ultimo_ciclo,   'YYYY-MM-DD"T"HH24:MI:SS"Z"')
			FROM com_propostas cp
			JOIN smartpick.sp_centros_dist cd ON cd.id = cp.cd_id
			JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
			WHERE cp.ultima_sugestao IS NOT NULL
		`

		args := []any{spCtx.EmpresaID, minCiclos}

		if cdIDFilter != "" {
			query += " AND cp.cd_id = $3"
			args = append(args, cdIDFilter)
		}

		query += " ORDER BY cp.ciclos_repetidos DESC, cd.nome, f.nome, cp.codprod"

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, "Database error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var items []ReincidenciaItem
		for rows.Next() {
			var it ReincidenciaItem
			if err := rows.Scan(
				&it.CdID, &it.CdNome, &it.FilialNome, &it.CodFilial,
				&it.Codprod, &it.Produto,
				&it.Rua, &it.Predio, &it.Apto,
				&it.ClasseVenda,
				&it.Capacidade,
				&it.UltimaSugestao, &it.UltimoDelta,
				&it.CiclosRepetidos,
				&it.PrimeiroCiclo, &it.UltimoCiclo,
			); err != nil {
				continue
			}
			items = append(items, it)
		}
		if items == nil {
			items = []ReincidenciaItem{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)
	}
}
