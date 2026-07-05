package handlers

// sp_resumo_pdf.go — PDF do Resumo Executivo Semanal (com logo da empresa)
//
// GET /api/sp/relatorios/{id}/pdf
// Gera um PDF A4 retrato com: logo da empresa (com fallback de grupo, mesmo
// critério do ServeEmpresaLogoHandler), cabeçalho com CD/filial/período,
// KPIs da semana, bloco de realocações e a narrativa da IA renderizada.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"fb_smartpick/services"

	"github.com/johnfercher/maroto/v2"
	"github.com/johnfercher/maroto/v2/pkg/components/col"
	"github.com/johnfercher/maroto/v2/pkg/components/image"
	"github.com/johnfercher/maroto/v2/pkg/components/row"
	"github.com/johnfercher/maroto/v2/pkg/components/text"
	"github.com/johnfercher/maroto/v2/pkg/config"
	"github.com/johnfercher/maroto/v2/pkg/consts/align"
	"github.com/johnfercher/maroto/v2/pkg/consts/extension"
	"github.com/johnfercher/maroto/v2/pkg/consts/fontstyle"
	"github.com/johnfercher/maroto/v2/pkg/core"
	"github.com/johnfercher/maroto/v2/pkg/props"
)

// buscarLogoEmpresa retorna os bytes e a extensão do logo da empresa (própria
// ou de irmã do mesmo grupo). Só PNG/JPEG são embutíveis no PDF (gofpdf).
func buscarLogoEmpresa(db *sql.DB, empresaID string) ([]byte, extension.Type, bool) {
	var data []byte
	var mime string
	err := db.QueryRow(`
		SELECT logo_data, logo_mime FROM companies
		WHERE id = $1::uuid AND logo_data IS NOT NULL
	`, empresaID).Scan(&data, &mime)
	if err == sql.ErrNoRows {
		err = db.QueryRow(`
			SELECT s.logo_data, s.logo_mime
			FROM companies c
			JOIN companies s ON s.group_id = c.group_id
			WHERE c.id = $1::uuid AND c.group_id IS NOT NULL AND s.logo_data IS NOT NULL
			ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
			LIMIT 1
		`, empresaID).Scan(&data, &mime)
	}
	if err != nil || len(data) == 0 {
		return nil, "", false
	}
	switch {
	case strings.Contains(mime, "png"):
		return data, extension.Png, true
	case strings.Contains(mime, "jpg"), strings.Contains(mime, "jpeg"):
		return data, extension.Jpg, true
	default:
		return nil, "", false // webp/svg: não suportados pelo gerador
	}
}

// quebrarLinhas quebra um texto em linhas de até max caracteres em limites de palavra.
func quebrarLinhas(s string, max int) []string {
	var out []string
	for _, par := range strings.Split(s, "\n") {
		par = strings.TrimRight(par, " ")
		if par == "" {
			out = append(out, "")
			continue
		}
		for len(par) > max {
			cut := strings.LastIndex(par[:max], " ")
			if cut <= 0 {
				cut = max
			}
			out = append(out, par[:cut])
			par = strings.TrimLeft(par[cut:], " ")
		}
		out = append(out, par)
	}
	return out
}

// mdParaLinhasPDF converte o markdown da narrativa em linhas tipadas p/ o PDF.
type linhaPDF struct {
	texto  string
	titulo bool
}

func mdParaLinhasPDF(md string) []linhaPDF {
	limpa := strings.NewReplacer("**", "", "*", "", "`", "")
	var out []linhaPDF
	for _, l := range strings.Split(md, "\n") {
		l = strings.TrimRight(l, " ")
		switch {
		case strings.HasPrefix(l, "## "):
			out = append(out, linhaPDF{texto: strings.TrimPrefix(l, "## "), titulo: true})
		case strings.HasPrefix(l, "# "):
			out = append(out, linhaPDF{texto: strings.TrimPrefix(l, "# "), titulo: true})
		default:
			for _, w := range quebrarLinhas(limpa.Replace(l), 100) {
				out = append(out, linhaPDF{texto: w})
			}
		}
	}
	return out
}

