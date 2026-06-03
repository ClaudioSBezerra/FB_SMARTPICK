package handlers

// sp_csv.go — Upload de CSV e consulta de jobs
//
// Story 4.3 — Upload de CSV e Enfileiramento
//
// POST /api/sp/csv/upload   → recebe arquivo, salva no disco, cria job 'pending'
// GET  /api/sp/csv/jobs     → lista jobs da empresa/cd
// GET  /api/sp/csv/jobs/{id} → status de um job específico

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ─── DTOs ─────────────────────────────────────────────────────────────────────

type SpCSVJobResponse struct {
	ID          string  `json:"id"`
	Filename    string  `json:"filename"`
	Status      string  `json:"status"`
	TotalLinhas *int    `json:"total_linhas"`
	LinhasOk    *int    `json:"linhas_ok"`
	LinhasErro  *int    `json:"linhas_erro"`
	ErroMsg     *string `json:"erro_msg,omitempty"`
	StartedAt   *string `json:"started_at,omitempty"`
	FinishedAt  *string `json:"finished_at,omitempty"`
	CreatedAt   string  `json:"created_at"`
	CDID        int     `json:"cd_id"`
	FilialID    int     `json:"filial_id"`
	// Estado de calibragem do lote: '' = não ativado, 'em_andamento' = ativado
	// (tem ciclo aberto), 'concluido' = ciclo finalizado.
	CicloStatus string  `json:"ciclo_status"`
}

// ─── Upload ───────────────────────────────────────────────────────────────────

// SpCSVUploadHandler recebe o arquivo CSV, salva no disco e enfileira o job.
// POST /api/sp/csv/upload
// Form fields: cd_id (int), filial_id (int), arquivo (file)
func SpCSVUploadHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil || !RequireWrite(spCtx, w) {
			return
		}

		// Limite de 50 MB
		if err := r.ParseMultipartForm(50 << 20); err != nil {
			http.Error(w, "Arquivo muito grande (máx 50 MB)", http.StatusBadRequest)
			return
		}

		cdIDStr   := r.FormValue("cd_id")
		filialIDStr := r.FormValue("filial_id")
		if cdIDStr == "" || filialIDStr == "" {
			http.Error(w, "cd_id e filial_id são obrigatórios", http.StatusBadRequest)
			return
		}

		var cdID, filialID int
		fmt.Sscan(cdIDStr, &cdID)
		fmt.Sscan(filialIDStr, &filialID)

		// Verifica que CD pertence à empresa
		var existe bool
		db.QueryRow(`
			SELECT EXISTS(
			  SELECT 1 FROM smartpick.sp_centros_dist cd
			  JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
			  WHERE cd.id = $1 AND f.id = $2 AND f.empresa_id = $3
			)
		`, cdID, filialID, spCtx.EmpresaID).Scan(&existe)
		if !existe {
			http.Error(w, "CD ou Filial não encontrado para esta empresa", http.StatusNotFound)
			return
		}

		file, header, err := r.FormFile("arquivo")
		if err != nil {
			http.Error(w, "Campo 'arquivo' obrigatório", http.StatusBadRequest)
			return
		}
		defer file.Close()

		lower := strings.ToLower(header.Filename)
		if !strings.HasSuffix(lower, ".csv") && !strings.HasSuffix(lower, ".txt") {
			http.Error(w, "Apenas arquivos .csv ou .txt são aceitos", http.StatusBadRequest)
			return
		}

		// Lê arquivo em memória para calcular hash SHA-256 antes de salvar
		fileBytes, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, "Erro ao ler arquivo", http.StatusInternalServerError)
			return
		}
		hashBytes := sha256.Sum256(fileBytes)
		fileHash := hex.EncodeToString(hashBytes[:])

		// Verifica duplicata: mesmo hash para o mesmo CD nesta empresa (ignora jobs com falha)
		var dupJobID, dupCreatedAt string
		dupErr := db.QueryRow(`
			SELECT id::text, TO_CHAR(created_at,'DD/MM/YYYY HH24:MI')
			FROM smartpick.sp_csv_jobs
			WHERE empresa_id = $1 AND cd_id = $2 AND file_hash = $3
			  AND status != 'failed'
			ORDER BY created_at DESC LIMIT 1
		`, spCtx.EmpresaID, cdID, fileHash).Scan(&dupJobID, &dupCreatedAt)
		if dupErr == nil {
			// Arquivo idêntico já foi importado com sucesso ou ainda está em processamento
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error":       "duplicate_file",
				"message":     fmt.Sprintf("Este arquivo já foi importado em %s. Para um novo ciclo, exporte uma nova carga do Winthor.", dupCreatedAt),
				"existing_id": dupJobID,
			})
			return
		}

		// Salva arquivo em uploads/
		uploadDir := "uploads"
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			http.Error(w, "Erro ao criar diretório de uploads", http.StatusInternalServerError)
			return
		}

		ts := time.Now().Format("20060102_150405")
		safeFilename := fmt.Sprintf("sp_%s_%d_%s", ts, cdID, filepath.Base(header.Filename))
		filePath := filepath.Join(uploadDir, safeFilename)

		if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
			http.Error(w, "Erro ao salvar arquivo", http.StatusInternalServerError)
			return
		}

		// Cria job no banco com hash
		var jobID string
		err = db.QueryRow(`
			INSERT INTO smartpick.sp_csv_jobs
			  (empresa_id, filial_id, cd_id, uploaded_by, filename, file_path, file_hash, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
			RETURNING id
		`, spCtx.EmpresaID, filialID, cdID, spCtx.UserID, header.Filename, filePath, fileHash).Scan(&jobID)
		if err != nil {
			os.Remove(filePath)
			http.Error(w, "Erro ao criar job: "+err.Error(), http.StatusInternalServerError)
			return
		}

		log.Printf("SpCSVUpload: job %s criado (cd=%d filial=%d) por %s", jobID, cdID, filialID, spCtx.UserID)
		w.WriteHeader(http.StatusCreated)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"job_id": jobID})
	}
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

