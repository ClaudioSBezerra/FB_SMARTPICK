package services

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// ── Tipos ─────────────────────────────────────────────────────────────────────

// KPIsResumoExecutivo agrega métricas do CD no período do resumo
type KPIsResumoExecutivo struct {
	CdID         int    `json:"cd_id"`
	CdNome       string `json:"cd_nome"`
	FilialNome   string `json:"filial_nome"`
	PeriodoInicio string `json:"periodo_inicio"` // YYYY-MM-DD
	PeriodoFim    string `json:"periodo_fim"`

	TotalPropostas    int `json:"total_propostas"`
	TotalAprovadas    int `json:"total_aprovadas"`
	TotalRejeitadas   int `json:"total_rejeitadas"`
	TotalPendentes    int `json:"total_pendentes"`
	TotalIgnorados    int `json:"total_ignorados"`

	Ampliar       int `json:"ampliar_slot"`
	Reduzir       int `json:"reduzir_slot"`
	Calibrados    int `json:"calibrados"`
	CurvaARevisar int `json:"curva_a_revisar"`

	TaxaAprovacaoPct float64 `json:"taxa_aprovacao_pct"`
	TaxaCompliancePct float64 `json:"taxa_compliance_pct"`

	TopMotivosRejeicao []KVPair `json:"top_motivos_rejeicao"`
	TopDeptosPendentes []KVPair `json:"top_deptos_pendentes"`
	TopProdutosCriticos []ProdutoCritico `json:"top_produtos_criticos"`

	AlertasUrgencia int `json:"alertas_urgencia"`
	AlertasAjustar  int `json:"alertas_ajustar"`
	AlertasCapMenor int `json:"alertas_cap_menor"`
}

type KVPair struct {
	Label string `json:"label"`
	Valor int    `json:"valor"`
}

type ProdutoCritico struct {
	CodProd      int    `json:"codprod"`
	Produto      string `json:"produto"`
	Departamento string `json:"departamento"`
	ClasseVenda  string `json:"classe_venda"`
	Delta        int    `json:"delta"`
	Prioridade   int    `json:"prioridade"`
}

// ── Coleta de KPIs ────────────────────────────────────────────────────────────

