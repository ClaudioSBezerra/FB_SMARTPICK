package handlers

// sp_motor.go — Motor de Calibragem SmartPick
//
// Story 4.5 — Motor de Calibragem
//
// POST /api/sp/motor/calibrar → executa o motor para um job processado
//
// Lógica do motor:
//   Para cada endereço em sp_enderecos do job:
//     1. Lê os parâmetros do CD (sp_motor_params)
//     2. Determina a média de vendas diária relevante (cx ou unidade)
//     3. Calcula sugestão = ceil(med_venda * dias_max_estoque_da_curva * fator_seguranca)
//     4. Aplica regra curva_a_nunca_reduz: Curva A → sugestão ≥ capacidade_atual
//     5. Aplica min_capacidade
//     6. Gera justificativa textual
//     7. Insere em sp_propostas (status = 'pendente')
//
// Idempotente: se já existem propostas para o job, retorna 409 Conflict.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
)

// ─── Tipos internos do motor ──────────────────────────────────────────────────

type motorParams struct {
	DiasAnalise      int
	CurvaAMaxEst     int
	CurvaBMaxEst     int
	CurvaCMaxEst     int
	FatorSeguranca   float64
	CurvaANuncaReduz bool
	MinCapacidade    int
}

type enderecoDB struct {
	ID              int64
	CodFilial       int
	CodProd         int
	Produto         string
	Rua             *int
	Predio          *int
	Apto            *int
	ClasseVenda     string
	Capacidade      *int
	MedVendaCx      *float64
	MedVendaDias    *float64
	MedDiasEstoque  *float64
	MedVendaCxAA    *float64
	UnidadeMaster   *int
}

// ─── Handler ──────────────────────────────────────────────────────────────────

func nilIfEmptyStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// SpMotorCalibrarHandler executa o motor de calibragem para um job.
// POST /api/sp/motor/calibrar
// Body: { "job_id": "uuid" }
func SpMotorCalibrarHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.CanApprove() {
			http.Error(w, "Forbidden: gestor_geral+ para executar o motor", http.StatusForbidden)
			return
		}

		var body struct {
			JobID string `json:"job_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.JobID == "" {
			http.Error(w, "job_id obrigatório", http.StatusBadRequest)
			return
		}

		// Verifica que o job pertence à empresa e está concluído
		var cdID, filialID int
		var jobStatus string
		err := db.QueryRow(`
			SELECT cd_id, filial_id, status
			FROM smartpick.sp_csv_jobs
			WHERE id = $1 AND empresa_id = $2
		`, body.JobID, spCtx.EmpresaID).Scan(&cdID, &filialID, &jobStatus)
		if err == sql.ErrNoRows {
			http.Error(w, "Job não encontrado", http.StatusNotFound)
			return
		}
		if jobStatus != "done" {
			http.Error(w, "Job ainda não concluído (status: "+jobStatus+")", http.StatusUnprocessableEntity)
			return
		}

		// Idempotência: verifica se já foram geradas propostas para este job
		var jaExiste bool
		db.QueryRow(`SELECT EXISTS(SELECT 1 FROM smartpick.sp_propostas WHERE job_id = $1 AND empresa_id = $2)`, body.JobID, spCtx.EmpresaID).Scan(&jaExiste)
		if jaExiste {
			http.Error(w, "Propostas já geradas para este job", http.StatusConflict)
			return
		}

		// Carrega parâmetros do motor para o CD
		params, err := loadMotorParams(db, cdID)
		if err != nil {
			http.Error(w, "Parâmetros do motor não encontrados para o CD", http.StatusUnprocessableEntity)
			return
		}

		// Cria registro de histórico antes de lançar o motor
		historicoID := CriarHistorico(db, body.JobID, spCtx.EmpresaID, spCtx.UserID, cdID)

		// Executa o motor em background para não bloquear o request
		go func() {
			gerado, erros := executarMotor(db, body.JobID, cdID, spCtx.EmpresaID, params)
			log.Printf("[Motor] job %s: %d propostas geradas, %d erros", body.JobID, gerado, erros)
			FecharHistoricoAuto(db, historicoID, body.JobID)
		}()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message": "Motor iniciado em background",
			"job_id":  body.JobID,
		})
	}
}

// ─── Lógica do motor ──────────────────────────────────────────────────────────

func loadMotorParams(db *sql.DB, cdID int) (*motorParams, error) {
	var p motorParams
	err := db.QueryRow(`
		SELECT dias_analise, curva_a_max_est, curva_b_max_est, curva_c_max_est,
		       fator_seguranca, curva_a_nunca_reduz, min_capacidade
		FROM smartpick.sp_motor_params
		WHERE cd_id = $1
	`, cdID).Scan(&p.DiasAnalise, &p.CurvaAMaxEst, &p.CurvaBMaxEst, &p.CurvaCMaxEst,
		&p.FatorSeguranca, &p.CurvaANuncaReduz, &p.MinCapacidade)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func executarMotor(db *sql.DB, jobID string, cdID int, empresaID string, params *motorParams) (gerado, erros int) {
	rows, err := db.Query(`
		SELECT id, cod_filial, codprod, COALESCE(produto,''), rua, predio, apto,
		       COALESCE(classe_venda,''), capacidade,
		       med_venda_cx, med_venda_dias, med_dias_estoque, med_venda_cx_aa, unidade_master
		FROM smartpick.sp_enderecos
		WHERE job_id = $1
	`, jobID)
	if err != nil {
		log.Printf("[Motor] erro ao carregar endereços: %v", err)
		return 0, 1
	}
	defer rows.Close()

	const batchSize = 200
	type proposta struct {
		EnderecoID         int64
		CodFilial          int
		CodProd            int
		Produto            string
		Rua, Predio, Apto  *int
		ClasseVenda        string
		CapacidadeAtual    *int
		Sugestao           int
		Justificativa      string
	}

	var batch []proposta

	flush := func() {
		if len(batch) == 0 {
			return
		}
		tx, err := db.Begin()
		if err != nil {
			erros += len(batch)
			batch = batch[:0]
			return
		}
		defer tx.Rollback()

		stmt, err := tx.Prepare(`
			INSERT INTO smartpick.sp_propostas
			  (job_id, endereco_id, empresa_id, cd_id,
			   cod_filial, codprod, produto, rua, predio, apto,
			   classe_venda, capacidade_atual, sugestao_calibragem, justificativa)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		`)
		if err != nil {
			erros += len(batch)
			batch = batch[:0]
			return
		}
		defer stmt.Close()

		for _, p := range batch {
			_, execErr := stmt.Exec(
				jobID, p.EnderecoID, empresaID, cdID,
				p.CodFilial, p.CodProd, p.Produto, p.Rua, p.Predio, p.Apto,
				nilIfEmptyStr(p.ClasseVenda), p.CapacidadeAtual, p.Sugestao, p.Justificativa,
			)
			if execErr != nil {
				log.Printf("[Motor] erro ao inserir proposta: %v", execErr)
				erros++
			} else {
				gerado++
			}
		}
		tx.Commit()
		batch = batch[:0]
	}

	for rows.Next() {
		var e enderecoDB
		if err := rows.Scan(
			&e.ID, &e.CodFilial, &e.CodProd, &e.Produto,
			&e.Rua, &e.Predio, &e.Apto, &e.ClasseVenda,
			&e.Capacidade, &e.MedVendaCx, &e.MedVendaDias,
			&e.MedDiasEstoque, &e.MedVendaCxAA, &e.UnidadeMaster,
		); err != nil {
			erros++
			continue
		}

		sugestao, justificativa := calcularSugestao(e, params)
		batch = append(batch, proposta{
			EnderecoID:      e.ID,
			CodFilial:       e.CodFilial,
			CodProd:         e.CodProd,
			Produto:         e.Produto,
			Rua:             e.Rua,
			Predio:          e.Predio,
			Apto:            e.Apto,
			ClasseVenda:     e.ClasseVenda,
			CapacidadeAtual: e.Capacidade,
			Sugestao:        sugestao,
			Justificativa:   justificativa,
		})

		if len(batch) >= batchSize {
			flush()
		}
	}
	flush()
	return
}

// calcularSugestao aplica a lógica ABC do motor e retorna (sugestão, justificativa).
func calcularSugestao(e enderecoDB, p *motorParams) (int, string) {
	// Determina dias máximo de estoque pela curva
	var diasMax int
	curva := strings.ToUpper(e.ClasseVenda)
	switch curva {
	case "A":
		diasMax = p.CurvaAMaxEst
	case "B":
		diasMax = p.CurvaBMaxEst
	default: // C ou sem classificação
		diasMax = p.CurvaCMaxEst
	}

	// Escolhe a melhor média disponível
	// Preferência: med_venda_cx (caixas/dia) → med_venda_dias → med_venda_cx_aa (ano anterior)
	var medVenda float64
	var fonteMedia string
	if e.MedVendaCx != nil && *e.MedVendaCx > 0 {
		medVenda = *e.MedVendaCx
		fonteMedia = "méd.cx"
	} else if e.MedVendaDias != nil && *e.MedVendaDias > 0 {
		// Converte unidades → caixas se unidade_master disponível
		med := *e.MedVendaDias
		if e.UnidadeMaster != nil && *e.UnidadeMaster > 1 {
			med = med / float64(*e.UnidadeMaster)
		}
		medVenda = med
		fonteMedia = "méd.dias"
	} else if e.MedVendaCxAA != nil && *e.MedVendaCxAA > 0 {
		medVenda = *e.MedVendaCxAA
		fonteMedia = "méd.cx.aa"
	}

	// Sugestão bruta: vendas diárias × dias máximos × fator de segurança
	sugestaoFloat := medVenda * float64(diasMax) * p.FatorSeguranca
	sugestao := int(math.Ceil(sugestaoFloat))

	// Garante mínimo absoluto
	if sugestao < p.MinCapacidade {
		sugestao = p.MinCapacidade
	}

	// Regra: Curva A nunca reduz
	capAtual := 0
	if e.Capacidade != nil {
		capAtual = *e.Capacidade
	}
	regra := ""
	if curva == "A" && p.CurvaANuncaReduz && sugestao < capAtual {
		sugestao = capAtual
		regra = " [Curva A: mantida]"
	}

	justificativa := fmt.Sprintf("Curva %s: %s=%.2f × %d dias × %.2f fator = %d%s",
		curva, fonteMedia, medVenda, diasMax, p.FatorSeguranca, sugestao, regra)

	return sugestao, justificativa
}
