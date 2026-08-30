package handlers

// sp_relatorios_faturamento.go — Handlers manuais do relatório de Faturamento
// sem Calibragem: gerar snapshot, ver detalhe e enviar por email. Espelha
// exatamente o padrão de sp_resumos.go (SpResumoGerarHandler/SpResumoItemHandler/
// SpResumoEnviarHandler) — spec-faturamento-pdf-email.md.
//
// Rotas (registradas em main.go, dispatch por sufixo em /api/sp/relatorios-faturamento/):
//   POST /api/sp/relatorios-faturamento/gerar?cd_id=X → cria o snapshot
//   GET  /api/sp/relatorios-faturamento/{id}          → detalhe (json)
//   POST /api/sp/relatorios-faturamento/{id}/enviar   → envia por email
//   GET  /api/sp/relatorios-faturamento/{id}/pdf       → (sp_relatorios_faturamento_pdf.go)

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"fb_smartpick/services"
)

// SpRelatoriosFaturamentoGerarHandler — POST /api/sp/relatorios-faturamento/gerar?cd_id=X
//
//	gera o snapshot do painel de Faturamento sem Calibragem e retorna o id criado.
func SpRelatoriosFaturamentoGerarHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
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

		// Mesma checagem de autorização do GET ao vivo (404 vs 500 vs 403) —
		// nunca gerar/persistir um snapshot para um CD fora do escopo do usuário.
		info, err := services.ResolveCDFarolInfo(db, cdID, spCtx.EmpresaID)
		if err != nil {
			if errors.Is(err, services.ErrCDNaoEncontrado) {
				http.Error(w, `{"error":"CD não encontrado"}`, http.StatusNotFound)
			} else {
				log.Printf("[relatorios-faturamento] erro de banco consultando CD %d: %v", cdID, err)
				http.Error(w, `{"error":"Erro interno ao consultar CD"}`, http.StatusInternalServerError)
			}
			return
		}
		if !spCtx.HasFilialAccess(info.FilialID) {
			http.Error(w, `{"error":"Forbidden: CD fora do escopo de filiais do usuário"}`, http.StatusForbidden)
			return
		}

		id, _, err := services.GerarRelatorioFaturamento(db, cdID, spCtx.EmpresaID, spCtx.UserID)
		if err != nil {
			log.Printf("[relatorios-faturamento] CD=%d erro ao gerar: %v", cdID, err)
			status := http.StatusInternalServerError
			if errors.Is(err, services.ErrFarolIndisponivel) {
				status = http.StatusBadGateway
			}
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), status)
			return
		}

		log.Printf("[relatorios-faturamento] CD=%d sucesso, relatório id=%d", cdID, id)
		json.NewEncoder(w).Encode(map[string]int{"id": id})
	}
}

// SpRelatoriosFaturamentoItemHandler — GET /api/sp/relatorios-faturamento/{id}
//
//	detalhe completo do snapshot (dados json), escopado à empresa da sessão.
func SpRelatoriosFaturamentoItemHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/sp/relatorios-faturamento/")
		id, _ := strconv.Atoi(strings.Trim(path, "/"))
		if id == 0 {
			http.Error(w, `{"error":"id obrigatório"}`, http.StatusBadRequest)
			return
		}

		var (
			cdID                   int
			periodoIni, periodoFim string
			dadosJSON              string
			criadoEm               string
			enviadoEm, erroEnvio   sql.NullString
		)
		err := db.QueryRow(`
			SELECT r.cd_id,
			       to_char(r.periodo_inicio, 'YYYY-MM-DD'),
			       to_char(r.periodo_fim, 'YYYY-MM-DD'),
			       r.dados_json::text,
			       to_char(r.criado_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       to_char(r.enviado_em, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       COALESCE(r.erro_envio, '')
			  FROM smartpick.sp_relatorios_faturamento r
			  JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
			 WHERE r.id = $1 AND cd.empresa_id = $2
		`, id, spCtx.EmpresaID).Scan(&cdID, &periodoIni, &periodoFim, &dadosJSON, &criadoEm, &enviadoEm, &erroEnvio)
		if err == sql.ErrNoRows {
			http.Error(w, `{"error":"Relatório não encontrado"}`, http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
			return
		}

		// dados_json vem como string; embute como objeto cru
		out := map[string]interface{}{
			"id":             id,
			"cd_id":          cdID,
			"periodo_inicio": periodoIni,
			"periodo_fim":    periodoFim,
			"dados":          json.RawMessage(dadosJSON),
			"criado_em":      criadoEm,
			"enviado_em":     enviadoEm.String,
			"erro_envio":     erroEnvio.String,
		}
		json.NewEncoder(w).Encode(out)
	}
}

// SpRelatoriosFaturamentoEnviarHandler — POST /api/sp/relatorios-faturamento/{id}/enviar
//
//	envia o snapshot por email aos destinatários ativos do CD.
func SpRelatoriosFaturamentoEnviarHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}

		// Path: /api/sp/relatorios-faturamento/{id}/enviar
		path := strings.TrimPrefix(r.URL.Path, "/api/sp/relatorios-faturamento/")
		path = strings.TrimSuffix(path, "/enviar")
		id, _ := strconv.Atoi(strings.Trim(path, "/"))
		if id == 0 {
			http.Error(w, `{"error":"id obrigatório"}`, http.StatusBadRequest)
			return
		}

		// Garante que o snapshot pertence à empresa da sessão antes de enviar
		// (mesmo escopo aplicado ao detalhe/PDF).
		var existe bool
		_ = db.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM smartpick.sp_relatorios_faturamento r
				JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
				WHERE r.id = $1 AND cd.empresa_id = $2
			)
		`, id, spCtx.EmpresaID).Scan(&existe)
		if !existe {
			http.Error(w, `{"error":"Relatório não encontrado"}`, http.StatusNotFound)
			return
		}

		enviados, err := services.EnviarFaturamentoPorEmail(db, id)
		erroMsg := ""
		if err != nil {
			erroMsg = err.Error()
		}
		if len(enviados) > 0 {
			_ = services.MarcarEnviadoFaturamento(db, id, enviados, erroMsg)
		}
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"enviados": enviados,
			"total":    len(enviados),
		})
	}
}
