package handlers

// sp_relatorios_faturamento_pdf.go — download HTTP do PDF do snapshot de
// Faturamento sem Calibragem. A montagem do PDF (maroto) mora em
// services.GerarPDFFaturamentoSemCalibragem — reaproveitada também pelo
// anexo do e-mail (services/faturamento_email.go), pra gerar exatamente o
// mesmo PDF nos dois lugares.
//
// GET /api/sp/relatorios-faturamento/{id}/pdf

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"fb_smartpick/services"
)

// SpRelatoriosFaturamentoPDFHandler gera o PDF do snapshot de faturamento {id}.
func SpRelatoriosFaturamentoPDFHandler(db *sql.DB) http.HandlerFunc {
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

		path := strings.TrimPrefix(r.URL.Path, "/api/sp/relatorios-faturamento/")
		path = strings.TrimSuffix(path, "/pdf")
		id, _ := strconv.Atoi(strings.Trim(path, "/"))
		if id == 0 {
			http.Error(w, "id obrigatório", http.StatusBadRequest)
			return
		}

		// Carrega o snapshot, garantindo que o CD pertence à empresa da sessão
		var (
			periodoIni, periodoFim, dadosJSON, criadoEm string
		)
		err := db.QueryRow(`
			SELECT to_char(r.periodo_inicio, 'DD/MM/YYYY'),
			       to_char(r.periodo_fim,   'DD/MM/YYYY'),
			       r.dados_json::text,
			       to_char(r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
			  FROM smartpick.sp_relatorios_faturamento r
			  JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
			 WHERE r.id = $1 AND cd.empresa_id = $2
		`, id, spCtx.EmpresaID).Scan(&periodoIni, &periodoFim, &dadosJSON, &criadoEm)
		if err == sql.ErrNoRows {
			http.Error(w, "Relatório não encontrado", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		var resp services.FaturamentoSemCalibragemResponse
		_ = json.Unmarshal([]byte(dadosJSON), &resp)

		logoBytes, logoExt, temLogo := services.BuscarLogoEmpresa(db, spCtx.EmpresaID)
		pdfBytes, err := services.GerarPDFFaturamentoSemCalibragem(&resp, periodoIni, periodoFim, criadoEm, logoBytes, logoExt, temLogo)
		if err != nil {
			http.Error(w, "Erro ao gerar PDF: "+err.Error(), http.StatusInternalServerError)
			return
		}

		filename := services.NomeArquivoPDFFaturamento(resp.CdNome, periodoFim)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.Write(pdfBytes)
	}
}