// ColetarKPIs busca os indicadores agregados do CD no período informado
func ColetarKPIs(db *sql.DB, cdID int, inicio, fim time.Time) (*KPIsResumoExecutivo, error) {
	k := &KPIsResumoExecutivo{
		CdID:          cdID,
		PeriodoInicio: inicio.Format("2006-01-02"),
		PeriodoFim:    fim.Format("2006-01-02"),
	}

	// Nome do CD e filial
	if err := db.QueryRow(`
		SELECT c.nome, COALESCE(f.nome, '')
		  FROM smartpick.sp_centros_dist c
	     LEFT JOIN smartpick.sp_filiais f ON f.id = c.filial_id
		 WHERE c.id = $1
	`, cdID).Scan(&k.CdNome, &k.FilialNome); err != nil {
		return nil, fmt.Errorf("CD %d não encontrado: %w", cdID, err)
	}

	// Totais por status (no período)
	if err := db.QueryRow(`
		SELECT
		  COUNT(*),
		  COUNT(*) FILTER (WHERE status = 'aprovada'),
		  COUNT(*) FILTER (WHERE status = 'rejeitada'),
		  COUNT(*) FILTER (WHERE status = 'pendente')
		  FROM smartpick.sp_propostas
		 WHERE cd_id = $1
		   AND created_at >= $2 AND created_at < $3 + INTERVAL '1 day'
	`, cdID, inicio, fim).Scan(&k.TotalPropostas, &k.TotalAprovadas, &k.TotalRejeitadas, &k.TotalPendentes); err != nil {
		log.Printf("[resumo] erro totais: %v", err)
	}

	// Ignorados ativos (estado atual — não há soft delete)
	_ = db.QueryRow(`SELECT COUNT(*) FROM smartpick.sp_ignorados WHERE cd_id = $1`, cdID).Scan(&k.TotalIgnorados)

	// Quebra por tipo (delta > 0 = ampliar, delta < 0 = reduzir, delta = 0 = calibrado)
	_ = db.QueryRow(`
		SELECT
		  COUNT(*) FILTER (WHERE delta > 0),
		  COUNT(*) FILTER (WHERE delta < 0),
		  COUNT(*) FILTER (WHERE delta = 0)
		  FROM smartpick.sp_propostas
		 WHERE cd_id = $1
		   AND created_at >= $2 AND created_at < $3 + INTERVAL '1 day'
	`, cdID, inicio, fim).Scan(&k.Ampliar, &k.Reduzir, &k.Calibrados)

	// Curva A com sugestão de redução mantida pendente (proxy de "Curva A Revisar")
	_ = db.QueryRow(`
		SELECT COUNT(*) FROM smartpick.sp_propostas
		 WHERE cd_id = $1
		   AND classe_venda = 'A'
		   AND delta < 0
		   AND status = 'pendente'
		   AND created_at >= $2 AND created_at < $3 + INTERVAL '1 day'
	`, cdID, inicio, fim).Scan(&k.CurvaARevisar)

	// Taxa de aprovação e compliance
	if k.TotalPropostas > 0 {
		processadas := k.TotalAprovadas + k.TotalRejeitadas
		if processadas > 0 {
			k.TaxaAprovacaoPct = float64(k.TotalAprovadas) / float64(processadas) * 100
		}
		k.TaxaCompliancePct = float64(processadas) / float64(k.TotalPropostas) * 100
	}

	// Top 5 motivos de rejeição
	rows, err := db.Query(`
		SELECT COALESCE(mr.descricao, 'Sem motivo'), COUNT(*) AS qtd
		  FROM smartpick.sp_propostas p
	     LEFT JOIN smartpick.sp_tipo_rejeicao mr ON mr.id = p.motivo_rejeicao_id
		 WHERE p.cd_id = $1 AND p.status = 'rejeitada'
		   AND p.created_at >= $2 AND p.created_at < $3 + INTERVAL '1 day'
		 GROUP BY mr.descricao
		 ORDER BY qtd DESC
		 LIMIT 5
	`, cdID, inicio, fim)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var kv KVPair
			if rows.Scan(&kv.Label, &kv.Valor) == nil {
				k.TopMotivosRejeicao = append(k.TopMotivosRejeicao, kv)
			}
		}
	}

	// Top 5 departamentos com mais pendentes (departamento vem do sp_enderecos)
	rows2, err := db.Query(`
		SELECT COALESCE(e.departamento, '—'), COUNT(*) AS qtd
		  FROM smartpick.sp_propostas p
		  JOIN smartpick.sp_enderecos e ON e.id = p.endereco_id
		 WHERE p.cd_id = $1 AND p.status = 'pendente'
		   AND p.created_at >= $2 AND p.created_at < $3 + INTERVAL '1 day'
		 GROUP BY e.departamento
		 ORDER BY qtd DESC
		 LIMIT 5
	`, cdID, inicio, fim)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var kv KVPair
			if rows2.Scan(&kv.Label, &kv.Valor) == nil {
				k.TopDeptosPendentes = append(k.TopDeptosPendentes, kv)
			}
		}
	}

	// Top 10 produtos críticos (Curva A com maior delta absoluto)
	rows3, err := db.Query(`
		SELECT p.codprod, p.produto, COALESCE(e.departamento,'—'), COALESCE(p.classe_venda,'—'), p.delta
		  FROM smartpick.sp_propostas p
		  JOIN smartpick.sp_enderecos e ON e.id = p.endereco_id
		 WHERE p.cd_id = $1 AND p.status = 'pendente'
		   AND p.created_at >= $2 AND p.created_at < $3 + INTERVAL '1 day'
		   AND p.classe_venda = 'A'
		 ORDER BY ABS(p.delta) DESC
		 LIMIT 10
	`, cdID, inicio, fim)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var pc ProdutoCritico
			if rows3.Scan(&pc.CodProd, &pc.Produto, &pc.Departamento, &pc.ClasseVenda, &pc.Delta) == nil {
				k.TopProdutosCriticos = append(k.TopProdutosCriticos, pc)
			}
		}
	}

	// Alertas atuais usando o último csv_job do CD
	_ = db.QueryRow(`
		WITH job AS (
		  SELECT id FROM smartpick.sp_csv_jobs
		   WHERE cd_id = $1 AND status = 'done'
		   ORDER BY created_at DESC LIMIT 1
		)
		SELECT
		  COUNT(*) FILTER (WHERE COALESCE(e.med_venda_cx,0) >= COALESCE(e.capacidade,0) AND COALESCE(e.capacidade,0) > 0),
		  COUNT(*) FILTER (WHERE COALESCE(e.ponto_reposicao,0) > 0 AND COALESCE(e.med_venda_cx,0) >= e.ponto_reposicao),
		  COUNT(*) FILTER (WHERE COALESCE(e.capacidade,0) > 0 AND COALESCE(e.med_venda_cx,0) > 0 AND e.capacidade::numeric/e.med_venda_cx < 2)
		  FROM smartpick.sp_enderecos e
		 WHERE e.job_id = (SELECT id FROM job)
	`, cdID).Scan(&k.AlertasUrgencia, &k.AlertasAjustar, &k.AlertasCapMenor)

	return k, nil
}

