package handlers

// sp_admin.go — Operações administrativas SmartPick (apenas admin_fbtax)
//
// DELETE /api/sp/admin/limpar-calibragem
//   Apaga dados de calibragem (jobs, endereços, propostas, histórico) da empresa ativa.
//   Preserva: filiais, CDs, parâmetros do motor, plano, usuários.

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// SpLimparCalibragemHandler apaga todos os dados de calibragem e importação da empresa ativa.
// DELETE /api/sp/admin/limpar-calibragem
func SpLimparCalibragemHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		spCtx := GetSpContext(r)
		if spCtx == nil || !spCtx.IsAdminFbtax() {
			http.Error(w, "Forbidden: apenas admin_fbtax pode limpar dados", http.StatusForbidden)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Erro ao iniciar transação", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		// Coleta os file_paths dos jobs para remoção do disco
		rows, err := tx.Query(`
			SELECT file_path FROM smartpick.sp_csv_jobs
			WHERE empresa_id = $1 AND file_path IS NOT NULL
		`, spCtx.EmpresaID)
		var arquivos []string
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var p string
				if rows.Scan(&p) == nil {
					arquivos = append(arquivos, p)
				}
			}
		}

		// Limpa tabelas na ordem correta (respeitando FK)
		tabelas := []struct {
			nome string
			sql  string
		}{
			{"sp_historico",   `DELETE FROM smartpick.sp_historico   WHERE empresa_id = $1`},
			{"sp_propostas",   `DELETE FROM smartpick.sp_propostas   WHERE empresa_id = $1`},
			{"sp_enderecos",   `DELETE FROM smartpick.sp_enderecos   WHERE empresa_id = $1`},
			{"sp_csv_jobs",    `DELETE FROM smartpick.sp_csv_jobs    WHERE empresa_id = $1`},
		}

		totais := map[string]int64{}
		for _, t := range tabelas {
			res, execErr := tx.Exec(t.sql, spCtx.EmpresaID)
			if execErr != nil {
				log.Printf("SpLimparCalibragem: erro em %s: %v", t.nome, execErr)
				http.Error(w, "Erro ao limpar "+t.nome+": "+execErr.Error(), http.StatusInternalServerError)
				return
			}
			n, _ := res.RowsAffected()
			totais[t.nome] = n
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "Erro ao confirmar limpeza", http.StatusInternalServerError)
			return
		}

		// Remove arquivos CSV do disco (best-effort, não falha se arquivo não existir)
		removidos := 0
		for _, p := range arquivos {
			if p == "" {
				continue
			}
			// Sanitiza: só remove dentro do diretório de uploads
			clean := filepath.Clean(p)
			if err := os.Remove(clean); err == nil {
				removidos++
			}
		}

		log.Printf("SpLimparCalibragem: empresa=%s limpeza OK — jobs=%d enderecos=%d propostas=%d historico=%d arquivos=%d (by %s)",
			spCtx.EmpresaID,
			totais["sp_csv_jobs"], totais["sp_enderecos"],
			totais["sp_propostas"], totais["sp_historico"],
			removidos, spCtx.UserID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"message":          "Dados de calibragem removidos com sucesso",
			"sp_csv_jobs":      totais["sp_csv_jobs"],
			"sp_enderecos":     totais["sp_enderecos"],
			"sp_propostas":     totais["sp_propostas"],
			"sp_historico":     totais["sp_historico"],
			"arquivos_removidos": removidos,
		})
	}
}
