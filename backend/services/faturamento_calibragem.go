package services

// faturamento_calibragem.go — Coleta e persistência do Monitor de Faturamento
// sem Calibragem (Farol).
//
// Extraído de handlers/sp_faturamento_sem_calibragem.go (spec-faturamento-pdf-email.md)
// para ser reaproveitado tanto pelo GET ao vivo do painel quanto pela geração
// de snapshot (manual ou pelo worker diário). A cópia da lógica de comparação
// é literal — nenhuma condição de erro/fail-loud foi alterada em relação ao
// que já estava revisado e corrigido em spec-farol-faturamento-sem-calibragem.md.
//
// Tratamento de erro (preservado EXATAMENTE):
//   - CD inexistente/fora da empresa                                 → ErrCDNaoEncontrado
//   - falha de banco genuína resolvendo o CD                         → erro comum (500 no handler)
//   - falha na query de classificação Curva ABC (sp_enderecos)       → erro comum, nunca mapa vazio
//   - falha na query de propostas aprovadas (sp_propostas)           → erro comum, nunca "nenhum aprovado"
//   - Farol indisponível (timeout/erro HTTP/404 lá)                  → ErrFarolIndisponivel
//   - falha carregando última proposta / acesso 1ª importação        → logada, não aborta (campos informativos)

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ErrFarolIndisponivel sinaliza falha ao consultar o Farol (rede, HTTP não-200,
// corpo ilegível, JSON inválido) — distinto de erros de banco, para o handler
// mapear para 502 em vez de 500.
var ErrFarolIndisponivel = errors.New("integração com Farol indisponível")

// ─── DTOs ───────────────────────────────────────────────────────────────────

// FaturamentoPendenciaItem é um produto Curva A/B faturado no Farol sem
// calibragem aprovada correspondente no período selecionado (padrão: últimos 30 dias).
type FaturamentoPendenciaItem struct {
	CodProd     int     `json:"codprod"`
	Produto     string  `json:"produto,omitempty"`
	ClasseVenda string  `json:"classe_venda"`
	QtdFaturada float64 `json:"qtd_faturada"`

	// Última proposta de calibragem já gerada para este produto no CD
	// (qualquer status, não só aprovada) — puramente informativo, não afeta
	// se o produto entra ou não na lista de pendências.
	UltimoStatus      string `json:"ultimo_status"`                // "nunca" | "pendente" | "rejeitada" | "aprovada"
	Gap               *int   `json:"gap,omitempty"`                // delta (sugestao_calibragem - capacidade_atual) da última proposta
	UltimaAtualizacao string `json:"ultima_atualizacao,omitempty"` // YYYY-MM-DD da última proposta

	// Custo operacional: nº de vezes que o separador acessou o endereço de
	// picking nos últimos 90 dias (qt_acesso_90, direto do WMS). Também
	// informativo — evidencia o impacto de não ter calibrado ainda.
	AcessosPicking *int `json:"acessos_picking,omitempty"` // acessos na importação atual
	AcessosInicial *int `json:"acessos_inicial,omitempty"` // acessos na 1ª importação do CD (evolução até hoje)

	// Sazonalidade da Seção do produto (Farol, /api/farol/sazonalidade-secao,
	// índice sobre 2025) — adicionado 31/08/2026. Puramente informativo: ajuda
	// a distinguir "pico sazonal real" (ex: Bacalhau na Páscoa) de "falta de
	// calibragem genuína" antes de priorizar o produto. Ausente (nil) quando o
	// produto não tem cod_sec no Farol, ou quando a consulta de sazonalidade
	// falhou — nunca afeta se o produto entra ou não na lista de pendências.
	SazonalidadeSecao      string   `json:"sazonalidade_secao,omitempty"`
	SazonalidadeIndicePico *float64 `json:"sazonalidade_indice_pico,omitempty"`
	SazonalidadeMesPico    *int     `json:"sazonalidade_mes_pico,omitempty"`
}

// FaturamentoSemCalibragemResponse é a resposta completa do painel.
type FaturamentoSemCalibragemResponse struct {
	CdID       int    `json:"cd_id"`
	CdNome     string `json:"cd_nome"`
	FilialNome string `json:"filial_nome"`

	PeriodoInicio string `json:"periodo_inicio"` // YYYY-MM-DD
	PeriodoFim    string `json:"periodo_fim"`    // YYYY-MM-DD

	Pendencias []FaturamentoPendenciaItem `json:"pendencias"`

	// Diagnóstico: produtos do Farol que não bateram com nenhum codprod
	// Curva A/B do SmartPick (código desconhecido ou fora de A/B). Também logado.
	TotalNaoCorrespondencias int `json:"total_nao_correspondencias"`
}

// ─── Coleta (reaproveitada pelo GET ao vivo e pela geração de snapshot) ──────

// ResolverPeriodoFaturamento aplica o padrão de "últimos 30 dias até hoje"
// quando periodoIni/periodoFim não são informados (zero value) — mesmo
// comportamento fixo de antes do período ficar configurável. Usada pelos
// handlers HTTP pra resolver os query params opcionais antes de chamar
// ColetarFaturamentoSemCalibragem/GerarRelatorioFaturamento.
func ResolverPeriodoFaturamento(periodoIni, periodoFim time.Time) (time.Time, time.Time) {
	if periodoFim.IsZero() {
		periodoFim = time.Now()
	}
	if periodoIni.IsZero() {
		periodoIni = periodoFim.AddDate(0, 0, -30)
	}
	return periodoIni, periodoFim
}

// ColetarFaturamentoSemCalibragem cruza produtos Curva A/B faturados no Farol
// no período [periodoIni, periodoFim] com sp_propostas aprovadas do SmartPick
// no mesmo período, retornando os produtos faturados sem calibragem aprovada
// correspondente. periodoIni/periodoFim zero (time.Time{}) usam o padrão de
// últimos 30 dias (ver ResolverPeriodoFaturamento). empresaID escopa a
// resolução do CD (mesma regra do painel ao vivo).
func ColetarFaturamentoSemCalibragem(db *sql.DB, cdID int, empresaID string, periodoIni, periodoFim time.Time) (*FaturamentoSemCalibragemResponse, error) {
	periodoIni, periodoFim = ResolverPeriodoFaturamento(periodoIni, periodoFim)
	resp, _, _, err := coletarFaturamentoInterno(db, cdID, empresaID, periodoIni, periodoFim)
	return resp, err
}

// coletarFaturamentoInterno é o corpo real da coleta, retornando também os
// limites exatos (time.Time) do período usado — necessários para persistir o
// snapshot com timestamp preciso (GerarRelatorioFaturamento), sem depender de
// reparsear as datas já truncadas (YYYY-MM-DD) da resposta JSON. periodoIni/
// periodoFim já vêm resolvidos (nunca zero) — quem chama decide o padrão.
func coletarFaturamentoInterno(db *sql.DB, cdID int, empresaID string, periodoIni, periodoFim time.Time) (*FaturamentoSemCalibragemResponse, time.Time, time.Time, error) {
	// ── Resolve CD: ErrCDNaoEncontrado (genuinamente inexistente/fora da
	//    empresa) vs erro comum (falha real de banco) — quem chama decide o
	//    mapeamento HTTP (404 vs 500), igual ao painel ao vivo. ──────────────
	info, err := ResolveCDFarolInfo(db, cdID, empresaID)
	if err != nil {
		return nil, time.Time{}, time.Time{}, err
	}

	// ── Classificação Curva ABC (sp_enderecos, importação CALIBRACAO mais
	//    recente e concluída do CD). Falha de query NUNCA vira mapa vazio
	//    silencioso — isso faria todo produto do Farol virar "não-correspondência"
	//    e o painel mentir "Nenhuma pendência". ──────────────────────────────
	curvaMap, err := carregarClassificacaoCurva(db, cdID)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("erro carregando classificação de produtos: %w", err)
	}

	// ── Propostas aprovadas no mesmo período. Falha de query NUNCA é
	//    tratada como "nenhum produto aprovado" — isso geraria falsos positivos. ──
	aprovados, err := carregarCodprodsAprovados(db, cdID, periodoIni)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("erro carregando calibragens aprovadas: %w", err)
	}

	// ── Farol: produtos faturados na filial do CD, no período informado ───
	produtosFarol, err := GetProdutosFaturados(info.CodFilial, periodoIni, periodoFim)
	if err != nil {
		return nil, time.Time{}, time.Time{}, fmt.Errorf("%w: %v", ErrFarolIndisponivel, err)
	}

	// ── Última proposta (qualquer status) por codprod — puramente
	//    informativo, não afeta quais produtos entram na lista. Se a query
	//    falhar, a coleta continua (a lista de pendências em si já está
	//    correta), mas NUNCA afirma "nunca teve proposta" por engano —
	//    marca como indisponível para não informar algo falso. ───────────
	ultimasPropostas, err := carregarUltimasPropostas(db, cdID)
	ultimaPropostaIndisponivel := false
	if err != nil {
		log.Printf("[faturamento] erro carregando última proposta por produto do CD %d: %v", cdID, err)
		ultimasPropostas = map[int]ultimaProposta{}
		ultimaPropostaIndisponivel = true
	}

	// ── Acesso ao picking na 1ª importação do CD — evolução até hoje.
	//    Puramente informativo; falha aqui não impede o resto da coleta,
	//    apenas some a evolução (o valor atual continua vindo de curvaMap). ──
	acessoInicialMap, err := carregarAcessoPrimeiraImportacao(db, cdID)
	if err != nil {
		log.Printf("[faturamento] erro carregando acesso da 1ª importação do CD %d: %v", cdID, err)
		acessoInicialMap = map[int]int{}
	}

	// ── Comparação ────────────────────────────────────────────────────────
	type agregado struct {
		classe   string
		produto  string
		qtd      float64
		codDepto string // p/ casar com o índice sazonal da Seção (best-effort)
		codSec   string
	}
	porCodprod := map[int]*agregado{}
	naoCorrespondencias := 0

	for _, p := range produtosFarol {
		codprod, convErr := strconv.Atoi(strings.TrimSpace(p.CodProd))
		if convErr != nil {
			naoCorrespondencias++
			continue
		}
		classif, ok := curvaMap[codprod]
		if !ok || (classif.classe != "A" && classif.classe != "B") {
			// Sem correspondência em sp_enderecos, ou fora de Curva A/B:
			// ignorado silenciosamente na lista, contado agregadamente p/ diagnóstico.
			naoCorrespondencias++
			continue
		}
		if aprovados[codprod] {
			continue // já tem calibragem aprovada recente — não é pendência
		}
		if ag, exists := porCodprod[codprod]; exists {
			ag.qtd += p.Qt
		} else {
			porCodprod[codprod] = &agregado{
				classe: classif.classe, produto: classif.produto, qtd: p.Qt,
				codDepto: p.CodDepto, codSec: p.CodSec,
			}
		}
	}

	// ── Sazonalidade por Seção (best-effort — nunca aborta a coleta) ───────
	// Falha ou seção sem índice: os campos de sazonalidade ficam vazios no
	// item, o resto do painel continua normal.
	sazonalidadePorSecao := map[string]FarolSazonalidadeSecao{}
	if secoes, err := GetSazonalidadeSecao(info.CodFilial); err != nil {
		log.Printf("[faturamento] CD=%d: sazonalidade por seção indisponível: %v", cdID, err)
	} else {
		for _, s := range secoes {
			sazonalidadePorSecao[s.CodDepto+"|"+s.CodSec] = s
		}
	}

	if naoCorrespondencias > 0 {
		log.Printf("[faturamento] CD=%d: %d produto(s) do Farol sem correspondência Curva A/B em sp_enderecos", cdID, naoCorrespondencias)
	}

	pendencias := make([]FaturamentoPendenciaItem, 0, len(porCodprod))
	for codprod, ag := range porCodprod {
		item := FaturamentoPendenciaItem{
			CodProd:      codprod,
			Produto:      ag.produto,
			ClasseVenda:  ag.classe,
			QtdFaturada:  ag.qtd,
			UltimoStatus: "nunca",
		}
		if ultimaPropostaIndisponivel {
			item.UltimoStatus = "indisponivel"
		} else if up, ok := ultimasPropostas[codprod]; ok {
			item.UltimoStatus = up.status
			gap := up.delta
			item.Gap = &gap
			item.UltimaAtualizacao = up.data.Format("2006-01-02")
		}
		if classif, ok := curvaMap[codprod]; ok && classif.temAcessos {
			acessos := classif.acessos90
			item.AcessosPicking = &acessos
		}
		if inicial, ok := acessoInicialMap[codprod]; ok {
			item.AcessosInicial = &inicial
		}
		if ag.codSec != "" {
			if saz, ok := sazonalidadePorSecao[ag.codDepto+"|"+ag.codSec]; ok && saz.MesPico > 0 {
				item.SazonalidadeSecao = saz.Secao
				indicePico := saz.IndicePico
				mesPico := saz.MesPico
				item.SazonalidadeIndicePico = &indicePico
				item.SazonalidadeMesPico = &mesPico
			}
		}
		pendencias = append(pendencias, item)
	}
	// Maiores gaps primeiro (produto mais crítico no topo); empate/sem gap
	// (nunca teve proposta) desempata por codprod para ordem estável.
	sort.Slice(pendencias, func(i, j int) bool {
		gi, gj := gapAbs(pendencias[i].Gap), gapAbs(pendencias[j].Gap)
		if gi != gj {
			return gi > gj
		}
		return pendencias[i].CodProd < pendencias[j].CodProd
	})

	resp := &FaturamentoSemCalibragemResponse{
		CdID:                     cdID,
		CdNome:                   info.CdNome,
		FilialNome:               info.FilialNome,
		PeriodoInicio:            periodoIni.Format("2006-01-02"),
		PeriodoFim:               periodoFim.Format("2006-01-02"),
		Pendencias:               pendencias,
		TotalNaoCorrespondencias: naoCorrespondencias,
	}
	return resp, periodoIni, periodoFim, nil
}