// ── Geração de narrativa via Z.AI (mesmo endpoint do assistente) ─────────────

const promptResumoExecutivo = `Você é um analista sênior de logística e calibragem de picking, escrevendo um resumo executivo SEMANAL para o gestor de um centro de distribuição (CD) brasileiro.

Receberá um JSON com KPIs do CD na semana. Sua tarefa:
1. Escrever um resumo executivo em português (markdown) com estrutura:
   - Parágrafo de abertura com a situação geral (2-3 frases, números-chave)
   - Lista "## Pontos de atenção" (3 itens críticos no máximo, baseados nos dados)
   - Lista "## Tendências detectadas" (1-3 itens — só se houver sinal claro nos dados)
   - Bloco "## Sugestão de ação" (1 ação concreta para a próxima semana)
2. Tom: direto, executivo, sem jargão técnico
3. Use os números EXATOS do JSON. Se algum dado não estiver disponível, omita o ponto sem inventar
4. Máximo de ~250 palavras totais
5. Não repita o JSON — só análise narrativa

Não inclua saudações, despedidas ou nome do destinatário — apenas o conteúdo do resumo.`

// GerarNarrativaIA chama a Z.AI com os KPIs serializados em JSON e retorna o markdown
func GerarNarrativaIA(kpis *KPIsResumoExecutivo) (string, error) {
	apiKey := os.Getenv("ZAI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("ZAI_API_KEY não configurada")
	}

	dadosJSON, _ := json.MarshalIndent(kpis, "", "  ")

	type msg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	body, _ := json.Marshal(map[string]interface{}{
		"model":       "glm-4.5-air",
		"max_tokens":  1024,
		"temperature": 0.4,
		"messages": []msg{
			{Role: "system", Content: promptResumoExecutivo},
			{Role: "user", Content: "KPIs do CD nesta semana:\n\n" + string(dadosJSON)},
		},
	})

	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest("POST", "https://api.z.ai/api/coding/paas/v4/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("falha ao chamar Z.AI: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Z.AI retornou status %d: %s", resp.StatusCode, string(raw))
	}

	var r struct {
		Choices []struct {
			Message struct {
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", fmt.Errorf("parse falhou: %w", err)
	}
	if len(r.Choices) == 0 {
		return "", fmt.Errorf("Z.AI sem choices")
	}
	out := r.Choices[0].Message.Content
	if out == "" {
		out = r.Choices[0].Message.ReasoningContent
	}
	return strings.TrimSpace(out), nil
}

// ── Persistência ──────────────────────────────────────────────────────────────

// SalvarRelatorio insere o relatório gerado e retorna o id criado
func SalvarRelatorio(db *sql.DB, kpis *KPIsResumoExecutivo, narrativa string, criadoPor string) (int, error) {
	dadosJSON, _ := json.Marshal(kpis)
	var id int
	err := db.QueryRow(`
		INSERT INTO smartpick.sp_relatorios_semanais (cd_id, periodo_inicio, periodo_fim, dados_json, narrativa_md, criado_por)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, kpis.CdID, kpis.PeriodoInicio, kpis.PeriodoFim, dadosJSON, narrativa, criadoPor).Scan(&id)
	return id, err
}

// MarcarEnviado atualiza o relatório com os destinatários e timestamp de envio
func MarcarEnviado(db *sql.DB, relatorioID int, enviadoPara []string, erroEnvio string) error {
	_, err := db.Exec(`
		UPDATE smartpick.sp_relatorios_semanais
		   SET enviado_em = NOW(), enviado_para = $2, erro_envio = NULLIF($3, '')
		 WHERE id = $1
	`, relatorioID, "{"+strings.Join(enviadoPara, ",")+"}", erroEnvio)
	return err
}

// ── Orquestração: gerar + (opcionalmente) enviar ─────────────────────────────

// GerarResumoExecutivo coleta os KPIs da última semana, gera a narrativa via IA, salva e retorna o id
func GerarResumoExecutivo(db *sql.DB, cdID int, criadoPor string) (int, *KPIsResumoExecutivo, string, error) {
	fim := time.Now()
	inicio := fim.AddDate(0, 0, -7)

	kpis, err := ColetarKPIs(db, cdID, inicio, fim)
	if err != nil {
		return 0, nil, "", fmt.Errorf("coletar KPIs: %w", err)
	}

	narrativa, err := GerarNarrativaIA(kpis)
	if err != nil {
		return 0, nil, "", fmt.Errorf("gerar narrativa: %w", err)
	}

	id, err := SalvarRelatorio(db, kpis, narrativa, criadoPor)
	if err != nil {
		return 0, nil, "", fmt.Errorf("salvar relatório: %w", err)
	}

	return id, kpis, narrativa, nil
}
