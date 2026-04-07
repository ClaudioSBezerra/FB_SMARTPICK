package handlers

// sp_pdf.go — Geração de PDF Operacional de Calibragem
//
// Story 6.1 — Geração de PDF no Backend
//
// GET /api/sp/pdf/calibracao?job_id=X   → PDF das propostas aprovadas de um job
// GET /api/sp/pdf/calibracao?cd_id=Y    → PDF das últimas propostas aprovadas de um CD
//
// O PDF contém:
//   - Cabeçalho: nome do CD, filial, data de geração
//   - Tabela por curva (A / B / C): endereço, produto, cap.atual, nova cap., delta, justificativa
//   - Rodapé com paginação

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/johnfercher/maroto/v2"
	"github.com/johnfercher/maroto/v2/pkg/components/col"
	"github.com/johnfercher/maroto/v2/pkg/components/row"
	"github.com/johnfercher/maroto/v2/pkg/components/text"
	"github.com/johnfercher/maroto/v2/pkg/config"
	"github.com/johnfercher/maroto/v2/pkg/consts/align"
	"github.com/johnfercher/maroto/v2/pkg/consts/fontstyle"
	"github.com/johnfercher/maroto/v2/pkg/core"
	"github.com/johnfercher/maroto/v2/pkg/props"
)

// ─── DTO interno ──────────────────────────────────────────────────────────────

type pdfProposta struct {
	Codprod         int
	Produto         string
	Rua, Predio, Apto *int
	ClasseVenda     string
	CapacidadeAtual *int
	NovaCapacidade  int // sugestao_editada ?? sugestao_calibragem
	Delta           int
	Justificativa   string
	AprovadoEm      string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// SpPDFCalibracaoHandler gera o PDF de calibragem das propostas aprovadas.
// GET /api/sp/pdf/calibracao?job_id=UUID  ou  ?cd_id=INT
func SpPDFCalibracaoHandler(db *sql.DB) http.HandlerFunc {
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

		jobIDStr := r.URL.Query().Get("job_id")
		cdIDStr  := r.URL.Query().Get("cd_id")
		if jobIDStr == "" && cdIDStr == "" {
			http.Error(w, "job_id ou cd_id obrigatório", http.StatusBadRequest)
			return
		}

		// ── Carrega metadados do CD / job ────────────────────────────────────
		var cdNome, filialNome, jobFilename string
		var cdID int

		if jobIDStr != "" {
			err := db.QueryRow(`
				SELECT cd.nome, f.nome, j.filename, j.cd_id
				FROM smartpick.sp_csv_jobs j
				JOIN smartpick.sp_centros_dist cd ON cd.id = j.cd_id
				JOIN smartpick.sp_filiais f ON f.id = j.filial_id
				WHERE j.id = $1 AND j.empresa_id = $2
			`, jobIDStr, spCtx.EmpresaID).Scan(&cdNome, &filialNome, &jobFilename, &cdID)
			if err == sql.ErrNoRows {
				http.Error(w, "Job não encontrado", http.StatusNotFound)
				return
			}
		} else {
			err := db.QueryRow(`
				SELECT cd.nome, f.nome, cd.id
				FROM smartpick.sp_centros_dist cd
				JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
				WHERE cd.id = $1 AND cd.empresa_id = $2
			`, cdIDStr, spCtx.EmpresaID).Scan(&cdNome, &filialNome, &cdID)
			if err == sql.ErrNoRows {
				http.Error(w, "CD não encontrado", http.StatusNotFound)
				return
			}
		}

		// ── Carrega propostas aprovadas ──────────────────────────────────────
		filter := "WHERE p.empresa_id = $1 AND p.status = 'aprovada'"
		args   := []any{spCtx.EmpresaID}
		idx    := 2

		if jobIDStr != "" {
			filter += fmt.Sprintf(" AND p.job_id = $%d", idx)
			args = append(args, jobIDStr)
			idx++
		} else {
			filter += fmt.Sprintf(" AND p.cd_id = $%d", idx)
			args = append(args, cdIDStr)
			idx++
		}
		_ = idx

		query := fmt.Sprintf(`
			SELECT p.codprod,
			       COALESCE(p.produto,''),
			       p.rua, p.predio, p.apto,
			       COALESCE(p.classe_venda,'C'),
			       p.capacidade_atual,
			       COALESCE(p.sugestao_editada, p.sugestao_calibragem),
			       p.delta,
			       COALESCE(p.justificativa,''),
			       TO_CHAR(p.aprovado_em,'DD/MM/YYYY HH24:MI')
			FROM smartpick.sp_propostas p
			%s
			ORDER BY p.classe_venda, p.rua NULLS LAST, p.predio NULLS LAST, p.apto NULLS LAST
		`, filter)

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, "Erro ao carregar propostas: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var propostas []pdfProposta
		for rows.Next() {
			var p pdfProposta
			var aprovadoEm *string
			if err := rows.Scan(
				&p.Codprod, &p.Produto,
				&p.Rua, &p.Predio, &p.Apto,
				&p.ClasseVenda,
				&p.CapacidadeAtual,
				&p.NovaCapacidade,
				&p.Delta,
				&p.Justificativa,
				&aprovadoEm,
			); err != nil {
				continue
			}
			if aprovadoEm != nil {
				p.AprovadoEm = *aprovadoEm
			}
			propostas = append(propostas, p)
		}

		if len(propostas) == 0 {
			http.Error(w, "Nenhuma proposta aprovada encontrada", http.StatusNotFound)
			return
		}

		// ── Gera PDF ─────────────────────────────────────────────────────────
		bytes, err := buildPDF(cdNome, filialNome, jobFilename, propostas)
		if err != nil {
			http.Error(w, "Erro ao gerar PDF: "+err.Error(), http.StatusInternalServerError)
			return
		}

		filename := fmt.Sprintf("calibracao_%s_%s.pdf",
			sanitizeFilename(cdNome),
			time.Now().Format("20060102"))

		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(bytes)))
		w.Write(bytes)
	}
}

