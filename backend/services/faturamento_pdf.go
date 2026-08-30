package services

// faturamento_pdf.go — geração do PDF do snapshot de Faturamento sem
// Calibragem (com logo da empresa). Reaproveitada tanto pelo download manual
// (backend/handlers/sp_relatorios_faturamento_pdf.go) quanto pelo anexo do
// e-mail (EnviarFaturamentoPorEmail, em faturamento_email.go) — mesmo PDF,
// gerado uma única vez a partir do snapshot salvo (não ao vivo).
//
// Layout pensado para leitura executiva: cabeçalho da tabela repete em toda
// página, zebra striping, KPIs em ribbon e paginação.

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/johnfercher/maroto/v2"
	"github.com/johnfercher/maroto/v2/pkg/components/col"
	"github.com/johnfercher/maroto/v2/pkg/components/image"
	"github.com/johnfercher/maroto/v2/pkg/components/row"
	"github.com/johnfercher/maroto/v2/pkg/components/text"
	"github.com/johnfercher/maroto/v2/pkg/config"
	"github.com/johnfercher/maroto/v2/pkg/consts/align"
	"github.com/johnfercher/maroto/v2/pkg/consts/border"
	"github.com/johnfercher/maroto/v2/pkg/consts/extension"
	"github.com/johnfercher/maroto/v2/pkg/consts/fontstyle"
	"github.com/johnfercher/maroto/v2/pkg/consts/orientation"
	"github.com/johnfercher/maroto/v2/pkg/core"
	"github.com/johnfercher/maroto/v2/pkg/props"
)

// BuscarLogoEmpresa retorna os bytes e a extensão do logo da empresa (própria
// ou de irmã do mesmo grupo). Só PNG/JPEG são embutíveis no PDF (gofpdf).
// Compartilhada entre os PDFs de Resumo Executivo e Faturamento sem Calibragem.
func BuscarLogoEmpresa(db *sql.DB, empresaID string) ([]byte, extension.Type, bool) {
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

// formatarMilhar formata um número com separador de milhar (.) e decimal
// (,) no padrão BR — sem depender de golang.org/x/text só por isso.
func formatarMilhar(v float64, casas int) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := strconv.FormatFloat(v, 'f', casas, 64)
	intPart, decPart, _ := strings.Cut(s, ".")

	var out []byte
	n := len(intPart)
	for i := 0; i < n; i++ {
		if i > 0 && (n-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, intPart[i])
	}
	res := string(out)
	if decPart != "" {
		res += "," + decPart
	}
	if neg {
		res = "-" + res
	}
	return res
}

func formatarMilharInt(v int) string {
	return formatarMilhar(float64(v), 0)
}

