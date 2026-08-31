package services

// faturamento_email.go — Envio por email do snapshot de Faturamento sem
// Calibragem (manual ou pelo worker diário). Segue o padrão de
// EnviarResumoPorEmail/buildResumoHTML/buildResumoPlainText em
// resumo_executivo.go (spec-faturamento-pdf-email.md) — resumo dos números
// principais + o PDF completo (services.GerarPDFFaturamentoSemCalibragem)
// anexado como binário (multipart/mixed) — decisão renegociada em
// 2026-08-30 (a versão anterior só linkava pro painel).

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// MarcarEnviadoFaturamento atualiza o snapshot com os destinatários e o
// timestamp de envio — mesmo padrão de MarcarEnviado (resumo_executivo.go).
func MarcarEnviadoFaturamento(db *sql.DB, relatorioID int, enviadoPara []string, erroEnvio string) error {
	// Postgres TEXT[] literal: '{a@b.com,c@d.com}'
	_, err := db.Exec(`
		UPDATE smartpick.sp_relatorios_faturamento
		   SET enviado_em = NOW(), enviado_para = $2, erro_envio = NULLIF($3, '')
		 WHERE id = $1
	`, relatorioID, "{"+strings.Join(enviadoPara, ",")+"}", erroEnvio)
	return err
}