// ─── Construção do PDF com maroto v2 ─────────────────────────────────────────

func buildPDF(cdNome, filialNome, jobFilename string, propostas []pdfProposta) ([]byte, error) {
	cfg := config.NewBuilder().
		WithPageNumber(props.PageNumber{
			Pattern: "Pág. {current}/{total}",
			Place:   props.RightBottom,
		}).
		WithLeftMargin(10).
		WithRightMargin(10).
		WithTopMargin(15).
		Build()

	mrt := maroto.New(cfg)

	// ── Cabeçalho ──────────────────────────────────────────────────────────
	mrt.AddRows(
		row.New(12).Add(
			col.New(12).Add(
				text.New("Relatório de Calibragem de Picking", props.Text{
					Size:  14,
					Style: fontstyle.Bold,
					Align: align.Center,
				}),
			),
		),
		row.New(7).Add(
			col.New(6).Add(
				text.New(fmt.Sprintf("CD: %s — Filial: %s", cdNome, filialNome), props.Text{
					Size:  9,
					Style: fontstyle.Normal,
				}),
			),
			col.New(6).Add(
				text.New(fmt.Sprintf("Gerado em: %s", time.Now().Format("02/01/2006 15:04")), props.Text{
					Size:  9,
					Align: align.Right,
				}),
			),
		),
	)

	if jobFilename != "" {
		mrt.AddRows(
			row.New(6).Add(
				col.New(12).Add(
					text.New(fmt.Sprintf("Importação: %s", jobFilename), props.Text{
						Size:  8,
						Style: fontstyle.Italic,
					}),
				),
			),
		)
	}

	// Separador
	mrt.AddRows(row.New(3).Add(col.New(12)))

	// ── Resumo por curva ──────────────────────────────────────────────────
	countA, countB, countC := 0, 0, 0
	for _, p := range propostas {
		switch p.ClasseVenda {
		case "A":
			countA++
		case "B":
			countB++
		default:
			countC++
		}
	}
	mrt.AddRows(
		row.New(7).Add(
			col.New(12).Add(
				text.New(fmt.Sprintf(
					"Total de propostas aprovadas: %d   (Curva A: %d | Curva B: %d | Curva C: %d)",
					len(propostas), countA, countB, countC,
				), props.Text{Size: 8, Style: fontstyle.Italic}),
			),
		),
		row.New(2).Add(col.New(12)), // espaço
	)

	// ── Cabeçalho da tabela ────────────────────────────────────────────────
	mrt.AddRows(tableHeaderRow())

	// ── Linhas por curva ───────────────────────────────────────────────────
	curvas := []string{"A", "B", "C"}
	for _, curva := range curvas {
		var grupo []pdfProposta
		for _, p := range propostas {
			if p.ClasseVenda == curva {
				grupo = append(grupo, p)
			}
		}
		if len(grupo) == 0 {
			continue
		}

		// Separador de curva
		mrt.AddRows(
			row.New(6).Add(
				col.New(12).Add(
					text.New(fmt.Sprintf("── Curva %s (%d itens) ──", curva, len(grupo)), props.Text{
						Size:  8,
						Style: fontstyle.Bold,
					}),
				),
			),
		)

		for _, p := range grupo {
			mrt.AddRows(tableDataRow(p))
		}
	}

	doc, err := mrt.Generate()
	if err != nil {
		return nil, err
	}
	return doc.GetBytes(), nil
}

