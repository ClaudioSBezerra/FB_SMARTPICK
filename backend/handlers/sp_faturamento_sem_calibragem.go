package handlers

// sp_faturamento_sem_calibragem.go — Monitor de Faturamento sem Calibragem (Farol)
//
// GET /api/sp/faturamento-sem-calibragem?cd_id=X
//
// A coleta/comparação em si vive em services.ColetarFaturamentoSemCalibragem
// (extraída para ser reaproveitada pelo snapshot manual/worker — ver
// skills/implementation-artifacts/spec-faturamento-pdf-email.md). Este handler
// só resolve o CD para a checagem de autorização (403 fora do escopo de
// filiais do usuário) e delega o resto — a resposta e o comportamento
// continuam idênticos aos de antes da extração. Ver também
// skills/implementation-artifacts/spec-farol-faturamento-sem-calibragem.md.
//
// Tratamento de erro (Acceptance Criteria da spec original):
//   - Farol indisponível (timeout/erro HTTP/404 lá)                 → 502, mensagem amigável
//   - falha na query de classificação Curva ABC (sp_enderecos)      → 500 explícito, nunca mapa vazio
//   - falha na query de propostas aprovadas (sp_propostas)          → 500 explícito, nunca "nenhum aprovado"
//   - falha de banco genuína na busca do CD (não "CD inexistente")  → 500, distinto do 404

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"fb_smartpick/services"
)

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

		resp, err := services.ColetarFaturamentoSemCalibragem(db, cdID, spCtx.EmpresaID)
		if err != nil {
			if errors.Is(err, services.ErrFarolIndisponivel) {
				log.Printf("[faturamento-sem-calibragem] Farol indisponível (CD=%d): %v", cdID, err)
				http.Error(w, `{"error":"Integração com Farol indisponível"}`, http.StatusBadGateway)
			} else if errors.Is(err, services.ErrCDNaoEncontrado) {
				// Corrida improvável (CD removido entre as duas resoluções) —
				// mesmo mapeamento HTTP do bloco de resolução acima.
				http.Error(w, `{"error":"CD não encontrado"}`, http.StatusNotFound)
			} else {
				log.Printf("[faturamento-sem-calibragem] erro coletando dados do CD %d: %v", cdID, err)
				http.Error(w, `{"error":"Erro interno ao carregar o painel"}`, http.StatusInternalServerError)
			}
			return
		}

		json.NewEncoder(w).Encode(resp)
	}
}