// GerarPDFFaturamentoSemCalibragem monta o PDF A4 paisagem do snapshot: logo
// (se houver), cabeçalho com CD/filial/período, ribbon de KPIs (pendências,
// curva A/B, nunca calibrados, acessos ao picking) e a tabela de produtos
// pendentes (Curva/Cód./Produto/Qtd faturada/Status/Gap/Acessos).
func GerarPDFFaturamentoSemCalibragem(resp *FaturamentoSemCalibragemResponse, periodoIni, periodoFim, criadoEm string, logoBytes []byte, logoExt extension.Type, temLogo bool) ([]byte, error) {
	// ── Agregados do resumo (sobre o total, não só as linhas exibidas) ──
	var curvaA, curvaB, nuncaCalibrados, totalAcessos int
	for _, p := range resp.Pendencias {
		switch p.ClasseVenda {
		case "A":
			curvaA++
		case "B":
			curvaB++
		}
		if p.UltimoStatus == "nunca" {
			nuncaCalibrados++
		}
		if p.AcessosPicking != nil {
			totalAcessos += *p.AcessosPicking
		}
	}

	// ── Monta o PDF ───────────────────────────────────────────────────
	cfg := config.NewBuilder().
		WithOrientation(orientation.Horizontal).
		WithLeftMargin(14).WithRightMargin(14).WithTopMargin(12).WithBottomMargin(10).
		WithPageNumber(props.PageNumber{
			Pattern: "Página {current} de {total}",
			Place:   props.RightBottom,
			Size:    7.5,
			Color:   &props.Color{Red: 130, Green: 130, Blue: 130},
		}).
		Build()
	mrt := maroto.New(cfg)

	cinza := &props.Color{Red: 100, Green: 100, Blue: 100}
	azul := &props.Color{Red: 30, Green: 58, Blue: 95}
	branco := &props.Color{Red: 255, Green: 255, Blue: 255}
	cinzaCard := &props.Color{Red: 244, Green: 246, Blue: 249}
	cinzaZebra := &props.Color{Red: 246, Green: 247, Blue: 249}
	cinzaBorda := &props.Color{Red: 210, Green: 214, Blue: 220}
	vermelho := &props.Color{Red: 176, Green: 44, Blue: 44}
	verde := &props.Color{Red: 30, Green: 122, Blue: 72}

	// Cabeçalho: logo (se houver) + título + CD/período
	headerCols := []core.Col{}
	if temLogo {
		headerCols = append(headerCols,
			image.NewFromBytesCol(2, logoBytes, logoExt, props.Rect{Center: true, Percent: 90}))
	} else {
		headerCols = append(headerCols, col.New(2))
	}
	headerCols = append(headerCols, col.New(10).Add(
		text.New("Faturamento sem Calibragem — SmartPick", props.Text{
			Size: 15, Style: fontstyle.Bold, Top: 1, Color: azul,
		}),
		text.New(fmt.Sprintf("%s — %s  ·  Período: %s a %s  ·  Gerado em %s",
			resp.CdNome, resp.FilialNome, periodoIni, periodoFim, criadoEm), props.Text{
			Size: 9, Top: 10, Color: cinza,
		}),
	))
	mrt.AddRows(row.New(18).Add(headerCols...))

	// ── Resumo: cards de KPI num único ribbon, sem espaço morto ────────
	statCard := func(titulo, valor string, comDivisoria bool) core.Col {
		c := col.New(3)
		if comDivisoria {
			c = c.WithStyle(&props.Cell{
				BorderColor:     branco,
				BorderType:      border.Left,
				BorderThickness: 1,
			})
		}
		return c.Add(
			text.New(titulo, props.Text{Size: 6.5, Style: fontstyle.Bold, Color: cinza, Top: 3.5, Left: 6}),
			text.New(valor, props.Text{Size: 15, Style: fontstyle.Bold, Color: azul, Top: 8, Left: 6}),
		)
	}
	mrt.AddRows(
		row.New(17).WithStyle(&props.Cell{
			BackgroundColor: cinzaCard,
			BorderColor:     cinzaBorda,
			BorderType:      border.Top | border.Bottom,
			BorderThickness: 0.5,
		}).Add(
			statCard("PRODUTOS PENDENTES", formatarMilharInt(len(resp.Pendencias)), false),
			statCard("CURVA A  /  CURVA B", fmt.Sprintf("%s / %s", formatarMilharInt(curvaA), formatarMilharInt(curvaB)), true),
			statCard("NUNCA CALIBRADOS", formatarMilharInt(nuncaCalibrados), true),
			statCard("ACESSOS AO PICKING (90D)", formatarMilharInt(totalAcessos), true),
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
				Size: 8, Style: fontstyle.Bold, Color: branco, Align: al, Top: 3.2, Left: 2, Right: 2,
			}))
		}
		cell := func(t string, size int, al align.Type, bold bool, cor *props.Color) core.Col {
			st := fontstyle.Normal
			if bold {
				st = fontstyle.Bold
			}
			return col.New(size).Add(text.New(t, props.Text{
				Size: 7.5, Style: st, Align: al, Top: 1.4, Left: 2, Right: 2, Color: cor,
			}))
		}
		listados := resp.Pendencias
		titulo := fmt.Sprintf("PRODUTOS PENDENTES (%s)", formatarMilharInt(len(resp.Pendencias)))
		if len(listados) > maxLinhasPDF {
			listados = listados[:maxLinhasPDF]
			titulo = fmt.Sprintf("PRODUTOS PENDENTES — %s maiores gaps de %s no total",
				formatarMilharInt(maxLinhasPDF), formatarMilharInt(len(resp.Pendencias)))
		}
		mrt.AddRows(row.New(9).Add(col.New(12).Add(
			text.New(titulo, props.Text{Size: 9.5, Style: fontstyle.Bold, Top: 4, Color: azul}),
		)))

		// Cabeçalho da tabela registrado como header do documento: repete
		// automaticamente no topo de toda página (essencial numa lista de
		// até 300 linhas / ~17 páginas — sem isso só a 1ª página tem os
		// nomes das colunas).
		_ = mrt.RegisterHeader(
			row.New(6.5).WithStyle(&props.Cell{BackgroundColor: azul}).Add(
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
		_ = mrt.RegisterFooter(
			row.New(8).Add(col.New(12).Add(
				text.New("SmartPick — gerado automaticamente", props.Text{
					Size: 7, Color: cinza, Top: 3,
				}),
			)),
		)

		for i, p := range listados {
			prod := p.Produto
			// Corte de segurança apenas para nomes absurdamente longos — a
			// altura da linha é automática (abaixo), então um nome que
			// quebra em 2+ linhas não sobrepõe mais a linha seguinte (achado
			// do usuário: com altura fixa, nomes de ~30 chars já colidiam).
			if len(prod) > 90 {
				prod = prod[:90] + "…"
			}
			gap := "—"
			gapCor := cinza
			if p.Gap != nil {
				gap = formatarMilharInt(*p.Gap)
				if *p.Gap < 0 {
					gapCor = vermelho
				} else if *p.Gap > 0 {
					gap = "+" + gap
					gapCor = verde
				}
			}
			atualizado := p.UltimaAtualizacao
			if atualizado == "" {
				atualizado = "—"
			}
			acessos := "—"
			if p.AcessosPicking != nil {
				acessos = formatarMilharInt(*p.AcessosPicking)
			}
			linha := row.New().Add(
				cell(p.ClasseVenda, 1, align.Center, true, nil),
				cell(strconv.Itoa(p.CodProd), 1, align.Left, false, nil),
				cell(prod, 3, align.Left, false, nil),
				cell(formatarMilhar(p.QtdFaturada, 2), 2, align.Right, false, nil),
				cell(p.UltimoStatus, 2, align.Left, false, nil),
				cell(gap, 1, align.Right, true, gapCor),
				cell(atualizado, 1, align.Center, false, nil),
				cell(acessos, 1, align.Right, false, nil),
			)
			if i%2 == 1 {
				linha = linha.WithStyle(&props.Cell{BackgroundColor: cinzaZebra})
			}
			mrt.AddRows(linha)
		}
		if len(resp.Pendencias) > maxLinhasPDF {
			mrt.AddRows(row.New(7).Add(col.New(12).Add(
				text.New(fmt.Sprintf("+ %s produto(s) adicional(is) — veja a lista completa no painel do SmartPick.",
					formatarMilharInt(len(resp.Pendencias)-maxLinhasPDF)),
					props.Text{Size: 8, Color: cinza, Top: 3}),
			)))
		}
	} else {
		mrt.AddRows(row.New(8).Add(col.New(12).Add(
			text.New("Nenhuma pendência no período coberto por este snapshot.", props.Text{Size: 9, Color: cinza}),
		)))
	}

	doc, err := mrt.Generate()
	if err != nil {
		return nil, err
	}
	return doc.GetBytes(), nil
}

// NomeArquivoPDFFaturamento monta o nome de arquivo padrão do PDF de
// faturamento — usado tanto no Content-Disposition do download quanto no
// nome do anexo do e-mail.
func NomeArquivoPDFFaturamento(cdNome, periodoFim string) string {
	return fmt.Sprintf("faturamento_sem_calibragem_%s_%s.pdf",
		strings.ReplaceAll(cdNome, " ", "_"),
		strings.ReplaceAll(periodoFim, "/", "-"))
}