// ─── Helpers de tabela ────────────────────────────────────────────────────────

func tableHeaderRow() core.Row {
	hProps := props.Text{Size: 7, Style: fontstyle.Bold, Align: align.Center}
	return row.New(6).Add(
		col.New(1).Add(text.New("Curva",     hProps)),
		col.New(2).Add(text.New("Endereço",  hProps)),
		col.New(1).Add(text.New("Cód.",      hProps)),
		col.New(3).Add(text.New("Produto",   hProps)),
		col.New(1).Add(text.New("Cap.Atual", hProps)),
		col.New(1).Add(text.New("Nova Cap.", hProps)),
		col.New(1).Add(text.New("Ação",      hProps)),
		col.New(2).Add(text.New("Justificativa", hProps)),
	)
}

func tableDataRow(p pdfProposta) core.Row {
	dProps := props.Text{Size: 7, Align: align.Center}
	lProps := props.Text{Size: 7, Align: align.Left}

	endereco := formatEndereco(p.Rua, p.Predio, p.Apto)
	capAtual  := "—"
	if p.CapacidadeAtual != nil {
		capAtual = fmt.Sprintf("%d", *p.CapacidadeAtual)
	}
	var acaoStr string
	switch {
	case p.Delta > 0:
		acaoStr = fmt.Sprintf("+%d cx", p.Delta)
	case p.Delta < 0:
		acaoStr = fmt.Sprintf("%d cx", p.Delta)
	default:
		acaoStr = "OK"
	}

	produto := p.Produto
	if len(produto) > 30 {
		produto = produto[:28] + "…"
	}
	just := p.Justificativa
	if len(just) > 40 {
		just = just[:38] + "…"
	}

	return row.New(5).Add(
		col.New(1).Add(text.New(p.ClasseVenda,             dProps)),
		col.New(2).Add(text.New(endereco,                  dProps)),
		col.New(1).Add(text.New(fmt.Sprintf("%d", p.Codprod), dProps)),
		col.New(3).Add(text.New(produto,                   lProps)),
		col.New(1).Add(text.New(capAtual,                  dProps)),
		col.New(1).Add(text.New(fmt.Sprintf("%d", p.NovaCapacidade), dProps)),
		col.New(1).Add(text.New(acaoStr,                   dProps)),
		col.New(2).Add(text.New(just,                      lProps)),
	)
}

func formatEndereco(rua, predio, apto *int) string {
	parts := []string{}
	if rua    != nil { parts = append(parts, fmt.Sprintf("%d", *rua)) }
	if predio != nil { parts = append(parts, fmt.Sprintf("%d", *predio)) }
	if apto   != nil { parts = append(parts, fmt.Sprintf("%d", *apto)) }
	if len(parts) == 0 {
		return "—"
	}
	return strings.Join(parts, "-")
}

func sanitizeFilename(s string) string {
	result := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			result = append(result, c)
		} else {
			result = append(result, '_')
		}
	}
	return string(result)
}
