package handlers

// sp_faturamento_sem_calibragem.go — Monitor de Faturamento sem Calibragem (Farol)
//
// GET /api/sp/faturamento-sem-calibragem?cd_id=X
//
// Cruza produtos Curva A/B faturados no Farol (últimos 30 dias) com sp_propostas
// aprovadas do SmartPick no mesmo período, listando os produtos faturados sem
// calibragem aprovada correspondente. Ver skills/implementation-artifacts/
// spec-farol-faturamento-sem-calibragem.md — spec é a fonte da verdade.
//
// Tratamento de erro (Acceptance Criteria da spec):
//   - Farol indisponível (timeout/erro HTTP/404 lá)                 → 502, mensagem amigável
//   - falha na query de classificação Curva ABC (sp_enderecos)      → 500 explícito, nunca mapa vazio
//   - falha na query de propostas aprovadas (sp_propostas)          → 500 explícito, nunca "nenhum aprovado"
//   - falha de banco genuína na busca do CD (não "CD inexistente")  → 500, distinto do 404

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"fb_smartpick/services"
)

// ─── DTOs ───────────────────────────────────────────────────────────────────

// FaturamentoPendenciaItem é um produto Curva A/B faturado no Farol sem
// calibragem aprovada correspondente nos últimos 30 dias.
type FaturamentoPendenciaItem struct {
	CodProd     int     `json:"codprod"`
	Produto     string  `json:"produto,omitempty"`
	ClasseVenda string  `json:"classe_venda"`
	QtdFaturada float64 `json:"qtd_faturada"`
}

// FaturamentoSemCalibragemResponse é a resposta completa do painel.
type FaturamentoSemCalibragemResponse struct {
	CdID       int    `json:"cd_id"`
	CdNome     string `json:"cd_nome"`
	FilialNome string `json:"filial_nome"`

	PeriodoInicio string `json:"periodo_inicio"` // YYYY-MM-DD
	PeriodoFim    string `json:"periodo_fim"`    // YYYY-MM-DD

	Pendencias []FaturamentoPendenciaItem `json:"pendencias"`

	// Diagnóstico: produtos do Farol que não bateram com nenhum codprod
	// Curva A/B do SmartPick (código desconhecido ou fora de A/B). Também logado.
	TotalNaoCorrespondencias int `json:"total_nao_correspondencias"`
}

// ─── Handler ────────────────────────────────────────────────────────────────

func SpFaturamentoSemCalibragemHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}

		cdIDStr := r.URL.Query().Get("cd_id")
		if cdIDStr == "" {
			http.Error(w, `{"error":"cd_id obrigatório"}`, http.StatusBadRequest)
			return
		}
		cdID, err := strconv.Atoi(cdIDStr)
		if err != nil {
			http.Error(w, `{"error":"cd_id inválido"}`, http.StatusBadRequest)
			return
		}

		// ── Resolve CD: 404 (genuinamente inexistente/fora da empresa) vs 500
		//    (falha real de banco) — AC explícita da spec, nunca confundir os dois. ──
		info, err := services.ResolveCDFarolInfo(db, cdID, spCtx.EmpresaID)
		if err != nil {
			if errors.Is(err, services.ErrCDNaoEncontrado) {
				http.Error(w, `{"error":"CD não encontrado"}`, http.StatusNotFound)
			} else {
				log.Printf("[faturamento-sem-calibragem] erro de banco consultando CD %d: %v", cdID, err)
				http.Error(w, `{"error":"Erro interno ao consultar CD"}`, http.StatusInternalServerError)
			}
			return
		}

		// Escopo de filial já resolvido pelo middleware (SmartPickContext) —
		// gestor_filial só enxerga CDs das filiais vinculadas a ele.
		if !spCtx.HasFilialAccess(info.FilialID) {
			http.Error(w, `{"error":"Forbidden: CD fora do escopo de filiais do usuário"}`, http.StatusForbidden)
			return
		}

		hoje := time.Now()
		periodoIni := hoje.AddDate(0, 0, -30)

		// ── Classificação Curva ABC (sp_enderecos, importação CALIBRACAO mais
		//    recente e concluída do CD). Falha de query NUNCA vira mapa vazio
		//    silencioso — isso faria todo produto do Farol virar "não-correspondência"
		//    e o painel mentir "Nenhuma pendência". ──────────────────────────────
		curvaMap, err := carregarClassificacaoCurva(db, cdID)
		if err != nil {
			log.Printf("[faturamento-sem-calibragem] erro carregando classificação Curva ABC do CD %d: %v", cdID, err)
			http.Error(w, `{"error":"Erro interno ao carregar classificação de produtos"}`, http.StatusInternalServerError)
			return
		}

		// ── Propostas aprovadas nos últimos 30 dias. Falha de query NUNCA é
		//    tratada como "nenhum produto aprovado" — isso geraria falsos positivos. ──
		aprovados, err := carregarCodprodsAprovados(db, cdID, periodoIni)
		if err != nil {
			log.Printf("[faturamento-sem-calibragem] erro carregando propostas aprovadas do CD %d: %v", cdID, err)
			http.Error(w, `{"error":"Erro interno ao carregar calibragens aprovadas"}`, http.StatusInternalServerError)
			return
		}

		// ── Farol: produtos faturados na filial do CD (janela 30d) ──────────────
		produtosFarol, err := services.GetProdutosFaturados(info.CodFilial, periodoIni, hoje)
		if err != nil {
			log.Printf("[faturamento-sem-calibragem] Farol indisponível (CD=%d cod_filial=%d): %v", cdID, info.CodFilial, err)
			http.Error(w, `{"error":"Integração com Farol indisponível"}`, http.StatusBadGateway)
			return
		}

		// ── Comparação ────────────────────────────────────────────────────────
		type agregado struct {
			classe  string
			produto string
			qtd     float64
		}
		porCodprod := map[int]*agregado{}
		naoCorrespondencias := 0

		for _, p := range produtosFarol {
			codprod, convErr := strconv.Atoi(strings.TrimSpace(p.CodProd))
			if convErr != nil {
				naoCorrespondencias++
				continue
			}
			classif, ok := curvaMap[codprod]
			if !ok || (classif.classe != "A" && classif.classe != "B") {
				// Sem correspondência em sp_enderecos, ou fora de Curva A/B:
				// ignorado silenciosamente na lista, contado agregadamente p/ diagnóstico.
				naoCorrespondencias++
				continue
			}
			if aprovados[codprod] {
				continue // já tem calibragem aprovada recente — não é pendência
			}
			if ag, exists := porCodprod[codprod]; exists {
				ag.qtd += p.Qt
			} else {
				porCodprod[codprod] = &agregado{classe: classif.classe, produto: classif.produto, qtd: p.Qt}
			}
		}

		if naoCorrespondencias > 0 {
			log.Printf("[faturamento-sem-calibragem] CD=%d: %d produto(s) do Farol sem correspondência Curva A/B em sp_enderecos", cdID, naoCorrespondencias)
		}

		pendencias := make([]FaturamentoPendenciaItem, 0, len(porCodprod))
		for codprod, ag := range porCodprod {
			pendencias = append(pendencias, FaturamentoPendenciaItem{
				CodProd:     codprod,
				Produto:     ag.produto,
				ClasseVenda: ag.classe,
				QtdFaturada: ag.qtd,
			})
		}
		sort.Slice(pendencias, func(i, j int) bool { return pendencias[i].CodProd < pendencias[j].CodProd })

		resp := FaturamentoSemCalibragemResponse{
			CdID:                     cdID,
			CdNome:                   info.CdNome,
			FilialNome:               info.FilialNome,
			PeriodoInicio:            periodoIni.Format("2006-01-02"),
			PeriodoFim:               hoje.Format("2006-01-02"),
			Pendencias:               pendencias,
			TotalNaoCorrespondencias: naoCorrespondencias,
		}
		json.NewEncoder(w).Encode(resp)
	}
}

