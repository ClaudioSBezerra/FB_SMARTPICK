package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
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

	ImportsPeriodo []ImportInfo `json:"imports_periodo"`
	SemAtividade   bool         `json:"sem_atividade"` // true quando não houve aprovações/rejeições no período

	// Realocação física no período (movimentos persistidos ao gerar o PDF do lote)
	RealocMovimentos int `json:"realoc_movimentos"` // produtos que trocaram de endereço
	RealocLotes      int `json:"realoc_lotes"`      // lotes (PDFs) gerados
	RealocRuas       int `json:"realoc_ruas"`       // ruas organizadas
	RealocCurvaA     int `json:"realoc_curva_a"`    // movimentos de produtos Curva A

	// Itens realocados no período (antes → depois), ordenados por data e rua.
	// Limitado a 200 p/ não inflar o dados_json. NÃO é enviado à IA (só agregados).
	RealocItens []RealocItemResumo `json:"realoc_itens,omitempty"`

	// Evolução de acessos ao picking (Curva A) entre a última importação e a anterior.
	// É o indicador central de eficiência: mede se a calibragem/realocação está
	// reduzindo o esforço de picking (menos acessos p/ atender a mesma demanda).
	AcessoPicking *EvolucaoAcessoPicking `json:"acesso_picking,omitempty"`
}

// EvolucaoAcessoPicking compara qt_acesso_90 (acessos ao picking em 90 dias) dos
// produtos Curva A entre as duas importações de CSV mais recentes do CD.
type EvolucaoAcessoPicking struct {
	Disponivel       bool    `json:"disponivel"`               // false se houver menos de 2 importações concluídas
	JobAtualEm       string  `json:"job_atual_em,omitempty"`    // data/hora da importação mais recente
	JobAnteriorEm    string  `json:"job_anterior_em,omitempty"` // data/hora da importação anterior
	AcessosAtual     int     `json:"acessos_atual"`             // soma qt_acesso_90 Curva A na importação atual
	AcessosAnterior  int     `json:"acessos_anterior"`          // soma qt_acesso_90 Curva A na importação anterior
	ProdutosAtual    int     `json:"produtos_atual"`            // qtd produtos Curva A considerados (atual)
	ProdutosAnterior int     `json:"produtos_anterior"`         // qtd produtos Curva A considerados (anterior)
	MediaAtual       float64 `json:"media_atual"`               // acessos médios por produto Curva A (atual)
	MediaAnterior    float64 `json:"media_anterior"`            // acessos médios por produto Curva A (anterior)
	DeltaPct         float64 `json:"delta_pct"`                 // variação % da média (negativo = menos acessos = melhoria)
	Melhorou         bool    `json:"melhorou"`                  // true quando a média de acessos caiu em relação à importação anterior
}

