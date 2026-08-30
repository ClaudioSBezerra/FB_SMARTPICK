package services

// faturamento_email.go — Envio por email do snapshot de Faturamento sem
// Calibragem (manual ou pelo worker diário). Segue o padrão EXATO de
// EnviarResumoPorEmail/buildResumoHTML/buildResumoPlainText em
// resumo_executivo.go (spec-faturamento-pdf-email.md) — resumo dos números
// principais + botão "Baixar PDF completo" linkando para o painel (nunca
// anexa o PDF como binário, decisão confirmada na spec).

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
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

	// Carrega o snapshot
	var (
		cdID                   int
		periodoIni, periodoFim string
		dadosJSON              string
	)
	err := db.QueryRow(`
		SELECT cd_id,
		       to_char(periodo_inicio, 'DD/MM/YYYY'),
		       to_char(periodo_fim, 'DD/MM/YYYY'),
		       dados_json::text
		  FROM smartpick.sp_relatorios_faturamento
		 WHERE id = $1
	`, relatorioID).Scan(&cdID, &periodoIni, &periodoFim, &dadosJSON)
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

	enviados := []string{}
	for _, d := range destinos {
		boundary := fmt.Sprintf("ft_%d", time.Now().UnixNano())
		var msg strings.Builder
		fmt.Fprintf(&msg, "From: %s\r\n", cfg.From)
		fmt.Fprintf(&msg, "To: %s <%s>\r\n", d.Nome, d.Email)
		fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
		msg.WriteString("MIME-Version: 1.0\r\n")
		fmt.Fprintf(&msg, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
		// plain
		fmt.Fprintf(&msg, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", boundary, plain)
		// html
		fmt.Fprintf(&msg, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n", boundary, html)
		fmt.Fprintf(&msg, "--%s--\r\n", boundary)

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

// buildFaturamentoHTML monta o corpo HTML: número de pendências, top 3-5
// produtos por gap (maior primeiro — resp.Pendencias já vem ordenado dessa
// forma por ColetarFaturamentoSemCalibragem) e o botão "Baixar PDF completo"
// linkando para o painel (nunca anexa o PDF — decisão confirmada na spec).
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

	// KPI: número de pendências
	sb.WriteString(`<div class="sec"><div class="sec-title">Resumo</div><table class="kpi-table"><tr>`)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Produtos pendentes</div><div class="kpi-val" style="color:#d97706">%d</div></td>`, len(r.Pendencias))
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Sem correspondência Curva A/B</div><div class="kpi-val">%d</div></td>`, r.TotalNaoCorrespondencias)
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

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "https://smartpick.fbtax.cloud"
	}
	fmt.Fprintf(&sb, `<div style="text-align:center;margin:22px 0"><a href="%s/faturamento-sem-calibragem" style="display:inline-block;padding:10px 24px;background:#2d3748;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px">Baixar PDF completo</a></div>`, appURL)

	sb.WriteString(`</div><div class="footer">&copy; SmartPick &mdash; Calibragem Inteligente de Picking</div></div></body></html>`)
	return sb.String()
}

func buildFaturamentoPlainText(r *FaturamentoSemCalibragemResponse, periodoIni, periodoFim string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "SmartPick - Faturamento sem Calibragem\n\nCD: %s\nFilial: %s\nPeriodo: %s a %s\n\n", r.CdNome, r.FilialNome, periodoIni, periodoFim)
	fmt.Fprintf(&sb, "Produtos pendentes: %d\n", len(r.Pendencias))
	fmt.Fprintf(&sb, "Sem correspondencia Curva A/B: %d\n\n", r.TotalNaoCorrespondencias)

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

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "https://smartpick.fbtax.cloud"
	}
	fmt.Fprintf(&sb, "Baixe o PDF completo em: %s/faturamento-sem-calibragem\n\n---\n(c) SmartPick\n", appURL)
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