// SpCSVJobsHandler lista os jobs de importação da empresa.
// GET /api/sp/csv/jobs?cd_id=X&limit=20
func SpCSVJobsHandler(db *sql.DB) http.HandlerFunc {
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

		cdIDFilter := r.URL.Query().Get("cd_id")
		query := `
			SELECT j.id, j.filename, j.status,
			       j.total_linhas, j.linhas_ok, j.linhas_erro, j.erro_msg,
			       TO_CHAR(j.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(j.finished_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       j.cd_id, j.filial_id,
			       COALESCE((
			           SELECT h.status FROM smartpick.sp_historico h
			           WHERE h.job_id = j.id
			           ORDER BY (h.status = 'em_andamento') DESC, h.executado_em DESC
			           LIMIT 1
			       ), '') AS ciclo_status
			FROM smartpick.sp_csv_jobs j
			WHERE j.empresa_id = $1
		`
		args := []interface{}{spCtx.EmpresaID}
		if cdIDFilter != "" {
			query += " AND j.cd_id = $2"
			args = append(args, cdIDFilter)
		}
		query += " ORDER BY j.created_at DESC LIMIT 50"

		rows, err := db.Query(query, args...)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var jobs []SpCSVJobResponse
		for rows.Next() {
			var j SpCSVJobResponse
			if err := rows.Scan(
				&j.ID, &j.Filename, &j.Status,
				&j.TotalLinhas, &j.LinhasOk, &j.LinhasErro, &j.ErroMsg,
				&j.StartedAt, &j.FinishedAt, &j.CreatedAt,
				&j.CDID, &j.FilialID, &j.CicloStatus,
			); err != nil {
				continue
			}
			jobs = append(jobs, j)
		}
		if jobs == nil {
			jobs = []SpCSVJobResponse{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jobs)
	}
}