// EnviarFaturamentoPorEmail busca destinatários ativos do CD (mesma lista de
// smartpick.sp_destinatarios_resumo usada pelo Resumo Executivo — reaproveitada
// como está, sem coluna de tipo de relatório) e envia o snapshot {relatorioID}
// por email, retornando a lista de emails enviados e mensagem de erro (se houver).
// Reaproveita GetEmailConfig + sendMailSSL do email.go (herdado, não modificado).
func EnviarFaturamentoPorEmail(db *sql.DB, relatorioID int) ([]string, error) {
	log.Printf("[faturamento] enviando snapshot %d por email", relatorioID)

	// Carrega o snapshot (+ empresa_id do CD, pro logo, e criado_em, pro
	// cabeçalho do PDF anexado — mesmos dados que o download manual usa).
	var (
		cdID                             int
		empresaID                        string
		periodoIni, periodoFim, criadoEm string
		dadosJSON                        string
	)
	err := db.QueryRow(`
		SELECT r.cd_id, cd.empresa_id,
		       to_char(r.periodo_inicio, 'DD/MM/YYYY'),
		       to_char(r.periodo_fim, 'DD/MM/YYYY'),
		       to_char(r.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
		       r.dados_json::text
		  FROM smartpick.sp_relatorios_faturamento r
		  JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
		 WHERE r.id = $1
	`, relatorioID).Scan(&cdID, &empresaID, &periodoIni, &periodoFim, &criadoEm, &dadosJSON)
	if err != nil {
		return nil, fmt.Errorf("relatório não encontrado: %w", err)
	}

	var resp FaturamentoSemCalibragemResponse
	if err := json.Unmarshal([]byte(dadosJSON), &resp); err != nil {
		return nil, fmt.Errorf("parse dados_json: %w", err)
	}
	cdNome := resp.CdNome
	if cdNome == "" {
		cdNome = fmt.Sprintf("CD %d", cdID)
	}

	// Lista de destinatários ativos do CD
	rows, err := db.Query(`
		SELECT email, nome_completo
		  FROM smartpick.sp_destinatarios_resumo
		 WHERE cd_id = $1 AND ativo = TRUE
	`, cdID)
	if err != nil {
		return nil, fmt.Errorf("listar destinatários: %w", err)
	}
	defer rows.Close()

	type destinatario struct{ Email, Nome string }
	var destinos []destinatario
	for rows.Next() {
		var d destinatario
		if rows.Scan(&d.Email, &d.Nome) == nil {
			destinos = append(destinos, d)
		}
	}

	if len(destinos) == 0 {
		// Diagnóstico: contadores e onde o usuário pode estar cadastrado —
		// mesmo padrão de EnviarResumoPorEmail (resumo_executivo.go).
		var total, inativos int
		_ = db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT ativo) FROM smartpick.sp_destinatarios_resumo WHERE cd_id = $1`, cdID).Scan(&total, &inativos)

		outrosRows, _ := db.Query(`
			SELECT DISTINCT c.id, c.nome, COUNT(d.id) AS qtd
			  FROM smartpick.sp_destinatarios_resumo d
			  JOIN smartpick.sp_centros_dist c ON c.id = d.cd_id
			 WHERE d.ativo = TRUE
			 GROUP BY c.id, c.nome
			 ORDER BY c.nome
			 LIMIT 5
		`)
		outros := []string{}
		if outrosRows != nil {
			defer outrosRows.Close()
			for outrosRows.Next() {
				var id, qtd int
				var nome string
				if outrosRows.Scan(&id, &nome, &qtd) == nil {
					outros = append(outros, fmt.Sprintf("%s (id=%d, %d destinatários)", nome, id, qtd))
				}
			}
		}

		log.Printf("[faturamento] CD=%d (%s) sem destinatários ativos. total=%d inativos=%d. CDs com destinatários: %v",
			cdID, cdNome, total, inativos, outros)

		msg := fmt.Sprintf("Nenhum destinatário ativo cadastrado para o CD %q (id=%d).", cdNome, cdID)
		if total > 0 {
			msg += fmt.Sprintf(" Há %d cadastrado(s) neste CD mas todos estão inativos.", total)
		}
		if len(outros) > 0 {
			msg += " Destinatários ativos existem em: " + strings.Join(outros, "; ") + "."
		} else {
			msg += " Cadastre em Configurações → Destinatários Resumo."
		}
		return nil, fmt.Errorf("%s", msg)
	}
	log.Printf("[faturamento] CD=%d (%s) %d destinatários ativos: enviando", cdID, cdNome, len(destinos))

	cfg := GetEmailConfig()
	if cfg.Password == "" {
		return nil, fmt.Errorf("SMTP não configurado")
	}

	subject := fmt.Sprintf("SmartPick - Faturamento sem Calibragem %s (%s)", resp.CdNome, periodoFim)
	html := buildFaturamentoHTML(&resp, periodoIni, periodoFim)
	plain := buildFaturamentoPlainText(&resp, periodoIni, periodoFim)

	// PDF anexado — mesmo gerador do download manual (services.GerarPDFFaturamentoSemCalibragem),
	// gerado uma única vez pra todos os destinatários. Falha ao gerar o PDF
	// não deve impedir o e-mail com o resumo de sair — só some o anexo.
	logoBytes, logoExt, temLogo := BuscarLogoEmpresa(db, empresaID)
	pdfBytes, pdfErr := GerarPDFFaturamentoSemCalibragem(&resp, periodoIni, periodoFim, criadoEm, logoBytes, logoExt, temLogo)
	if pdfErr != nil {
		log.Printf("[faturamento] aviso: falha ao gerar PDF pro anexo do snapshot %d (email segue sem anexo): %v", relatorioID, pdfErr)
		pdfBytes = nil
	}
	pdfFilename := NomeArquivoPDFFaturamento(resp.CdNome, periodoFim)

	enviados := []string{}
	for _, d := range destinos {
		mixBoundary := fmt.Sprintf("ft_mix_%d", time.Now().UnixNano())
		altBoundary := fmt.Sprintf("ft_alt_%d", time.Now().UnixNano())
		var msg strings.Builder
		fmt.Fprintf(&msg, "From: %s\r\n", cfg.From)
		fmt.Fprintf(&msg, "To: %s <%s>\r\n", d.Nome, d.Email)
		fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
		msg.WriteString("MIME-Version: 1.0\r\n")
		fmt.Fprintf(&msg, "Content-Type: multipart/mixed; boundary=%q\r\n\r\n", mixBoundary)

		// parte 1: corpo do email (plain + html)
		fmt.Fprintf(&msg, "--%s\r\n", mixBoundary)
		fmt.Fprintf(&msg, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", altBoundary)
		fmt.Fprintf(&msg, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", altBoundary, plain)
		fmt.Fprintf(&msg, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n", altBoundary, html)
		fmt.Fprintf(&msg, "--%s--\r\n", altBoundary)

		// parte 2: PDF anexado (se a geração deu certo)
		if len(pdfBytes) > 0 {
			fmt.Fprintf(&msg, "--%s\r\n", mixBoundary)
			fmt.Fprintf(&msg, "Content-Type: application/pdf; name=%q\r\n", pdfFilename)
			msg.WriteString("Content-Transfer-Encoding: base64\r\n")
			fmt.Fprintf(&msg, "Content-Disposition: attachment; filename=%q\r\n\r\n", pdfFilename)
			b64 := base64.StdEncoding.EncodeToString(pdfBytes)
			for i := 0; i < len(b64); i += 76 {
				end := i + 76
				if end > len(b64) {
					end = len(b64)
				}
				msg.WriteString(b64[i:end])
				msg.WriteString("\r\n")
			}
		}
		fmt.Fprintf(&msg, "--%s--\r\n", mixBoundary)

		var sendErr error
		if cfg.Port == 465 {
			sendErr = sendMailSSL(cfg, []string{d.Email}, []byte(msg.String()))
		} else {
			sendErr = fmt.Errorf("porta SMTP %d não suportada (somente 465)", cfg.Port)
		}
		if sendErr != nil {
			log.Printf("[faturamento] ✗ erro envio para %s: %v", d.Email, sendErr)
			continue
		}
		log.Printf("[faturamento] ✓ enviado para %s", d.Email)
		enviados = append(enviados, d.Email)
	}
	log.Printf("[faturamento] envio concluído: %d/%d destinatários receberam o snapshot %d",
		len(enviados), len(destinos), relatorioID)

	if len(enviados) == 0 {
		return nil, fmt.Errorf("falha ao enviar para todos os %d destinatários", len(destinos))
	}
	return enviados, nil
}

// ─── Renderização do email ─────────────────────────────────────────────────

// buildFaturamentoHTML monta o corpo HTML: número de pendências e top 3-5
// produtos por gap (maior primeiro — resp.Pendencias já vem ordenado dessa
// forma por ColetarFaturamentoSemCalibragem). Sem link pro painel — o PDF
// completo vai anexado no e-mail, então basta o anexo.
func buildFaturamentoHTML(r *FaturamentoSemCalibragemResponse, periodoIni, periodoFim string) string {
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:680px;margin:0 auto;background:#f4f4f8}
.wrap{padding:20px}
.hdr{background:#2d3748;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;text-align:center}
.hdr-logo{font-size:20px;font-weight:700}
.hdr-sub{font-size:13px;color:#cbd5e0;margin-top:4px}
.body{background:#fff;padding:22px;border-radius:0 0 8px 8px}
.info-box{background:#fff7ed;border-left:4px solid #d97706;padding:10px 14px;margin:0 0 18px;border-radius:0 6px 6px 0;font-size:12px;color:#92400e}
.alert-box{background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin:0 0 18px;border-radius:0 6px 6px 0;font-size:13px;color:#7f1d1d;line-height:1.55}
.sec{margin:18px 0}
.sec-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#718096;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px}
.kpi-table{width:100%;border-collapse:separate;border-spacing:6px}
.kpi-cell{border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center;background:#f7fafc}
.kpi-label{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#718096}
.kpi-val{font-size:18px;font-weight:700;color:#2d3748;margin:2px 0}
table.dt{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}
table.dt th{background:#4a5568;color:#fff;padding:6px 10px;text-align:left;font-size:11px}
table.dt td{padding:6px 10px;border-bottom:1px solid #e2e8f0}
.footer{text-align:center;padding:14px;color:#a0aec0;font-size:11px}
</style></head><body><div class="wrap">`)

	fmt.Fprintf(&sb, `<div class="hdr"><div class="hdr-logo">SmartPick</div><div class="hdr-sub">Faturamento sem Calibragem &mdash; %s</div></div>`, r.CdNome)

	sb.WriteString(`<div class="body">`)
	fmt.Fprintf(&sb, `<div class="info-box"><strong>CD:</strong> %s &nbsp;|&nbsp; <strong>Filial:</strong> %s &nbsp;|&nbsp; <strong>Per&iacute;odo:</strong> %s a %s</div>`,
		r.CdNome, r.FilialNome, periodoIni, periodoFim)

	// Chamada de atenção: dimensiona o esforço de calibragem/realocação
	// pendente pro gestor bater o olho antes de entrar nos números frios.
	if len(r.Pendencias) > 0 {
		curvaA, totalAcessos := 0, 0
		for _, p := range r.Pendencias {
			if p.ClasseVenda == "A" {
				curvaA++
			}
			if p.AcessosPicking != nil {
				totalAcessos += *p.AcessosPicking
			}
		}
		fmt.Fprintf(&sb, `<div class="alert-box">&#9888;&#65039; <strong>%s produtos</strong> faturados entre %s e %s seguem sem calibragem aprovada`,
			formatarMilharInt(len(r.Pendencias)), periodoIni, periodoFim)
		if curvaA > 0 {
			fmt.Fprintf(&sb, ` &mdash; <strong>%s de Curva A</strong> (alto giro)`, formatarMilharInt(curvaA))
		}
		sb.WriteString(`. Isso significa capacidade de picking desatualizada`)
		if totalAcessos > 0 {
			fmt.Fprintf(&sb, ` e j&aacute; gerou <strong>%s acessos</strong> ao endere&ccedil;o de separa&ccedil;&atilde;o nesse per&iacute;odo`, formatarMilharInt(totalAcessos))
		}
		sb.WriteString(`. Priorizar a calibragem e a realoca&ccedil;&atilde;o desses itens reduz deslocamento e agiliza a separa&ccedil;&atilde;o.</div>`)
	}

	// KPI: número de pendências
	sb.WriteString(`<div class="sec"><div class="sec-title">Resumo</div><table class="kpi-table"><tr>`)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Produtos pendentes</div><div class="kpi-val" style="color:#d97706">%s</div></td>`, formatarMilharInt(len(r.Pendencias)))
	sb.WriteString(`</tr></table></div>`)

	// Top 3-5 produtos por gap (maior primeiro)
	if len(r.Pendencias) > 0 {
		max := 5
		if len(r.Pendencias) < max {
			max = len(r.Pendencias)
		}
		sb.WriteString(`<div class="sec"><div class="sec-title">Top produtos por gap</div><table class="dt"><thead><tr><th>C&oacute;d.</th><th>Produto</th><th>Curva</th><th style="text-align:right">Qtd. faturada</th><th style="text-align:right">Gap</th></tr></thead><tbody>`)
		for _, p := range r.Pendencias[:max] {
			gap := "—"
			if p.Gap != nil {
				gap = fmt.Sprintf("%+d", *p.Gap)
			}
			fmt.Fprintf(&sb, `<tr><td>%d</td><td>%s</td><td>%s</td><td style="text-align:right">%s</td><td style="text-align:right">%s</td></tr>`,
				p.CodProd, p.Produto, p.ClasseVenda, formatQtdFaturada(p.QtdFaturada), gap)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	sb.WriteString(`</div><div class="footer">&copy; SmartPick &mdash; Calibragem Inteligente de Picking</div></div></body></html>`)
	return sb.String()
}

func buildFaturamentoPlainText(r *FaturamentoSemCalibragemResponse, periodoIni, periodoFim string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "SmartPick - Faturamento sem Calibragem\n\nCD: %s\nFilial: %s\nPeriodo: %s a %s\n\n", r.CdNome, r.FilialNome, periodoIni, periodoFim)
	fmt.Fprintf(&sb, "Produtos pendentes: %s\n\n", formatarMilharInt(len(r.Pendencias)))

	if len(r.Pendencias) > 0 {
		curvaA, totalAcessos := 0, 0
		for _, p := range r.Pendencias {
			if p.ClasseVenda == "A" {
				curvaA++
			}
			if p.AcessosPicking != nil {
				totalAcessos += *p.AcessosPicking
			}
		}
		sb.WriteString("ATENCAO: ")
		fmt.Fprintf(&sb, "%s produtos faturados entre %s e %s seguem sem calibragem aprovada", formatarMilharInt(len(r.Pendencias)), periodoIni, periodoFim)
		if curvaA > 0 {
			fmt.Fprintf(&sb, " (%s de Curva A, alto giro)", formatarMilharInt(curvaA))
		}
		sb.WriteString(". Isso significa capacidade de picking desatualizada")
		if totalAcessos > 0 {
			fmt.Fprintf(&sb, " e ja gerou %s acessos ao endereco de separacao nesse periodo", formatarMilharInt(totalAcessos))
		}
		sb.WriteString(". Priorizar a calibragem e a realocacao desses itens reduz deslocamento e agiliza a separacao.\n\n")
	}

	if len(r.Pendencias) > 0 {
		max := 5
		if len(r.Pendencias) < max {
			max = len(r.Pendencias)
		}
		sb.WriteString("=== TOP PRODUTOS POR GAP ===\n")
		for _, p := range r.Pendencias[:max] {
			gap := "-"
			if p.Gap != nil {
				gap = fmt.Sprintf("%+d", *p.Gap)
			}
			fmt.Fprintf(&sb, "%d | %s | Curva %s | %s faturado | gap %s\n",
				p.CodProd, p.Produto, p.ClasseVenda, formatQtdFaturada(p.QtdFaturada), gap)
		}
		sb.WriteString("\n")
	}

	sb.WriteString("O PDF completo esta anexado a este e-mail.\n\n---\n(c) SmartPick\n")
	return sb.String()
}

// formatQtdFaturada formata a quantidade faturada sem casas decimais
// espúrias (o Farol normalmente retorna valores inteiros, mas o campo é
// float64 no contrato — nunca trunca informação real).
func formatQtdFaturada(qtd float64) string {
	if qtd == float64(int64(qtd)) {
		return fmt.Sprintf("%d", int64(qtd))
	}
	return fmt.Sprintf("%.2f", qtd)
}
