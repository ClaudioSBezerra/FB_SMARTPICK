package services

// csv_worker.go — Worker assíncrono de processamento de CSV
//
// Story 4.2 — Worker Assíncrono de CSV
//
// Padrão: goroutine + polling em sp_csv_jobs (status = 'pending').
// O worker roda em background desde o start do servidor e processa
// um job por vez (pode ser expandido para pool no futuro).
//
// Fluxo por job:
//   1. Marca job como 'processing'
//   2. Lê arquivo CSV do disco (file_path)
//   3. Faz parse linha a linha (separador ';', encoding UTF-8 BOM)
//   4. Insere em sp_enderecos (batch por transação)
//   5. Marca job como 'done' (ou 'failed' em caso de erro)
//
// Separadores CSV (Calibragem_WMS_v2.csv):
//   delimitador: ';'
//   decimal:     ',' (ex: "10,86" → 10.86)
//   encoding:    UTF-8 com BOM (bytes 0xEF 0xBB 0xBF removidos)

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// StartCSVWorker inicia o worker em background. Chamado via go StartCSVWorker(getDB) em main.go.
func StartCSVWorker(getDB func() *sql.DB) {
	go func() {
		log.Println("[CSVWorker] started")
		for {
			db := getDB()
			if db != nil {
				processNextJob(db)
			}
			time.Sleep(5 * time.Second)
		}
	}()
}

// processNextJob busca o próximo job pendente e processa.
func processNextJob(db *sql.DB) {
	// Seleciona e bloqueia atomicamente um job pendente (SKIP LOCKED evita concorrência)
	var jobID, filePath, empresaID string
	var cdID, filialID int
	err := db.QueryRow(`
		UPDATE smartpick.sp_csv_jobs
		SET status = 'processing', started_at = now()
		WHERE id = (
		  SELECT id FROM smartpick.sp_csv_jobs
		  WHERE status = 'pending'
		  ORDER BY created_at ASC
		  LIMIT 1
		  FOR UPDATE SKIP LOCKED
		)
		RETURNING id, file_path, empresa_id, cd_id, filial_id
	`).Scan(&jobID, &filePath, &empresaID, &cdID, &filialID)
	if err == sql.ErrNoRows {
		return // sem jobs pendentes
	}
	if err != nil {
		log.Printf("[CSVWorker] erro ao buscar job: %v", err)
		return
	}

	log.Printf("[CSVWorker] processando job %s (arquivo: %s)", jobID, filePath)

	linhasOk, linhasErro, err := parseAndInsertCSV(db, jobID, filePath, empresaID, filialID)

	if err != nil {
		log.Printf("[CSVWorker] job %s FAILED: %v", jobID, err)
		db.Exec(`
			UPDATE smartpick.sp_csv_jobs
			SET status = 'failed', erro_msg = $1, finished_at = now(),
			    linhas_ok = $2, linhas_erro = $3
			WHERE id = $4
		`, err.Error(), linhasOk, linhasErro, jobID)
		return
	}

	total := linhasOk + linhasErro
	db.Exec(`
		UPDATE smartpick.sp_csv_jobs
		SET status = 'done', finished_at = now(),
		    total_linhas = $1, linhas_ok = $2, linhas_erro = $3
		WHERE id = $4
	`, total, linhasOk, linhasErro, jobID)

	log.Printf("[CSVWorker] job %s concluído: %d ok / %d erros", jobID, linhasOk, linhasErro)
}

// Mapeamento de colunas do CSV (posição 0-based conforme Calibragem_WMS_v2.csv)
// Estrutura real do WMS exportado (27 colunas, índices 0-26):
//   0:CODFILIAL  1:CODEPTO  2:DEPARTAMENTO  3:CODSEC  4:SECAO  5:CODPROD
//   6:PRODUTO  7:EMBALAGEM  8:QTUNITCX  9:FORALINHA  10:RUA  11:PREDIO
//   12:APTO  13:CAPACIDADE  14:NORMA_PALETE  15:PONTOREPOSICAO
//   16:CLASSEVENDA  17:CLASSEVENDA_DIAS  18:QTGIRODIA_SISTEMA
//   19:QTACESSO_PICKING_PERIODO_90  20:QT_DIAS  21:QT_PROD  22:QT_PROD_CX
//   23:MED_VENDA_DIAS_CX  24:MED_VENDA_DIAS  25:MED_DIAS_ESTOQUE
//   26:MED_VENDA_DIAS_CX_ANOANT_MESSEG
const (
	colCodFilial    = 0
	colCodEpto      = 1
	colDepartamento = 2
	colCodSec       = 3
	colSecao        = 4
	colCodProd      = 5
	colProduto      = 6
	colEmbalagem    = 7
	colQtUnitCx     = 8  // QTUNITCX — armazenado em unidade_master
	colForaLinha    = 9
	colRua          = 10
	colPredio       = 11
	colApto         = 12
	colCapacidade   = 13
	colNormaPalete  = 14
	colPontoRep     = 15
	colClasseVenda  = 16
	colClasseDias   = 17
	colGiroDia      = 18
	colAcesso90     = 19
	colQtDias       = 20
	colQtProd       = 21
	colQtProdCx     = 22
	colMedVendaCx   = 23
	colMedVendaDias = 24
	colMedDiasEst   = 25
	colMedVendaCxAA = 26
)