// ─── Queries internas ───────────────────────────────────────────────────────

type classificacaoProduto struct {
	classe  string
	produto string
}

// carregarClassificacaoCurva retorna a classificação Curva ABC (apenas A/B) de
// cada codprod a partir da importação CALIBRACAO concluída mais recente do CD
// (mesmo padrão de calcularEvolucaoAcesso em resumo_executivo.go). Erro de
// query ou de iteração (rows.Err()) é sempre propagado — nunca mapa vazio
// silencioso quando a causa é falha de banco.
func carregarClassificacaoCurva(db *sql.DB, cdID int) (map[int]classificacaoProduto, error) {
	rows, err := db.Query(`
		WITH job AS (
			SELECT id FROM smartpick.sp_csv_jobs
			 WHERE cd_id = $1 AND status = 'done'
			 ORDER BY created_at DESC LIMIT 1
		)
		SELECT e.codprod, e.classe_venda, COALESCE(e.produto, '')
		  FROM smartpick.sp_enderecos e
		 WHERE e.job_id = (SELECT id FROM job)
		   AND e.tipo_rel = 'CALIBRACAO'
		   AND e.classe_venda IN ('A', 'B')
	`, cdID)
	if err != nil {
		return nil, fmt.Errorf("query classificação Curva ABC: %w", err)
	}
	defer rows.Close()

	out := map[int]classificacaoProduto{}
	for rows.Next() {
		var codprod int
		var classe, produto string
		if err := rows.Scan(&codprod, &classe, &produto); err != nil {
			return nil, fmt.Errorf("scan classificação Curva ABC: %w", err)
		}
		out[codprod] = classificacaoProduto{classe: classe, produto: produto}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração classificação Curva ABC: %w", err)
	}
	return out, nil
}

// carregarCodprodsAprovados retorna o set de codprod com sp_propostas aprovada
// (status='aprovada', aprovado_em >= desde) para o CD. Erro de query ou de
// iteração (rows.Err()) é sempre propagado — nunca "nenhum produto aprovado".
func carregarCodprodsAprovados(db *sql.DB, cdID int, desde time.Time) (map[int]bool, error) {
	rows, err := db.Query(`
		SELECT DISTINCT codprod
		  FROM smartpick.sp_propostas
		 WHERE cd_id = $1 AND status = 'aprovada' AND tipo_rel = 'CALIBRACAO'
		   AND aprovado_em >= $2
	`, cdID, desde)
	if err != nil {
		return nil, fmt.Errorf("query propostas aprovadas: %w", err)
	}
	defer rows.Close()

	out := map[int]bool{}
	for rows.Next() {
		var codprod int
		if err := rows.Scan(&codprod); err != nil {
			return nil, fmt.Errorf("scan propostas aprovadas: %w", err)
		}
		out[codprod] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração propostas aprovadas: %w", err)
	}
	return out, nil
}