// SpCSVJobStatusHandler retorna o status de um job específico.
// GET /api/sp/csv/jobs/{id}
func SpCSVJobStatusHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodDelete && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		spCtx := GetSpContext(r)
		if spCtx == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		rest := strings.TrimPrefix(r.URL.Path, "/api/sp/csv/jobs/")

		// ── POST .../{id}/concluir: dá baixa manual no ciclo (marca 'concluido') ──
		// O lote sai dos painéis de Calibragem/Realocação e libera nova ativação,
		// mantendo o histórico. Mesma semântica do "Fechar ciclo" do Histórico.
		if r.Method == http.MethodPost && strings.HasSuffix(rest, "/concluir") {
			if !spCtx.CanApprove() {
				http.Error(w, "Forbidden: gestor_geral+ necessário", http.StatusForbidden)
				return
			}
			jobID := strings.TrimSuffix(rest, "/concluir")

			var cdID int
			err := db.QueryRow(
				`SELECT cd_id FROM smartpick.sp_csv_jobs WHERE id = $1 AND empresa_id = $2`,
				jobID, spCtx.EmpresaID,
			).Scan(&cdID)
			if err == sql.ErrNoRows {
				http.Error(w, "Lote não encontrado", http.StatusNotFound)
				return
			} else if err != nil {
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}

			// Recalcula contagens e marca o ciclo em andamento como concluído.
			res, err := db.Exec(`
				UPDATE smartpick.sp_historico h
				SET status = 'concluido', concluido_em = $1,
					total_propostas = sub.total, aprovadas = sub.aprovadas,
					rejeitadas = sub.rejeitadas, pendentes = sub.pendentes,
					curva_a = sub.curva_a, curva_b = sub.curva_b, curva_c = sub.curva_c
				FROM (
					SELECT COUNT(*) AS total,
						COUNT(*) FILTER (WHERE status = 'aprovada')  AS aprovadas,
						COUNT(*) FILTER (WHERE status = 'rejeitada') AS rejeitadas,
						COUNT(*) FILTER (WHERE status = 'pendente')  AS pendentes,
						COUNT(*) FILTER (WHERE classe_venda = 'A')   AS curva_a,
						COUNT(*) FILTER (WHERE classe_venda = 'B')   AS curva_b,
						COUNT(*) FILTER (WHERE classe_venda NOT IN ('A','B') OR classe_venda IS NULL) AS curva_c
					FROM smartpick.sp_propostas WHERE job_id = $2 AND tipo_rel = 'CALIBRACAO'
				) sub
				WHERE h.job_id = $2 AND h.empresa_id = $3 AND h.status = 'em_andamento'
			`, time.Now().UTC(), jobID, spCtx.EmpresaID)
			if err != nil {
				http.Error(w, "Erro ao concluir o lote: "+err.Error(), http.StatusInternalServerError)
				return
			}
			n, _ := res.RowsAffected()

			// Sem ciclo 'em_andamento': cria um histórico já 'concluido' (garante que
			// o filtro dos painéis oculte as propostas), salvo se já existir um.
			if n == 0 {
				// Lote sem propostas nunca foi ativado — nada a concluir.
				var temProp bool
				db.QueryRow(`SELECT EXISTS(SELECT 1 FROM smartpick.sp_propostas WHERE job_id = $1)`, jobID).Scan(&temProp)
				if !temProp {
					http.Error(w, "Lote não foi ativado (sem propostas) — nada a concluir. Use Excluir para removê-lo.", http.StatusConflict)
					return
				}
				var existeConcluido bool
				db.QueryRow(`SELECT EXISTS(SELECT 1 FROM smartpick.sp_historico WHERE job_id = $1 AND status = 'concluido')`, jobID).Scan(&existeConcluido)
				if !existeConcluido {
					_, err = db.Exec(`
						INSERT INTO smartpick.sp_historico
							(job_id, cd_id, empresa_id, executado_por, executado_em, status, concluido_em,
							 total_propostas, aprovadas, rejeitadas, pendentes, curva_a, curva_b, curva_c)
						SELECT $1, $2, $3, $4::uuid, now(), 'concluido', now(),
							COUNT(*),
							COUNT(*) FILTER (WHERE status = 'aprovada'),
							COUNT(*) FILTER (WHERE status = 'rejeitada'),
							COUNT(*) FILTER (WHERE status = 'pendente'),
							COUNT(*) FILTER (WHERE classe_venda = 'A'),
							COUNT(*) FILTER (WHERE classe_venda = 'B'),
							COUNT(*) FILTER (WHERE classe_venda NOT IN ('A','B') OR classe_venda IS NULL)
						FROM smartpick.sp_propostas WHERE job_id = $1 AND tipo_rel = 'CALIBRACAO'
					`, jobID, cdID, spCtx.EmpresaID, spCtx.UserID)
					if err != nil {
						http.Error(w, "Erro ao registrar conclusão: "+err.Error(), http.StatusInternalServerError)
						return
					}
				}
			}

			log.Printf("[CSV] lote concluído manualmente: job=%s empresa=%s", jobID, spCtx.EmpresaID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"message": "Lote concluído"})
			return
		}

		if r.Method == http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		jobID := rest
		if jobID == "" {
			http.Error(w, "job_id required", http.StatusBadRequest)
			return
		}

		// ── DELETE: exclui um lote de importação ainda NÃO ativado ──────────────
		// Permite remover um lote com erro (ou indesejado) antes de gerar propostas.
		// Bloqueia se o lote já foi ativado (possui propostas) para preservar dados.
		if r.Method == http.MethodDelete {
			// Confirma que o job pertence à empresa
			var exists bool
			if err := db.QueryRow(
				`SELECT EXISTS(SELECT 1 FROM smartpick.sp_csv_jobs WHERE id = $1 AND empresa_id = $2)`,
				jobID, spCtx.EmpresaID,
			).Scan(&exists); err != nil {
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			if !exists {
				http.Error(w, "Job não encontrado", http.StatusNotFound)
				return
			}

			// Bloqueia exclusão se já houver propostas geradas (lote ativado)
			var nProp int
			if err := db.QueryRow(
				`SELECT COUNT(*) FROM smartpick.sp_propostas WHERE job_id = $1 AND empresa_id = $2`,
				jobID, spCtx.EmpresaID,
			).Scan(&nProp); err != nil {
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			if nProp > 0 {
				http.Error(w, "Lote já ativado: possui propostas geradas e não pode ser excluído. Finalize ou rejeite as propostas pendentes deste CD.", http.StatusConflict)
				return
			}

			// Remove dados importados + o job (transação). sp_historico.job_id é
			// ON DELETE SET NULL, então eventual histórico é preservado.
			tx, err := db.Begin()
			if err != nil {
				http.Error(w, "Database error", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback()
			if _, err := tx.Exec(`DELETE FROM smartpick.sp_enderecos WHERE job_id = $1`, jobID); err != nil {
				http.Error(w, "Erro ao remover dados do lote: "+err.Error(), http.StatusInternalServerError)
				return
			}
			res, err := tx.Exec(`DELETE FROM smartpick.sp_csv_jobs WHERE id = $1 AND empresa_id = $2`, jobID, spCtx.EmpresaID)
			if err != nil {
				http.Error(w, "Erro ao remover o lote: "+err.Error(), http.StatusInternalServerError)
				return
			}
			if err := tx.Commit(); err != nil {
				http.Error(w, "Erro ao confirmar exclusão: "+err.Error(), http.StatusInternalServerError)
				return
			}
			n, _ := res.RowsAffected()
			log.Printf("[CSV] lote excluído: job=%s empresa=%s rows=%d", jobID, spCtx.EmpresaID, n)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"message": "Lote excluído"})
			return
		}

		var j SpCSVJobResponse
		err := db.QueryRow(`
			SELECT id, filename, status,
			       total_linhas, linhas_ok, linhas_erro, erro_msg,
			       TO_CHAR(started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       TO_CHAR(created_at,  'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       cd_id, filial_id
			FROM smartpick.sp_csv_jobs
			WHERE id = $1 AND empresa_id = $2
		`, jobID, spCtx.EmpresaID).Scan(
			&j.ID, &j.Filename, &j.Status,
			&j.TotalLinhas, &j.LinhasOk, &j.LinhasErro, &j.ErroMsg,
			&j.StartedAt, &j.FinishedAt, &j.CreatedAt,
			&j.CDID, &j.FilialID,
		)
		if err == sql.ErrNoRows {
			http.Error(w, "Job não encontrado", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(j)
	}
}
