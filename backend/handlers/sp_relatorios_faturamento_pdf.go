package handlers

// sp_relatorios_faturamento_pdf.go — PDF do snapshot de Faturamento sem
// Calibragem (com logo da empresa). Espelha exatamente o padrão de
// sp_resumo_pdf.go (maroto, buscarLogoEmpresa com fallback sem logo) —
// spec-faturamento-pdf-email.md.
//
// GET /api/sp/relatorios-faturamento/{id}/pdf
//
// Gera um PDF A4 retrato com: logo da empresa (se houver), cabeçalho com
// CD/filial/período, resumo (nº de pendências) e a tabela completa de
// produtos pendentes (Curva/Cód./Produto/Qtd faturada/Status/Gap/Acessos),
// a partir do snapshot salvo (não ao vivo).

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
	"github.com/johnfercher/maroto/v2/pkg/consts/fontstyle"
	"github.com/johnfercher/maroto/v2/pkg/core"
	"github.com/johnfercher/maroto/v2/pkg/props"
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
			text.New("Faturamento sem Calibragem — SmartPick", props.Text{
				Size: 14, Style: fontstyle.Bold, Top: 1, Color: azul,
			}),
			text.New(fmt.Sprintf("%s — %s  ·  Período: %s a %s  ·  Gerado em %s",
				resp.CdNome, resp.FilialNome, periodoIni, periodoFim, criadoEm), props.Text{
				Size: 9, Top: 9, Color: cinza,
			}),
		))
		mrt.AddRows(row.New(18).Add(headerCols...))

		// ── Resumo ────────────────────────────────────────────────────────
		kpiCell := func(titulo, valor string) core.Col {
			return col.New(3).Add(
				text.New(titulo, props.Text{Size: 7, Color: cinza, Align: align.Center}),
				text.New(valor, props.Text{Size: 12, Style: fontstyle.Bold, Top: 4, Align: align.Center}),
			)
		}
		mrt.AddRows(
			row.New(6).Add(col.New(12).Add(
				text.New("RESUMO", props.Text{Size: 9, Style: fontstyle.Bold, Color: azul}),
			)),
			row.New(12).Add(
				kpiCell("Produtos pendentes", strconv.Itoa(len(resp.Pendencias))),
				kpiCell("Sem correspondência Curva A/B", strconv.Itoa(resp.TotalNaoCorrespondencias)),
				col.New(6),
			),
		)

		// ── Produtos pendentes (Curva/Cód./Produto/Qtd/Status/Gap/Acessos) ──
		// Limitado aos maiores gaps (já vem ordenado assim) — um CD pode ter
		// milhares de pendências (visto em produção: 5.234 num único CD), o que
		// tornaria o PDF impraticável (centenas de páginas, geração lenta) sem
		// agregar valor além do que a lista completa no painel já oferece.
		const maxLinhasPDF = 300
		if len(resp.Pendencias) > 0 {
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
			listados := resp.Pendencias
			titulo := fmt.Sprintf("PRODUTOS PENDENTES (%d)", len(resp.Pendencias))
			if len(listados) > maxLinhasPDF {
				listados = listados[:maxLinhasPDF]
				titulo = fmt.Sprintf("PRODUTOS PENDENTES — %d maiores gaps de %d no total", maxLinhasPDF, len(resp.Pendencias))
			}
			mrt.AddRows(
				row.New(7).Add(col.New(12).Add(
					text.New(titulo, props.Text{Size: 9, Style: fontstyle.Bold, Top: 2, Color: azul}),
				)),
				row.New(5).Add(
					hdr("Cv", 1, align.Center),
					hdr("Cód.", 1, align.Left),
					hdr("Produto", 3, align.Left),
					hdr("Qtd. fat.", 2, align.Right),
					hdr("Status", 2, align.Left),
					hdr("Gap", 1, align.Right),
					hdr("Atualiz.", 1, align.Center),
					hdr("Acessos 90d", 1, align.Right),
				),
			)
			for _, p := range listados {
				prod := p.Produto
				if len(prod) > 42 {
					prod = prod[:42] + "…"
				}
				gap := "—"
				if p.Gap != nil {
					gap = strconv.Itoa(*p.Gap)
				}
				atualizado := p.UltimaAtualizacao
				if atualizado == "" {
					atualizado = "—"
				}
				acessos := "—"
				if p.AcessosPicking != nil {
					acessos = strconv.Itoa(*p.AcessosPicking)
				}
				mrt.AddRows(row.New(4.5).Add(
					cell(p.ClasseVenda, 1, align.Center, true),
					cell(strconv.Itoa(p.CodProd), 1, align.Left, false),
					cell(prod, 3, align.Left, false),
					cell(fmt.Sprintf("%.2f", p.QtdFaturada), 2, align.Right, false),
					cell(p.UltimoStatus, 2, align.Left, false),
					cell(gap, 1, align.Right, false),
					cell(atualizado, 1, align.Center, false),
					cell(acessos, 1, align.Right, false),
				))
			}
			if len(resp.Pendencias) > maxLinhasPDF {
				mrt.AddRows(row.New(6).Add(col.New(12).Add(
					text.New(fmt.Sprintf("+ %d produto(s) adicional(is) — veja a lista completa no painel do SmartPick.", len(resp.Pendencias)-maxLinhasPDF),
						props.Text{Size: 8, Color: cinza, Top: 2}),
				)))
			}
		} else {
			mrt.AddRows(row.New(8).Add(col.New(12).Add(
				text.New("Nenhuma pendência no período coberto por este snapshot.", props.Text{Size: 9, Color: cinza}),
			)))
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

		filename := fmt.Sprintf("faturamento_sem_calibragem_%s_%s.pdf",
			strings.ReplaceAll(resp.CdNome, " ", "_"),
			strings.ReplaceAll(periodoFim, "/", "-"))
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.Write(doc.GetBytes())
	}
}
