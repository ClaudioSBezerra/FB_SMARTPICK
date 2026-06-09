package handlers

// sp_realocacao.go — Persistência e indicadores das realocações de mercadoria.
//
// POST /api/sp/realocacao              → grava um lote de realocação (ao gerar PDF)
// GET  /api/sp/realocacao/indicadores  → KPIs do mês + série mensal (realoc + calib)

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

// ─── POST: salvar lote de realocação ──────────────────────────────────────────

type realocacaoMovimento struct {
	Codprod     int     `json:"codprod"`
	Produto     string  `json:"produto"`
	ClasseVenda *string `json:"classe_venda"`
	EndOrigem   string  `json:"end_origem"`
	EndDestino  string  `json:"end_destino"`
	QtAcesso90  *int    `json:"qt_acesso_90"`
	Observacao  string  `json:"observacao"`
}

type realocacaoLoteReq struct {
	CdID        int                   `json:"cd_id"`
	Rua         *int                  `json:"rua"`
	TotalSlots  int                   `json:"total_slots"`
	Movimentos  []realocacaoMovimento `json:"movimentos"`
}

// SpRealocacaoSalvarHandler grava um lote de realocação e seus movimentos.
func SpRealocacaoSalvarHandler(db *sql.DB) http.HandlerFunc {
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

		var req realocacaoLoteReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CdID == 0 {
			http.Error(w, "cd_id e movimentos obrigatórios", http.StatusBadRequest)
			return
		}
		// Verifica que o CD pertence à empresa
		var ok bool
		if err := db.QueryRow(
			`SELECT EXISTS(SELECT 1 FROM smartpick.sp_centros_dist WHERE id = $1 AND empresa_id = $2)`,
			req.CdID, spCtx.EmpresaID,
		).Scan(&ok); err != nil || !ok {
			http.Error(w, "CD não encontrado", http.StatusNotFound)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var loteID int64
		if err := tx.QueryRow(`
			INSERT INTO smartpick.sp_realocacao_lote
				(empresa_id, cd_id, rua, criado_por, total_slots, total_movimentos)
			VALUES ($1, $2, $3, $4::uuid, $5, $6)
			RETURNING id
		`, spCtx.EmpresaID, req.CdID, req.Rua, spCtx.UserID, req.TotalSlots, len(req.Movimentos)).Scan(&loteID); err != nil {
			http.Error(w, "Erro ao salvar lote: "+err.Error(), http.StatusInternalServerError)
			return
		}

		stmt, err := tx.Prepare(`
			INSERT INTO smartpick.sp_realocacao_item
				(lote_id, codprod, produto, classe_venda, end_origem, end_destino, qt_acesso_90, observacao)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer stmt.Close()
		for _, m := range req.Movimentos {
			var cv any
			if m.ClasseVenda != nil && *m.ClasseVenda != "" {
				cv = *m.ClasseVenda
			}
			if _, err := stmt.Exec(loteID, m.Codprod, m.Produto, cv, m.EndOrigem, m.EndDestino, m.QtAcesso90, nilIfEmptyStr(m.Observacao)); err != nil {
				http.Error(w, "Erro ao salvar movimento: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "Erro ao confirmar: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"id": loteID, "movimentos": len(req.Movimentos)})
	}
}

// ─── GET: indicadores (mês atual + série mensal) ───────────────────────────────

type realocMesAtual struct {
	Movimentos int `json:"movimentos"`
	Lotes      int `json:"lotes"`
	Ruas       int `json:"ruas"`
	Produtos   int `json:"produtos"`
	CurvaA     int `json:"curva_a"`
	ComObs     int `json:"com_obs"`
}

type indicadorMes struct {
	Mes              string `json:"mes"`                // YYYY-MM
	RealocMovimentos int    `json:"realoc_movimentos"`
	RealocLotes      int    `json:"realoc_lotes"`
	CalibCiclos      int    `json:"calib_ciclos"`
	CalibSkus        int    `json:"calib_skus"`
}

// SpRealocacaoIndicadoresHandler retorna KPIs de realocação do mês e a série mensal.
func SpRealocacaoIndicadoresHandler(db *sql.DB) http.HandlerFunc {
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

		cdFilter := r.URL.Query().Get("cd_id")
		var cdID *int
		if cdFilter != "" {
			if v, err := strconv.Atoi(cdFilter); err == nil {
				cdID = &v
			}
		}

		// ── Mês atual (realocação) ──
		var mes realocMesAtual
		_ = db.QueryRow(`
			SELECT
				COALESCE(SUM(i.cnt), 0)                         AS movimentos,
				COUNT(DISTINCT l.id)                            AS lotes,
				COUNT(DISTINCT l.rua)                           AS ruas,
				COALESCE(SUM(i.distintos), 0)                   AS produtos,
				COALESCE(SUM(i.curva_a), 0)                     AS curva_a,
				COALESCE(SUM(i.com_obs), 0)                     AS com_obs
			FROM smartpick.sp_realocacao_lote l
			JOIN LATERAL (
				SELECT COUNT(*) AS cnt,
				       COUNT(DISTINCT codprod) AS distintos,
				       COUNT(*) FILTER (WHERE classe_venda = 'A') AS curva_a,
				       COUNT(*) FILTER (WHERE observacao IS NOT NULL AND observacao <> '') AS com_obs
				FROM smartpick.sp_realocacao_item it WHERE it.lote_id = l.id
			) i ON TRUE
			WHERE l.empresa_id = $1
			  AND ($2::int IS NULL OR l.cd_id = $2)
			  AND date_trunc('month', l.criado_em) = date_trunc('month', now())
		`, spCtx.EmpresaID, cdID).Scan(&mes.Movimentos, &mes.Lotes, &mes.Ruas, &mes.Produtos, &mes.CurvaA, &mes.ComObs)

		// ── Série mensal de realocação (últimos 6 meses) ──
		porMes := map[string]*indicadorMes{}
		ordem := []string{}
		ensure := func(m string) *indicadorMes {
			if porMes[m] == nil {
				porMes[m] = &indicadorMes{Mes: m}
				ordem = append(ordem, m)
			}
			return porMes[m]
		}

		rrows, err := db.Query(`
			SELECT TO_CHAR(date_trunc('month', l.criado_em), 'YYYY-MM') AS mes,
			       COUNT(DISTINCT l.id) AS lotes,
			       COALESCE(SUM((SELECT COUNT(*) FROM smartpick.sp_realocacao_item it WHERE it.lote_id = l.id)), 0) AS movimentos
			FROM smartpick.sp_realocacao_lote l
			WHERE l.empresa_id = $1
			  AND ($2::int IS NULL OR l.cd_id = $2)
			  AND l.criado_em >= date_trunc('month', now()) - interval '5 months'
			GROUP BY 1 ORDER BY 1
		`, spCtx.EmpresaID, cdID)
		if err == nil {
			defer rrows.Close()
			for rrows.Next() {
				var m string
				var lotes, mov int
				if rrows.Scan(&m, &lotes, &mov) == nil {
					e := ensure(m)
					e.RealocLotes = lotes
					e.RealocMovimentos = mov
				}
			}
		}

		// ── Série mensal de calibração (ciclos concluídos + SKUs aprovados) ──
		crows, err := db.Query(`
			SELECT TO_CHAR(date_trunc('month', h.concluido_em), 'YYYY-MM') AS mes,
			       COUNT(*) AS ciclos,
			       COALESCE(SUM(h.aprovadas), 0) AS skus
			FROM smartpick.sp_historico h
			WHERE h.empresa_id = $1
			  AND h.status = 'concluido' AND h.concluido_em IS NOT NULL
			  AND ($2::int IS NULL OR h.cd_id = $2)
			  AND h.concluido_em >= date_trunc('month', now()) - interval '5 months'
			GROUP BY 1 ORDER BY 1
		`, spCtx.EmpresaID, cdID)
		if err == nil {
			defer crows.Close()
			for crows.Next() {
				var m string
				var ciclos, skus int
				if crows.Scan(&m, &ciclos, &skus) == nil {
					e := ensure(m)
					e.CalibCiclos = ciclos
					e.CalibSkus = skus
				}
			}
		}

		mensal := make([]indicadorMes, 0, len(ordem))
		// ordem pode ter meses fora de ordem (realoc antes de calib); reordena
		seen := map[string]bool{}
		for _, m := range ordem {
			if !seen[m] {
				seen[m] = true
				mensal = append(mensal, *porMes[m])
			}
		}
		// ordena por mês asc
		for i := 0; i < len(mensal); i++ {
			for j := i + 1; j < len(mensal); j++ {
				if mensal[j].Mes < mensal[i].Mes {
					mensal[i], mensal[j] = mensal[j], mensal[i]
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"mes_atual": mes,
			"mensal":    mensal,
		})
	}
}