// RealocItemResumo é um movimento individual listado no resumo/PDF.
type RealocItemResumo struct {
	Data       string `json:"data"` // DD/MM HH:MM
	Rua        int    `json:"rua"`
	Codprod    int    `json:"codprod"`
	Produto    string `json:"produto"`
	Curva      string `json:"curva"`
	Antes      string `json:"antes"`  // end_origem
	Depois     string `json:"depois"` // end_destino
	Observacao string `json:"observacao"`
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

// ImportInfo descreve um arquivo CSV importado no período do resumo
type ImportInfo struct {
	JobID        string `json:"job_id"`
	Filename     string `json:"filename"`
	Status       string `json:"status"`
	UploadedBy   string `json:"uploaded_by"`   // nome do usuário ou email
	UploadedEm   string `json:"uploaded_em"`   // YYYY-MM-DD HH:MM
	TotalLinhas  int    `json:"total_linhas"`
	LinhasOk     int    `json:"linhas_ok"`
	LinhasErro   int    `json:"linhas_erro"`
}

// ── Coleta de KPIs ────────────────────────────────────────────────────────────

// ColetarKPIs busca os indicadores agregados do CD no período informado
func ColetarKPIs(db *sql.DB, cdID int, inicio, fim time.Time) (*KPIsResumoExecutivo, error) {
	k := &KPIsResumoExecutivo{
		CdID:                cdID,
		PeriodoInicio:       inicio.Format("2006-01-02"),
		PeriodoFim:          fim.Format("2006-01-02"),
		TopMotivosRejeicao:  []KVPair{},
		TopDeptosPendentes:  []KVPair{},
		TopProdutosCriticos: []ProdutoCritico{},
		ImportsPeriodo:      []ImportInfo{},
	}
	// Limite superior do range (exclusivo) — fim do dia. Usado nas queries
	// como `created_at < $3` para incluir o dia inteiro do fim.
	fimExclusivo := fim.AddDate(0, 0, 1)

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
		   AND tipo_rel = 'CALIBRACAO'
		   AND created_at >= $2 AND created_at < $3
	`, cdID, inicio, fimExclusivo).Scan(&k.TotalPropostas, &k.TotalAprovadas, &k.TotalRejeitadas, &k.TotalPendentes); err != nil {
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
		   AND tipo_rel = 'CALIBRACAO'
		   AND created_at >= $2 AND created_at < $3
	`, cdID, inicio, fimExclusivo).Scan(&k.Ampliar, &k.Reduzir, &k.Calibrados)

	// Curva A com sugestão de redução mantida pendente (proxy de "Curva A Revisar")
	_ = db.QueryRow(`
		SELECT COUNT(*) FROM smartpick.sp_propostas
		 WHERE cd_id = $1
		   AND tipo_rel = 'CALIBRACAO'
		   AND classe_venda = 'A'
		   AND delta < 0
		   AND status = 'pendente'
		   AND created_at >= $2 AND created_at < $3
	`, cdID, inicio, fimExclusivo).Scan(&k.CurvaARevisar)

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
		 WHERE p.cd_id = $1 AND p.tipo_rel = 'CALIBRACAO' AND p.status = 'rejeitada'
		   AND p.created_at >= $2 AND p.created_at < $3
		 GROUP BY mr.descricao
		 ORDER BY qtd DESC
		 LIMIT 5
	`, cdID, inicio, fimExclusivo)
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
		 WHERE p.cd_id = $1 AND p.tipo_rel = 'CALIBRACAO' AND p.status = 'pendente'
		   AND p.created_at >= $2 AND p.created_at < $3
		 GROUP BY e.departamento
		 ORDER BY qtd DESC
		 LIMIT 5
	`, cdID, inicio, fimExclusivo)
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
		 WHERE p.cd_id = $1 AND p.tipo_rel = 'CALIBRACAO' AND p.status = 'pendente'
		   AND p.created_at >= $2 AND p.created_at < $3
		   AND p.classe_venda = 'A'
		 ORDER BY ABS(p.delta) DESC
		 LIMIT 10
	`, cdID, inicio, fimExclusivo)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var pc ProdutoCritico
			if rows3.Scan(&pc.CodProd, &pc.Produto, &pc.Departamento, &pc.ClasseVenda, &pc.Delta) == nil {
				k.TopProdutosCriticos = append(k.TopProdutosCriticos, pc)
			}
		}
	}

	// Imports CSV no período (úteis quando não houve atividade na semana)
	rows4, err := db.Query(`
		SELECT j.id::text,
		       j.filename,
		       j.status,
		       COALESCE(NULLIF(u.email,''), 'desconhecido'),
		       to_char(j.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
		       COALESCE(j.total_linhas, 0),
		       COALESCE(j.linhas_ok, 0),
		       COALESCE(j.linhas_erro, 0)
		  FROM smartpick.sp_csv_jobs j
	     LEFT JOIN public.users u ON u.id = j.uploaded_by
		 WHERE j.cd_id = $1
		   AND j.created_at >= $2 AND j.created_at < $3
		 ORDER BY j.created_at DESC
		 LIMIT 20
	`, cdID, inicio, fimExclusivo)
	if err == nil {
		defer rows4.Close()
		for rows4.Next() {
			var imp ImportInfo
			if rows4.Scan(&imp.JobID, &imp.Filename, &imp.Status, &imp.UploadedBy, &imp.UploadedEm,
				&imp.TotalLinhas, &imp.LinhasOk, &imp.LinhasErro) == nil {
				k.ImportsPeriodo = append(k.ImportsPeriodo, imp)
			}
		}
	}

	// Realocação física no período (persistida ao gerar o PDF do lote)
	_ = db.QueryRow(`
		SELECT COALESCE(SUM(i.cnt), 0),
		       COUNT(DISTINCT l.id),
		       COUNT(DISTINCT l.rua),
		       COALESCE(SUM(i.curva_a), 0)
		  FROM smartpick.sp_realocacao_lote l
		  JOIN LATERAL (
			SELECT COUNT(*) AS cnt,
			       COUNT(*) FILTER (WHERE classe_venda = 'A') AS curva_a
			  FROM smartpick.sp_realocacao_item it WHERE it.lote_id = l.id
		  ) i ON TRUE
		 WHERE l.cd_id = $1
		   AND l.criado_em >= $2 AND l.criado_em < $3
	`, cdID, inicio, fimExclusivo).Scan(&k.RealocMovimentos, &k.RealocLotes, &k.RealocRuas, &k.RealocCurvaA)

	// Itens realocados (antes → depois), ordenados por data e rua — máx. 200
	rowsR, err := db.Query(`
		SELECT to_char(l.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'),
		       COALESCE(l.rua, 0),
		       i.codprod,
		       COALESCE(i.produto, ''),
		       COALESCE(i.classe_venda, ''),
		       COALESCE(i.end_origem, ''),
		       COALESCE(i.end_destino, ''),
		       COALESCE(i.observacao, '')
		  FROM smartpick.sp_realocacao_item i
		  JOIN smartpick.sp_realocacao_lote l ON l.id = i.lote_id
		 WHERE l.cd_id = $1
		   AND l.criado_em >= $2 AND l.criado_em < $3
		 ORDER BY l.criado_em, l.rua, i.end_destino
		 LIMIT 200
	`, cdID, inicio, fimExclusivo)
	if err == nil {
		defer rowsR.Close()
		for rowsR.Next() {
			var it RealocItemResumo
			if rowsR.Scan(&it.Data, &it.Rua, &it.Codprod, &it.Produto, &it.Curva,
				&it.Antes, &it.Depois, &it.Observacao) == nil {
				k.RealocItens = append(k.RealocItens, it)
			}
		}
	}

	// Marca como "sem atividade" quando não houve aprovações nem rejeições
	// NEM realocações físicas no período
	k.SemAtividade = (k.TotalAprovadas+k.TotalRejeitadas) == 0 && k.RealocMovimentos == 0

	// Evolução de acessos ao picking (Curva A): última importação vs. anterior
	k.AcessoPicking = calcularEvolucaoAcesso(db, cdID)

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

// calcularEvolucaoAcesso compara qt_acesso_90 (Curva A) entre as duas
// importações de CSV concluídas mais recentes do CD, independente do período
// do resumo — é uma leitura estrutural do efeito acumulado da calibragem.
func calcularEvolucaoAcesso(db *sql.DB, cdID int) *EvolucaoAcessoPicking {
	rows, err := db.Query(`
		SELECT id::text, to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
		  FROM smartpick.sp_csv_jobs
		 WHERE cd_id = $1 AND status = 'done'
		 ORDER BY created_at DESC
		 LIMIT 2
	`, cdID)
	if err != nil {
		log.Printf("[resumo] erro listando imports p/ evolução de acesso: %v", err)
		return &EvolucaoAcessoPicking{Disponivel: false}
	}
	defer rows.Close()

	type jobRef struct{ ID, Em string }
	var jobs []jobRef
	for rows.Next() {
		var j jobRef
		if rows.Scan(&j.ID, &j.Em) == nil {
			jobs = append(jobs, j)
		}
	}
	if len(jobs) < 2 {
		return &EvolucaoAcessoPicking{Disponivel: false}
	}

	acessosPorJob := func(jobID string) (soma int, qtd int) {
		_ = db.QueryRow(`
			SELECT COALESCE(SUM(qt_acesso_90), 0), COUNT(*)
			  FROM smartpick.sp_enderecos
			 WHERE job_id = $1::uuid AND classe_venda = 'A' AND qt_acesso_90 IS NOT NULL
		`, jobID).Scan(&soma, &qtd)
		return
	}

	acessoAtual, prodAtual := acessosPorJob(jobs[0].ID)
	acessoAnterior, prodAnterior := acessosPorJob(jobs[1].ID)

	ev := &EvolucaoAcessoPicking{
		Disponivel:       true,
		JobAtualEm:       jobs[0].Em,
		JobAnteriorEm:    jobs[1].Em,
		AcessosAtual:     acessoAtual,
		AcessosAnterior:  acessoAnterior,
		ProdutosAtual:    prodAtual,
		ProdutosAnterior: prodAnterior,
	}
	if prodAtual > 0 {
		ev.MediaAtual = float64(acessoAtual) / float64(prodAtual)
	}
	if prodAnterior > 0 {
		ev.MediaAnterior = float64(acessoAnterior) / float64(prodAnterior)
	}
	if ev.MediaAnterior > 0 {
		ev.DeltaPct = (ev.MediaAtual - ev.MediaAnterior) / ev.MediaAnterior * 100
		ev.Melhorou = ev.DeltaPct < 0
	}
	return ev
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

REALOCAÇÃO FÍSICA (campos realoc_*):
   realoc_movimentos = produtos que trocaram de endereço na rua no período;
   realoc_lotes = lotes de realocação gerados; realoc_ruas = ruas organizadas;
   realoc_curva_a = movimentos de produtos Curva A (alto giro — os mais importantes).
   - Se realoc_movimentos > 0: inclua uma seção "## Realocações da semana" com
     1-2 frases (quantos movimentos, em quantas ruas, destaque para Curva A).
   - Se realoc_curva_a for alta proporção dos movimentos, elogie a priorização
     (Curva A nos melhores endereços = menos deslocamento no picking).
   - Se realoc_movimentos = 0 mas houve calibragem aprovada, sugira na ação
     organizar as ruas com o Painel de Realocação.

EVOLUÇÃO DE ACESSOS AO PICKING (campo acesso_picking):
   Compara a média de acessos ao picking (qt_acesso_90) dos produtos Curva A
   entre a importação de CSV mais recente e a anterior. Menos acessos em média
   = slotting mais eficiente (menos viagens para atender a mesma demanda) =
   efeito direto da calibragem/realocação, a principal atividade do sistema.
   - Se acesso_picking.disponivel = true: SEMPRE inclua uma frase sobre isso,
     de preferência no parágrafo de abertura ou em "## Tendências detectadas".
     Use media_atual, media_anterior e delta_pct exatos.
   - Se melhorou=true: destaque como resultado positivo da calibragem.
   - Se melhorou=false e delta_pct > 5: alerte como ponto de atenção — pode
     indicar slots subdimensionados ou realocações que não tiveram efeito ainda.
   - Se disponivel = false (menos de 2 importações concluídas), não mencione.

CASO ESPECIAL — sem_atividade=true:
   Se o campo "sem_atividade" estiver true, significa que NÃO houve aprovações, rejeições nem realocações no período. Nesse caso:
   - Abra reconhecendo a baixa atividade ("A semana não registrou movimentações de calibragem...")
   - Se houver imports_periodo: liste cada arquivo importado (filename, uploaded_by, uploaded_em, total_linhas, status) em "## Importações do período"
   - Em "## Sugestão de ação": cobre o gestor para revisar as propostas pendentes ou importar dados se nada chegou
   - Não invente alertas que não estão nos dados

Não inclua saudações, despedidas ou nome do destinatário — apenas o conteúdo do resumo.`

// GerarNarrativaIA chama a Z.AI (cliente compartilhado em zai.go: thinking
// desligado, retry e fallback) com os KPIs em JSON e retorna o markdown.
// A lista realoc_itens é omitida do prompt: a IA só precisa dos agregados,
// e 200 itens inflariam tokens/custo sem melhorar a narrativa.
func GerarNarrativaIA(kpis *KPIsResumoExecutivo) (string, error) {
	semItens := *kpis
	semItens.RealocItens = nil
	dadosJSON, _ := json.MarshalIndent(&semItens, "", "  ")
	return ZAIChat([]ZAIMessage{
		{Role: "system", Content: promptResumoExecutivo},
		{Role: "user", Content: "KPIs do CD nesta semana:\n\n" + string(dadosJSON)},
	}, 1024, 0.4)
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
	// Postgres TEXT[] literal: '{a@b.com,c@d.com}'
	_, err := db.Exec(`
		UPDATE smartpick.sp_relatorios_semanais
		   SET enviado_em = NOW(), enviado_para = $2, erro_envio = NULLIF($3, '')
		 WHERE id = $1
	`, relatorioID, "{"+strings.Join(enviadoPara, ",")+"}", erroEnvio)
	return err
}

// EnviarResumoPorEmail busca destinatários ativos do CD e envia o relatório
// retornando lista de emails enviados e mensagem de erro (se houver).
// Reaproveita GetEmailConfig + sendMailSSL do email.go.
func EnviarResumoPorEmail(db *sql.DB, relatorioID int) ([]string, error) {
	log.Printf("[resumo] enviando relatório %d por email", relatorioID)
	// Carrega o relatório
	var (
		cdID                   int
		periodoIni, periodoFim string
		dadosJSON, narrativa   string
	)
	err := db.QueryRow(`
		SELECT cd_id,
		       to_char(periodo_inicio, 'DD/MM/YYYY'),
		       to_char(periodo_fim, 'DD/MM/YYYY'),
		       dados_json::text, narrativa_md
		  FROM smartpick.sp_relatorios_semanais
		 WHERE id = $1
	`, relatorioID).Scan(&cdID, &periodoIni, &periodoFim, &dadosJSON, &narrativa)
	if err != nil {
		return nil, fmt.Errorf("relatório não encontrado: %w", err)
	}

	// Nome do CD e da filial (para mensagens de erro claras)
	var cdNome, filialNome string
	_ = db.QueryRow(`
		SELECT c.nome, COALESCE(f.nome, '')
		  FROM smartpick.sp_centros_dist c
	     LEFT JOIN smartpick.sp_filiais f ON f.id = c.filial_id
		 WHERE c.id = $1
	`, cdID).Scan(&cdNome, &filialNome)
	if cdNome == "" {
		cdNome = fmt.Sprintf("CD %d", cdID)
	}

	var kpis KPIsResumoExecutivo
	if err := json.Unmarshal([]byte(dadosJSON), &kpis); err != nil {
		return nil, fmt.Errorf("parse dados_json: %w", err)
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
		// Diagnóstico: contadores e onde o usuário pode estar cadastrado
		var total, inativos int
		_ = db.QueryRow(`SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT ativo) FROM smartpick.sp_destinatarios_resumo WHERE cd_id = $1`, cdID).Scan(&total, &inativos)

		// Lista CDs (com nome) onde HÁ destinatários ativos para orientar o usuário
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

		log.Printf("[resumo] CD=%d (%s) sem destinatários ativos. total=%d inativos=%d. CDs com destinatários: %v",
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
	log.Printf("[resumo] CD=%d (%s) %d destinatários ativos: enviando", cdID, cdNome, len(destinos))

	cfg := GetEmailConfig()
	if cfg.Password == "" {
		return nil, fmt.Errorf("SMTP não configurado")
	}

	subject := fmt.Sprintf("SmartPick - Resumo Executivo %s (%s)", kpis.CdNome, periodoFim)
	html := buildResumoHTML(&kpis, narrativa, periodoIni, periodoFim)
	plain := buildResumoPlainText(&kpis, narrativa, periodoIni, periodoFim)

	enviados := []string{}
	for _, d := range destinos {
		boundary := fmt.Sprintf("rs_%d", time.Now().UnixNano())
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
			log.Printf("[resumo] ✗ erro envio para %s: %v", d.Email, sendErr)
			continue
		}
		log.Printf("[resumo] ✓ enviado para %s", d.Email)
		enviados = append(enviados, d.Email)
	}
	log.Printf("[resumo] envio concluído: %d/%d destinatários receberam o relatório %d",
		len(enviados), len(destinos), relatorioID)

	if len(enviados) == 0 {
		return nil, fmt.Errorf("falha ao enviar para todos os %d destinatários", len(destinos))
	}
	return enviados, nil
}

// ── Renderização do email ─────────────────────────────────────────────────────

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func buildResumoHTML(k *KPIsResumoExecutivo, narrativa, periodoIni, periodoFim string) string {
	narrativaHTML := convertMarkdownToHTML(narrativa)

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:680px;margin:0 auto;background:#f4f4f8}
.wrap{padding:20px}
.hdr{background:#2d3748;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;text-align:center}
.hdr-logo{font-size:20px;font-weight:700}
.hdr-sub{font-size:13px;color:#cbd5e0;margin-top:4px}
.body{background:#fff;padding:22px;border-radius:0 0 8px 8px}
.info-box{background:#ebf8ff;border-left:4px solid #3182ce;padding:10px 14px;margin:0 0 18px;border-radius:0 6px 6px 0;font-size:12px;color:#2c5282}
.sec{margin:18px 0}
.sec-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#718096;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-bottom:12px}
.kpi-table{width:100%;border-collapse:separate;border-spacing:6px}
.kpi-cell{border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center;background:#f7fafc}
.kpi-label{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#718096}
.kpi-val{font-size:18px;font-weight:700;color:#2d3748;margin:2px 0}
.ai-box{background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin:18px 0}
.ai-label{font-size:11px;font-weight:700;text-transform:uppercase;color:#a0aec0;margin-bottom:10px}
table.dt{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}
table.dt th{background:#4a5568;color:#fff;padding:6px 10px;text-align:left;font-size:11px}
table.dt td{padding:6px 10px;border-bottom:1px solid #e2e8f0}
.footer{text-align:center;padding:14px;color:#a0aec0;font-size:11px}
</style></head><body><div class="wrap">`)

	fmt.Fprintf(&sb, `<div class="hdr"><div class="hdr-logo">SmartPick</div><div class="hdr-sub">Resumo Executivo Semanal &mdash; %s</div></div>`, k.CdNome)

	sb.WriteString(`<div class="body">`)
	fmt.Fprintf(&sb, `<div class="info-box"><strong>CD:</strong> %s &nbsp;|&nbsp; <strong>Filial:</strong> %s &nbsp;|&nbsp; <strong>Per&iacute;odo:</strong> %s a %s</div>`,
		k.CdNome, k.FilialNome, periodoIni, periodoFim)

	// KPIs principais
	sb.WriteString(`<div class="sec"><div class="sec-title">Resumo da Semana</div><table class="kpi-table"><tr>`)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Propostas Geradas</div><div class="kpi-val">%d</div></td>`, k.TotalPropostas)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Aprovadas</div><div class="kpi-val" style="color:#16a34a">%d</div></td>`, k.TotalAprovadas)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Rejeitadas</div><div class="kpi-val" style="color:#dc2626">%d</div></td>`, k.TotalRejeitadas)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Pendentes</div><div class="kpi-val" style="color:#ca8a04">%d</div></td>`, k.TotalPendentes)
	sb.WriteString(`</tr><tr>`)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Ampliar Slot</div><div class="kpi-val" style="color:#dc2626">%d</div></td>`, k.Ampliar)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Reduzir Slot</div><div class="kpi-val" style="color:#ca8a04">%d</div></td>`, k.Reduzir)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Calibrados</div><div class="kpi-val" style="color:#2563eb">%d</div></td>`, k.Calibrados)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Curva A Revisar</div><div class="kpi-val" style="color:#d97706">%d</div></td>`, k.CurvaARevisar)
	sb.WriteString(`</tr><tr>`)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Taxa Aprovação</div><div class="kpi-val">%.0f%%</div></td>`, k.TaxaAprovacaoPct)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Compliance</div><div class="kpi-val">%.0f%%</div></td>`, k.TaxaCompliancePct)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Ignorados</div><div class="kpi-val">%d</div></td>`, k.TotalIgnorados)
	fmt.Fprintf(&sb, `<td class="kpi-cell"><div class="kpi-label">Alertas Críticos</div><div class="kpi-val" style="color:#dc2626">%d</div></td>`,
		k.AlertasUrgencia+k.AlertasAjustar+k.AlertasCapMenor)
	sb.WriteString(`</tr></table></div>`)

	// Evolução de acessos ao picking (Curva A) — indicador central de eficiência
	if k.AcessoPicking != nil && k.AcessoPicking.Disponivel {
		ap := k.AcessoPicking
		cor, seta, rotulo := "#718096", "→", "Estável"
		if ap.Melhorou {
			cor, seta, rotulo = "#16a34a", "▼", "Melhorou"
		} else if ap.DeltaPct > 0 {
			cor, seta, rotulo = "#dc2626", "▲", "Piorou"
		}
		sb.WriteString(`<div class="sec"><div class="sec-title">Evolu&ccedil;&atilde;o de Acessos ao Picking (Curva A)</div>`)
		fmt.Fprintf(&sb, `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
			<div><div style="font-size:11px;color:#718096">M&eacute;dia de acessos/produto</div>
			<div style="font-size:13px"><strong>%.1f</strong> (anterior) &rarr; <strong>%.1f</strong> (atual)</div>
			<div style="font-size:10px;color:#a0aec0">importa&ccedil;&otilde;es de %s e %s</div></div>
			<div style="text-align:center"><div style="font-size:20px;font-weight:700;color:%s">%s %.1f%%</div>
			<div style="font-size:11px;font-weight:600;color:%s">%s</div></div>
		</div></div>`,
			ap.MediaAnterior, ap.MediaAtual, ap.JobAnteriorEm, ap.JobAtualEm, cor, seta, absFloat(ap.DeltaPct), cor, rotulo)
	}

	// Narrativa IA
	sb.WriteString(`<div class="ai-box"><div class="ai-label">&#129302; An&aacute;lise da Intelig&ecirc;ncia Artificial</div>`)
	sb.WriteString(narrativaHTML)
	sb.WriteString(`</div>`)

	// Top motivos rejeição
	if len(k.TopMotivosRejeicao) > 0 {
		sb.WriteString(`<div class="sec"><div class="sec-title">Top motivos de rejei&ccedil;&atilde;o</div><table class="dt"><thead><tr><th>Motivo</th><th style="text-align:right">Qtd</th></tr></thead><tbody>`)
		for _, m := range k.TopMotivosRejeicao {
			fmt.Fprintf(&sb, `<tr><td>%s</td><td style="text-align:right">%d</td></tr>`, m.Label, m.Valor)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	// Top produtos críticos
	if len(k.TopProdutosCriticos) > 0 {
		sb.WriteString(`<div class="sec"><div class="sec-title">Top produtos cr&iacute;ticos (Curva A)</div><table class="dt"><thead><tr><th>C&oacute;d.</th><th>Produto</th><th>Depto</th><th style="text-align:right">&Delta;</th></tr></thead><tbody>`)
		for _, p := range k.TopProdutosCriticos {
			color := "#16a34a"
			signal := ""
			if p.Delta > 0 {
				color = "#dc2626"
				signal = "+"
			} else if p.Delta < 0 {
				color = "#ca8a04"
			}
			fmt.Fprintf(&sb, `<tr><td>%d</td><td>%s</td><td>%s</td><td style="text-align:right;color:%s;font-weight:600">%s%d CX</td></tr>`,
				p.CodProd, p.Produto, p.Departamento, color, signal, p.Delta)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	// Importações do período (úteis principalmente quando sem_atividade=true)
	if len(k.ImportsPeriodo) > 0 {
		sb.WriteString(`<div class="sec"><div class="sec-title">Importa&ccedil;&otilde;es do per&iacute;odo</div><table class="dt"><thead><tr><th>Data</th><th>Arquivo</th><th>Importado por</th><th style="text-align:right">Linhas</th><th>Status</th></tr></thead><tbody>`)
		for _, imp := range k.ImportsPeriodo {
			statusColor := "#16a34a"
			switch imp.Status {
			case "failed":
				statusColor = "#dc2626"
			case "pending", "processing":
				statusColor = "#ca8a04"
			}
			fmt.Fprintf(&sb, `<tr><td>%s</td><td>%s</td><td>%s</td><td style="text-align:right">%d</td><td style="color:%s;font-weight:600">%s</td></tr>`,
				imp.UploadedEm, imp.Filename, imp.UploadedBy, imp.TotalLinhas, statusColor, imp.Status)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "https://smartpick.fbtax.cloud"
	}
	fmt.Fprintf(&sb, `<div style="text-align:center;margin:22px 0"><a href="%s/resumos" style="display:inline-block;padding:10px 24px;background:#2d3748;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px">Acessar Painel Completo</a></div>`, appURL)

	sb.WriteString(`</div><div class="footer">&copy; SmartPick &mdash; Calibragem Inteligente de Picking</div></div></body></html>`)
	return sb.String()
}

func buildResumoPlainText(k *KPIsResumoExecutivo, narrativa, periodoIni, periodoFim string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "SmartPick - Resumo Executivo Semanal\n\nCD: %s\nFilial: %s\nPeriodo: %s a %s\n\n", k.CdNome, k.FilialNome, periodoIni, periodoFim)
	sb.WriteString("=== RESUMO DA SEMANA ===\n")
	fmt.Fprintf(&sb, "Propostas geradas: %d\n", k.TotalPropostas)
	fmt.Fprintf(&sb, "  - Aprovadas:  %d\n", k.TotalAprovadas)
	fmt.Fprintf(&sb, "  - Rejeitadas: %d\n", k.TotalRejeitadas)
	fmt.Fprintf(&sb, "  - Pendentes:  %d\n", k.TotalPendentes)
	fmt.Fprintf(&sb, "Ampliar slot: %d | Reduzir slot: %d | Calibrados: %d | Curva A revisar: %d\n", k.Ampliar, k.Reduzir, k.Calibrados, k.CurvaARevisar)
	fmt.Fprintf(&sb, "Taxa de aprovacao: %.0f%% | Compliance: %.0f%% | Ignorados: %d\n\n", k.TaxaAprovacaoPct, k.TaxaCompliancePct, k.TotalIgnorados)

	if k.AcessoPicking != nil && k.AcessoPicking.Disponivel {
		ap := k.AcessoPicking
		rotulo := "Estavel"
		if ap.Melhorou {
			rotulo = "Melhorou"
		} else if ap.DeltaPct > 0 {
			rotulo = "Piorou"
		}
		sb.WriteString("=== EVOLUCAO DE ACESSOS AO PICKING (CURVA A) ===\n")
		fmt.Fprintf(&sb, "Media de acessos/produto: %.1f (anterior, %s) -> %.1f (atual, %s) | Variacao: %.1f%% | %s\n\n",
			ap.MediaAnterior, ap.JobAnteriorEm, ap.MediaAtual, ap.JobAtualEm, ap.DeltaPct, rotulo)
	}

	if k.RealocMovimentos > 0 {
		sb.WriteString("=== REALOCACOES DA SEMANA ===\n")
		fmt.Fprintf(&sb, "Movimentos: %d | Lotes: %d | Ruas: %d | Curva A: %d\n",
			k.RealocMovimentos, k.RealocLotes, k.RealocRuas, k.RealocCurvaA)
		max := len(k.RealocItens)
		if max > 30 {
			max = 30
		}
		for _, it := range k.RealocItens[:max] {
			fmt.Fprintf(&sb, "%s | Rua %d | %d %s (%s) | %s -> %s", it.Data, it.Rua, it.Codprod, it.Produto, it.Curva, it.Antes, it.Depois)
			if it.Observacao != "" {
				fmt.Fprintf(&sb, " | Obs: %s", it.Observacao)
			}
			sb.WriteString("\n")
		}
		if len(k.RealocItens) > max {
			fmt.Fprintf(&sb, "(+%d movimentos — lista completa no PDF)\n", len(k.RealocItens)-max)
		}
		sb.WriteString("\n")
	}

	if len(k.ImportsPeriodo) > 0 {
		sb.WriteString("=== IMPORTACOES DO PERIODO ===\n")
		for _, imp := range k.ImportsPeriodo {
			fmt.Fprintf(&sb, "%s | %s | por %s | %d linhas | %s\n",
				imp.UploadedEm, imp.Filename, imp.UploadedBy, imp.TotalLinhas, imp.Status)
		}
		sb.WriteString("\n")
	}

	sb.WriteString("=== ANALISE DA IA ===\n")
	sb.WriteString(narrativa)
	sb.WriteString("\n\n---\n(c) SmartPick\n")
	return sb.String()
}

// ── Orquestração: gerar + (opcionalmente) enviar ─────────────────────────────

// calcularInicioPeriodo determina o início do período do resumo:
//   - se já existe um resumo anterior para o CD, começa no dia seguinte ao fim
//     do último (sem lacunas nem sobreposição entre resumos consecutivos);
//   - se é o PRIMEIRO resumo do CD, cobre TODO o histórico já carregado (desde
//     a primeira importação de CSV) — assim o primeiro resumo não ignora dados
//     que foram carregados antes de o gestor gerar o relatório;
//   - sem nenhum resumo nem import, cai no padrão de 7 dias.
func calcularInicioPeriodo(db *sql.DB, cdID int, fim time.Time) time.Time {
	var ultimoFim sql.NullTime
	_ = db.QueryRow(`
		SELECT MAX(periodo_fim) FROM smartpick.sp_relatorios_semanais WHERE cd_id = $1
	`, cdID).Scan(&ultimoFim)
	if ultimoFim.Valid {
		inicio := ultimoFim.Time.AddDate(0, 0, 1)
		if inicio.Before(fim) {
			return inicio
		}
		return fim
	}

	var primeiroImport sql.NullTime
	_ = db.QueryRow(`
		SELECT MIN(created_at) FROM smartpick.sp_csv_jobs WHERE cd_id = $1
	`, cdID).Scan(&primeiroImport)
	if primeiroImport.Valid {
		return primeiroImport.Time
	}

	return fim.AddDate(0, 0, -7)
}

// narrativaIndisponivel gera o texto exibido no lugar da análise da IA quando
// a Z.AI falha (limite de uso, sobrecarga, etc) — os KPIs reais do período
// são salvos normalmente; só a análise textual some, com aviso claro do motivo.
func narrativaIndisponivel(err error) string {
	return fmt.Sprintf("## Análise da IA indisponível\n\nNão foi possível gerar a análise deste período (%s). "+
		"Os indicadores abaixo refletem os dados reais do CD — a análise textual pode ser gerada novamente mais tarde.",
		err.Error())
}

// GerarResumoExecutivo coleta os KPIs do período (todo o histórico carregado
// no primeiro resumo do CD; a partir daí, desde o fim do resumo anterior),
// gera a narrativa via IA, salva e retorna o id
func GerarResumoExecutivo(db *sql.DB, cdID int, criadoPor string) (int, *KPIsResumoExecutivo, string, error) {
	fim := time.Now()
	inicio := calcularInicioPeriodo(db, cdID, fim)
	log.Printf("[resumo] CD=%d gerando resumo período %s → %s", cdID, inicio.Format("2006-01-02"), fim.Format("2006-01-02"))

	kpis, err := ColetarKPIs(db, cdID, inicio, fim)
	if err != nil {
		log.Printf("[resumo] CD=%d coletar KPIs FALHOU: %v", cdID, err)
		return 0, nil, "", fmt.Errorf("coletar KPIs: %w", err)
	}
	log.Printf("[resumo] CD=%d KPIs coletados: total=%d aprovadas=%d rejeitadas=%d imports=%d realoc_mov=%d realoc_lotes=%d sem_atividade=%v",
		cdID, kpis.TotalPropostas, kpis.TotalAprovadas, kpis.TotalRejeitadas, len(kpis.ImportsPeriodo), kpis.RealocMovimentos, kpis.RealocLotes, kpis.SemAtividade)

	narrativa, err := GerarNarrativaIA(kpis)
	if err != nil {
		// A IA fora do ar (limite de uso, sobrecarga, etc) não pode descartar os
		// KPIs já coletados — o gestor precisa ver os números reais do período
		// mesmo sem a análise textual. Salva com um aviso no lugar da narrativa.
		log.Printf("[resumo] CD=%d gerar narrativa FALHOU (salvando com aviso no lugar da análise): %v", cdID, err)
		narrativa = narrativaIndisponivel(err)
	} else {
		log.Printf("[resumo] CD=%d narrativa gerada (%d chars)", cdID, len(narrativa))
	}

	id, err := SalvarRelatorio(db, kpis, narrativa, criadoPor)
	if err != nil {
		log.Printf("[resumo] CD=%d salvar relatório FALHOU: %v", cdID, err)
		return 0, nil, "", fmt.Errorf("salvar relatório: %w", err)
	}
	log.Printf("[resumo] CD=%d relatório %d salvo com sucesso", cdID, id)

	return id, kpis, narrativa, nil
}
