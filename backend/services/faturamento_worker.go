package services

// faturamento_worker.go — Geração e envio automático diário do relatório de
// Faturamento sem Calibragem. Espelha resumo_worker.go (spec-faturamento-pdf-email.md),
// trocando a janela semanal (segunda 7h-9h, dedup 6 dias) pela janela diária
// (7h BRT, dedup 20h — tolera variação no horário exato do ticker sem pular
// um dia, já que o relatório é diário e não semanal).

import (
	"database/sql"
	"log"
	"time"
)

// StartFaturamentoWorker dispara o gerador automático do relatório de
// Faturamento sem Calibragem.
//
// A cada 1h verifica todos os CDs ativos. Se um CD:
//   - tem destinatários ativos (smartpick.sp_destinatarios_resumo)
//   - não teve relatório de faturamento gerado nas últimas 20h
//   - são 7h BRT
//
// gera o snapshot e envia por email.
func StartFaturamentoWorker(getDB func() *sql.DB) {
	go func() {
		log.Printf("[FaturamentoWorker] started")
		// Pequeno delay inicial para não disputar com migrations
		time.Sleep(60 * time.Second)
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		runOnce := func() {
			db := getDB()
			if db == nil {
				return
			}
			processarFaturamentoDiario(db)
		}

		// Roda imediatamente uma vez
		runOnce()
		for range ticker.C {
			runOnce()
		}
	}()
}

func processarFaturamentoDiario(db *sql.DB) {
	loc := time.FixedZone("BRT", -3*3600)
	now := time.Now().In(loc)

	// Janela de execução: 7h BRT (a hora cheia toda, para tolerar o ticker
	// horário não bater exatamente no minuto 0 de cada hora).
	if now.Hour() != 7 {
		return
	}

	rows, err := db.Query(`
		SELECT c.id, c.empresa_id::text
		  FROM smartpick.sp_centros_dist c
		 WHERE c.ativo = TRUE
		   AND EXISTS (
		     SELECT 1 FROM smartpick.sp_destinatarios_resumo d
		      WHERE d.cd_id = c.id AND d.ativo = TRUE
		   )
		   AND NOT EXISTS (
		     SELECT 1 FROM smartpick.sp_relatorios_faturamento r
		      WHERE r.cd_id = c.id
		        AND r.criado_em > NOW() - INTERVAL '20 hours'
		   )
	`)
	if err != nil {
		log.Printf("[FaturamentoWorker] erro listando CDs: %v", err)
		return
	}
	defer rows.Close()

	type cdRef struct {
		ID        int
		EmpresaID string
	}
	var cds []cdRef
	for rows.Next() {
		var c cdRef
		if rows.Scan(&c.ID, &c.EmpresaID) == nil {
			cds = append(cds, c)
		}
	}

	if len(cds) == 0 {
		return
	}
	log.Printf("[FaturamentoWorker] gerando relatório de faturamento para %d CDs", len(cds))

	for _, c := range cds {
		// Falha em 1 CD não impede os demais (mesmo padrão de gerarEEnviar
		// em resumo_worker.go).
		gerarEEnviarFaturamento(db, c.ID, c.EmpresaID)
		// pequeno espaçamento entre CDs para não sobrecarregar Farol/SMTP
		time.Sleep(3 * time.Second)
	}
}

func gerarEEnviarFaturamento(db *sql.DB, cdID int, empresaID string) {
	id, _, err := GerarRelatorioFaturamento(db, cdID, empresaID, "worker")
	if err != nil {
		log.Printf("[FaturamentoWorker] CD %d falhou ao gerar: %v", cdID, err)
		return
	}
	log.Printf("[FaturamentoWorker] CD %d relatório %d gerado, enviando emails…", cdID, id)

	enviados, err := EnviarFaturamentoPorEmail(db, id)
	erroMsg := ""
	if err != nil {
		erroMsg = err.Error()
		log.Printf("[FaturamentoWorker] CD %d envio falhou: %v", cdID, err)
	}
	if len(enviados) > 0 {
		_ = MarcarEnviadoFaturamento(db, id, enviados, erroMsg)
		log.Printf("[FaturamentoWorker] CD %d relatório %d enviado para %d destinatários", cdID, id, len(enviados))
	}
}