// ─── Persistência de snapshot ─────────────────────────────────────────────

// GerarRelatorioFaturamento coleta o painel (ColetarFaturamentoSemCalibragem)
// e persiste o snapshot em sp_relatorios_faturamento, retornando o id criado.
// Reaproveitado tanto pelo endpoint manual ("Gerar PDF"/"Enviar por email")
// quanto pelo worker diário — o worker sempre passa periodoIni/periodoFim
// zero (últimos 30 dias, ver ResolverPeriodoFaturamento), pois roda sem
// intervenção manual; os endpoints manuais podem informar um período
// explícito.
func GerarRelatorioFaturamento(db *sql.DB, cdID int, empresaID string, criadoPor string, periodoIni, periodoFim time.Time) (int, *FaturamentoSemCalibragemResponse, error) {
	periodoIni, periodoFim = ResolverPeriodoFaturamento(periodoIni, periodoFim)
	resp, periodoIni, periodoFim, err := coletarFaturamentoInterno(db, cdID, empresaID, periodoIni, periodoFim)
	if err != nil {
		log.Printf("[faturamento] CD=%d coletar dados FALHOU: %v", cdID, err)
		return 0, nil, err
	}
	log.Printf("[faturamento] CD=%d coletado: %d pendência(s), %d não-correspondência(s)",
		cdID, len(resp.Pendencias), resp.TotalNaoCorrespondencias)

	dadosJSON, err := json.Marshal(resp)
	if err != nil {
		return 0, nil, fmt.Errorf("serializar snapshot: %w", err)
	}

	var id int
	err = db.QueryRow(`
		INSERT INTO smartpick.sp_relatorios_faturamento (cd_id, periodo_inicio, periodo_fim, dados_json, criado_por)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, cdID, periodoIni, periodoFim, dadosJSON, criadoPor).Scan(&id)
	if err != nil {
		log.Printf("[faturamento] CD=%d salvar snapshot FALHOU: %v", cdID, err)
		return 0, nil, fmt.Errorf("salvar snapshot: %w", err)
	}
	log.Printf("[faturamento] CD=%d snapshot %d salvo com sucesso", cdID, id)

	return id, resp, nil
}

// ─── Queries internas (copiadas literalmente de sp_faturamento_sem_calibragem.go) ──

type classificacaoProduto struct {
	classe     string
	produto    string
	acessos90  int
	temAcessos bool
}

// carregarClassificacaoCurva retorna a classificação Curva ABC (apenas A/B) e
// o qt_acesso_90 (nº de acessos ao picking nos últimos 90 dias, direto do WMS)
// de cada codprod a partir da importação CALIBRACAO concluída mais recente do
// CD (mesmo padrão de calcularEvolucaoAcesso em resumo_executivo.go). Erro de
// query ou de iteração (rows.Err()) é sempre propagado — nunca mapa vazio
// silencioso quando a causa é falha de banco.
func carregarClassificacaoCurva(db *sql.DB, cdID int) (map[int]classificacaoProduto, error) {
	rows, err := db.Query(`
		WITH job AS (
			SELECT id FROM smartpick.sp_csv_jobs
			 WHERE cd_id = $1 AND status = 'done'
			 ORDER BY created_at DESC LIMIT 1
		)
		SELECT e.codprod, e.classe_venda, COALESCE(e.produto, ''), e.qt_acesso_90
		  FROM smartpick.sp_enderecos e
		 WHERE e.job_id = (SELECT id FROM job)
		   AND e.tipo_rel = 'CALIBRACAO'
		   AND e.classe_venda IN ('A', 'B')
	`, cdID)
	if err != nil {
		return nil, fmt.Errorf("query classificação Curva ABC: %w", err)
	}
	defer rows.Close()

	out := map[int]classificacaoProduto{}
	for rows.Next() {
		var codprod int
		var classe, produto string
		var acessos90 sql.NullInt64
		if err := rows.Scan(&codprod, &classe, &produto, &acessos90); err != nil {
			return nil, fmt.Errorf("scan classificação Curva ABC: %w", err)
		}
		cp := classificacaoProduto{classe: classe, produto: produto}
		if acessos90.Valid {
			cp.acessos90 = int(acessos90.Int64)
			cp.temAcessos = true
		}
		out[codprod] = cp
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração classificação Curva ABC: %w", err)
	}
	return out, nil
}

// carregarAcessoPrimeiraImportacao retorna o qt_acesso_90 de cada codprod na
// PRIMEIRA importação CALIBRACAO concluída do CD (o ponto de partida histórico
// do produto no SmartPick) — usado só para mostrar a evolução até hoje, nunca
// para decidir inclusão/exclusão de pendências. Se a primeira importação for a
// mesma que a mais recente (CD com um único job), retorna mapa vazio: não há
// evolução para mostrar ainda.
func carregarAcessoPrimeiraImportacao(db *sql.DB, cdID int) (map[int]int, error) {
	rows, err := db.Query(`
		WITH primeiro AS (
			SELECT id FROM smartpick.sp_csv_jobs
			 WHERE cd_id = $1 AND status = 'done'
			 ORDER BY created_at ASC LIMIT 1
		),
		mais_recente AS (
			SELECT id FROM smartpick.sp_csv_jobs
			 WHERE cd_id = $1 AND status = 'done'
			 ORDER BY created_at DESC LIMIT 1
		)
		SELECT e.codprod, e.qt_acesso_90
		  FROM smartpick.sp_enderecos e
		 WHERE e.job_id = (SELECT id FROM primeiro)
		   AND (SELECT id FROM primeiro) <> (SELECT id FROM mais_recente)
		   AND e.tipo_rel = 'CALIBRACAO'
		   AND e.qt_acesso_90 IS NOT NULL
	`, cdID)
	if err != nil {
		return nil, fmt.Errorf("query acesso na primeira importação: %w", err)
	}
	defer rows.Close()

	out := map[int]int{}
	for rows.Next() {
		var codprod, acessos int
		if err := rows.Scan(&codprod, &acessos); err != nil {
			return nil, fmt.Errorf("scan acesso na primeira importação: %w", err)
		}
		out[codprod] = acessos
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração acesso na primeira importação: %w", err)
	}
	return out, nil
}

// carregarCodprodsAprovados retorna o set de codprod com sp_propostas aprovada
// (status='aprovada', aprovado_em >= desde) para o CD. Erro de query ou de
// iteração (rows.Err()) é sempre propagado — nunca "nenhum produto aprovado".
func carregarCodprodsAprovados(db *sql.DB, cdID int, desde time.Time) (map[int]bool, error) {
	rows, err := db.Query(`
		SELECT DISTINCT codprod
		  FROM smartpick.sp_propostas
		 WHERE cd_id = $1 AND status = 'aprovada' AND tipo_rel = 'CALIBRACAO'
		   AND aprovado_em >= $2
	`, cdID, desde)
	if err != nil {
		return nil, fmt.Errorf("query propostas aprovadas: %w", err)
	}
	defer rows.Close()

	out := map[int]bool{}
	for rows.Next() {
		var codprod int
		if err := rows.Scan(&codprod); err != nil {
			return nil, fmt.Errorf("scan propostas aprovadas: %w", err)
		}
		out[codprod] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração propostas aprovadas: %w", err)
	}
	return out, nil
}

type ultimaProposta struct {
	status string
	delta  int
	data   time.Time
}

// carregarUltimasPropostas retorna, por codprod, a proposta mais recente
// (qualquer status) já gerada para o CD — usado só para exibir "último
// status"/"gap" no painel; nunca decide inclusão/exclusão de pendências.
func carregarUltimasPropostas(db *sql.DB, cdID int) (map[int]ultimaProposta, error) {
	rows, err := db.Query(`
		SELECT DISTINCT ON (codprod) codprod, status, delta, created_at
		  FROM smartpick.sp_propostas
		 WHERE cd_id = $1 AND tipo_rel = 'CALIBRACAO'
		 ORDER BY codprod, created_at DESC
	`, cdID)
	if err != nil {
		return nil, fmt.Errorf("query última proposta por produto: %w", err)
	}
	defer rows.Close()

	out := map[int]ultimaProposta{}
	for rows.Next() {
		var codprod int
		var up ultimaProposta
		if err := rows.Scan(&codprod, &up.status, &up.delta, &up.data); err != nil {
			return nil, fmt.Errorf("scan última proposta por produto: %w", err)
		}
		out[codprod] = up
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iteração última proposta por produto: %w", err)
	}
	return out, nil
}

// gapAbs retorna o valor absoluto do gap, ou 0 quando não há proposta
// (produtos sem histórico ficam no fim da ordenação por gap).
func gapAbs(gap *int) int {
	if gap == nil {
		return 0
	}
	if *gap < 0 {
		return -*gap
	}
	return *gap
}