// SpResumoPDFHandler gera o PDF do resumo executivo {id}.
func SpResumoPDFHandler(db *sql.DB) http.HandlerFunc {
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

		path := strings.TrimPrefix(r.URL.Path, "/api/sp/relatorios/")
		path = strings.TrimSuffix(path, "/pdf")
		id, _ := strconv.Atoi(strings.Trim(path, "/"))
		if id == 0 {
			http.Error(w, "id obrigatório", http.StatusBadRequest)
			return
		}

		// Carrega o relatório, garantindo que o CD pertence à empresa da sessão
		var (
			periodoIni, periodoFim, dadosJSON, narrativa, criadoEm string
		)
		err := db.QueryRow(`
			SELECT to_char(r.periodo_inicio, 'DD/MM/YYYY'),
			       to_char(r.periodo_fim,   'DD/MM/YYYY'),
			       r.dados_json::text, r.narrativa_md,
			       to_char(r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
			  FROM smartpick.sp_relatorios_semanais r
			  JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
			 WHERE r.id = $1 AND cd.empresa_id = $2
		`, id, spCtx.EmpresaID).Scan(&periodoIni, &periodoFim, &dadosJSON, &narrativa, &criadoEm)
		if err == sql.ErrNoRows {
			http.Error(w, "Relatório não encontrado", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		var k services.KPIsResumoExecutivo
		_ = json.Unmarshal([]byte(dadosJSON), &k)

		// ── Monta o PDF ───────────────────────────────────────────────────
		cfg := config.NewBuilder().
			WithLeftMargin(14).WithRightMargin(14).WithTopMargin(12).
			Build()
		mrt := maroto.New(cfg)

		cinza := &props.Color{Red: 100, Green: 100, Blue: 100}
		azul := &props.Color{Red: 30, Green: 58, Blue: 95}

		// Cabeçalho: logo (se houver) + título + CD/período
		logoBytes, logoExt, temLogo := buscarLogoEmpresa(db, spCtx.EmpresaID)
		headerCols := []core.Col{}
		if temLogo {
			headerCols = append(headerCols,
				image.NewFromBytesCol(2, logoBytes, logoExt, props.Rect{Center: true, Percent: 90}))
		} else {
			headerCols = append(headerCols, col.New(2))
		}
		headerCols = append(headerCols, col.New(10).Add(
			text.New("Resumo Executivo Semanal — SmartPick", props.Text{
				Size: 14, Style: fontstyle.Bold, Top: 1, Color: azul,
			}),
			text.New(fmt.Sprintf("%s — %s  ·  Período: %s a %s  ·  Gerado em %s",
				k.CdNome, k.FilialNome, periodoIni, periodoFim, criadoEm), props.Text{
				Size: 9, Top: 9, Color: cinza,
			}),
		))
		mrt.AddRows(row.New(18).Add(headerCols...))

		// ── KPIs da semana ────────────────────────────────────────────────
		kpiCell := func(titulo, valor string) core.Col {
			return col.New(2).Add(
				text.New(titulo, props.Text{Size: 7, Color: cinza, Align: align.Center}),
				text.New(valor, props.Text{Size: 12, Style: fontstyle.Bold, Top: 4, Align: align.Center}),
			)
		}
		mrt.AddRows(
			row.New(6).Add(col.New(12).Add(
				text.New("CALIBRAGEM DA SEMANA", props.Text{Size: 9, Style: fontstyle.Bold, Color: azul}),
			)),
			row.New(12).Add(
				kpiCell("Propostas", strconv.Itoa(k.TotalPropostas)),
				kpiCell("Aprovadas", strconv.Itoa(k.TotalAprovadas)),
				kpiCell("Rejeitadas", strconv.Itoa(k.TotalRejeitadas)),
				kpiCell("Pendentes", strconv.Itoa(k.TotalPendentes)),
				kpiCell("Aprovação %", fmt.Sprintf("%.0f%%", k.TaxaAprovacaoPct)),
				kpiCell("Compliance %", fmt.Sprintf("%.0f%%", k.TaxaCompliancePct)),
			),
		)

		// ── Realocações (quando houver) ───────────────────────────────────
		if k.RealocMovimentos > 0 {
			mrt.AddRows(
				row.New(6).Add(col.New(12).Add(
					text.New("REALOCAÇÕES DA SEMANA", props.Text{Size: 9, Style: fontstyle.Bold, Color: azul}),
				)),
				row.New(12).Add(
					kpiCell("Movimentos", strconv.Itoa(k.RealocMovimentos)),
					kpiCell("Lotes", strconv.Itoa(k.RealocLotes)),
					kpiCell("Ruas", strconv.Itoa(k.RealocRuas)),
					kpiCell("Curva A", strconv.Itoa(k.RealocCurvaA)),
					col.New(4),
				),
			)
		}

		// ── Itens realocados: antes → depois, por data e rua ──────────────
		if len(k.RealocItens) > 0 {
			hdr := func(t string, size int, al align.Type) core.Col {
				return col.New(size).Add(text.New(t, props.Text{
					Size: 7, Style: fontstyle.Bold, Color: azul, Align: al,
				}))
			}
			cell := func(t string, size int, al align.Type, bold bool) core.Col {
				st := fontstyle.Normal
				if bold {
					st = fontstyle.Bold
				}
				return col.New(size).Add(text.New(t, props.Text{Size: 7.5, Style: st, Align: al}))
			}
			mrt.AddRows(
				row.New(7).Add(col.New(12).Add(
					text.New(fmt.Sprintf("ITENS REALOCADOS — ANTES → DEPOIS (%d)", len(k.RealocItens)),
						props.Text{Size: 9, Style: fontstyle.Bold, Top: 2, Color: azul}),
				)),
				row.New(5).Add(
					hdr("Data", 2, align.Left),
					hdr("Rua", 1, align.Center),
					hdr("Cód.", 1, align.Left),
					hdr("Produto", 3, align.Left),
					hdr("Cv", 1, align.Center),
					hdr("Antes", 2, align.Center),
					hdr("Depois", 2, align.Center),
				),
			)
			for _, it := range k.RealocItens {
				prod := it.Produto
				if len(prod) > 34 {
					prod = prod[:34] + "…"
				}
				mrt.AddRows(row.New(4.5).Add(
					cell(it.Data, 2, align.Left, false),
					cell(strconv.Itoa(it.Rua), 1, align.Center, false),
					cell(strconv.Itoa(it.Codprod), 1, align.Left, false),
					cell(prod, 3, align.Left, false),
					cell(it.Curva, 1, align.Center, true),
					cell(it.Antes, 2, align.Center, false),
					cell(it.Depois, 2, align.Center, true),
				))
				if it.Observacao != "" {
					mrt.AddRows(row.New(4).Add(
						col.New(2),
						col.New(10).Add(text.New("Obs: "+it.Observacao, props.Text{
							Size: 7, Color: cinza,
						})),
					))
				}
			}
			if len(k.RealocItens) == 200 {
				mrt.AddRows(row.New(5).Add(col.New(12).Add(
					text.New("Lista limitada aos primeiros 200 movimentos do período.", props.Text{Size: 7, Color: cinza}),
				)))
			}
		}

		// ── Narrativa da IA ───────────────────────────────────────────────
		mrt.AddRows(row.New(8).Add(col.New(12).Add(
			text.New("ANÁLISE", props.Text{Size: 9, Style: fontstyle.Bold, Top: 3, Color: azul}),
		)))
		for _, l := range mdParaLinhasPDF(narrativa) {
			switch {
			case l.titulo:
				mrt.AddRows(row.New(7).Add(col.New(12).Add(
					text.New(l.texto, props.Text{Size: 10, Style: fontstyle.Bold, Top: 2}),
				)))
			case l.texto == "":
				mrt.AddRows(row.New(2))
			default:
				mrt.AddRows(row.New(4.5).Add(col.New(12).Add(
					text.New(l.texto, props.Text{Size: 9}),
				)))
			}
		}

		mrt.AddRows(row.New(8).Add(col.New(12).Add(
			text.New("SmartPick — gerado automaticamente", props.Text{
				Size: 7, Color: cinza, Top: 4,
			}),
		)))

		doc, err := mrt.Generate()
		if err != nil {
			http.Error(w, "Erro ao gerar PDF: "+err.Error(), http.StatusInternalServerError)
			return
		}

		filename := fmt.Sprintf("resumo_executivo_%s_%s.pdf",
			strings.ReplaceAll(k.CdNome, " ", "_"),
			strings.ReplaceAll(periodoFim, "/", "-"))
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.Write(doc.GetBytes())
	}
}