func parseAndInsertCSV(db *sql.DB, jobID, filePath, empresaID string, filialID int) (ok, erros int, err error) {
	f, err := os.Open(filePath)
	if err != nil {
		return 0, 0, fmt.Errorf("arquivo não encontrado: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.Comma = ';'
	r.LazyQuotes = true
	r.TrimLeadingSpace = true

	// Lê cabeçalho (primeira linha)
	header, err := r.Read()
	if err != nil {
		return 0, 0, fmt.Errorf("erro ao ler cabeçalho: %w", err)
	}
	// Remove BOM da primeira coluna do cabeçalho se presente
	if len(header) > 0 {
		header[0] = strings.TrimPrefix(header[0], "\xef\xbb\xbf")
	}

	// Processa em batch de 500 linhas por transação
	const batchSize = 500
	var batch [][]string

	flushBatch := func() error {
		if len(batch) == 0 {
			return nil
		}
		tx, txErr := db.Begin()
		if txErr != nil {
			return txErr
		}
		defer tx.Rollback()

		stmt, stmtErr := tx.Prepare(`
			INSERT INTO smartpick.sp_enderecos (
				job_id, filial_id, cod_filial, codepto, departamento, codsec, secao,
				codprod, produto, embalagem, fora_linha, rua, predio, apto,
				capacidade, norma_palete, ponto_reposicao, classe_venda, classe_venda_dias,
				qt_giro_dia, qt_acesso_90, qt_dias, qt_prod, qt_prod_cx,
				med_venda_cx, med_venda_dias, med_dias_estoque, med_venda_cx_aa, unidade_master
			) VALUES (
				$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
				$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
			)
		`)
		if stmtErr != nil {
			return stmtErr
		}
		defer stmt.Close()

		for _, row := range batch {
			if len(row) < 27 {
				erros++
				continue
			}
			args := rowToArgs(jobID, filialID, row)
			if _, execErr := stmt.Exec(args...); execErr != nil {
				log.Printf("[CSVWorker] erro na linha: %v", execErr)
				erros++
				continue
			}
			ok++
		}

		return tx.Commit()
	}

	for {
		row, readErr := r.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			erros++
			continue
		}
		batch = append(batch, row)
		if len(batch) >= batchSize {
			if flushErr := flushBatch(); flushErr != nil {
				return ok, erros, flushErr
			}
			batch = batch[:0]
		}
	}

	if flushErr := flushBatch(); flushErr != nil {
		return ok, erros, flushErr
	}

	return ok, erros, nil
}

// rowToArgs converte uma linha CSV nos argumentos do prepared statement.
func rowToArgs(jobID string, filialID int, row []string) []interface{} {
	get := func(i int) string {
		if i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}
	parseInt := func(s string) *int {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		v, err := strconv.Atoi(s)
		if err != nil {
			return nil
		}
		return &v
	}
	parseFloat := func(s string) *float64 {
		s = strings.TrimSpace(strings.ReplaceAll(s, ",", "."))
		if s == "" {
			return nil
		}
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &v
	}

	codFilial := parseInt(get(colCodFilial))
	codFilialVal := filialID
	if codFilial != nil {
		codFilialVal = *codFilial
	}

	foraLinha := strings.EqualFold(get(colForaLinha), "S")
	classeVenda := get(colClasseVenda)
	if len(classeVenda) > 1 {
		classeVenda = classeVenda[:1]
	}

	return []interface{}{
		jobID,                          // $1  job_id
		filialID,                       // $2  filial_id
		codFilialVal,                   // $3  cod_filial
		parseInt(get(colCodEpto)),      // $4  codepto
		get(colDepartamento),           // $5  departamento
		parseInt(get(colCodSec)),       // $6  codsec
		get(colSecao),                  // $7  secao
		parseInt(get(colCodProd)),      // $8  codprod
		get(colProduto),                // $9  produto
		get(colEmbalagem),              // $10 embalagem
		foraLinha,                      // $11 fora_linha
		parseInt(get(colRua)),          // $12 rua
		parseInt(get(colPredio)),       // $13 predio
		parseInt(get(colApto)),         // $14 apto
		parseInt(get(colCapacidade)),   // $15 capacidade
		parseInt(get(colNormaPalete)),  // $16 norma_palete
		parseInt(get(colPontoRep)),     // $17 ponto_reposicao
		nilIfEmpty(classeVenda),        // $18 classe_venda
		parseInt(get(colClasseDias)),   // $19 classe_venda_dias
		parseFloat(get(colGiroDia)),    // $20 qt_giro_dia
		parseInt(get(colAcesso90)),     // $21 qt_acesso_90
		parseInt(get(colQtDias)),       // $22 qt_dias
		parseInt(get(colQtProd)),       // $23 qt_prod
		parseInt(get(colQtProdCx)),     // $24 qt_prod_cx
		parseFloat(get(colMedVendaCx)), // $25 med_venda_cx
		parseFloat(get(colMedVendaDias)), // $26 med_venda_dias
		parseFloat(get(colMedDiasEst)), // $27 med_dias_estoque
		parseFloat(get(colMedVendaCxAA)), // $28 med_venda_cx_aa
		parseInt(get(colQtUnitCx)),     // $29 unidade_master (= QTUNITCX)
	}
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
