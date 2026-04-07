package main

// FB_SMARTPICK — Sistema de Recalibração de Picking
// Version: 1.0.0
import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"fb_smartpick/handlers"
	"fb_smartpick/services"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

const (
	BackendVersion = "1.0.0"
	FeatureSet     = "SmartPick WMS — Recalibração de Picking"
)

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	Features  string `json:"features"`
	Database  string `json:"database"`
	DBError   string `json:"db_error,omitempty"`
}

var (
	db      *sql.DB
	dbMutex sync.RWMutex
	dbErr   error
)

func getDB() *sql.DB {
	dbMutex.RLock()
	defer dbMutex.RUnlock()
	return db
}

func initDBAsync() {
	go func() {
		var conn *sql.DB
		var err error
		connStr := os.Getenv("DATABASE_URL")
		if connStr == "" {
			connStr = "postgres://postgres:postgres@localhost:5432/fb_smartpick?sslmode=disable"
			fmt.Println("DATABASE_URL not set, using default local connection:", connStr)
		}

		attempt := 0
		for {
			attempt++
			conn, err = sql.Open("postgres", connStr)
			if err == nil {
				err = conn.Ping()
				if err == nil {
					conn.SetMaxOpenConns(50)
					conn.SetMaxIdleConns(15)
					conn.SetConnMaxLifetime(15 * time.Minute)

					dbMutex.Lock()
					db = conn
					dbErr = nil
					dbMutex.Unlock()

					fmt.Println("Successfully connected to the database!")
					onDBConnected()
					return
				}
			}

			dbMutex.Lock()
			dbErr = fmt.Errorf("attempt %d: %v", attempt, err)
			dbMutex.Unlock()

			fmt.Printf("Failed to connect to database (attempt %d): %v. Retrying in 5s...\n", attempt, err)
			time.Sleep(5 * time.Second)
		}
	}()
}

func onDBConnected() {
	database := getDB()

	migrationDir := "migrations"
	if _, err := os.Stat(migrationDir); os.IsNotExist(err) {
		if _, err := os.Stat("backend/migrations"); err == nil {
			migrationDir = "backend/migrations"
		}
	}

	fmt.Printf("Looking for migrations in: %s\n", migrationDir)
	files, err := filepath.Glob(filepath.Join(migrationDir, "*.sql"))
	if err != nil {
		log.Printf("Error finding migration files: %v", err)
	} else {
		var tableExists bool
		_ = database.QueryRow(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='schema_migrations')`).Scan(&tableExists)

		if !tableExists {
			_, err = database.Exec(`CREATE TABLE schema_migrations (
				filename VARCHAR(255) PRIMARY KEY,
				executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
			)`)
			if err != nil {
				log.Printf("Warning: Failed to create schema_migrations table: %v", err)
			}
		} else {
			var hasFilename bool
			_ = database.QueryRow(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='schema_migrations' AND column_name='filename')`).Scan(&hasFilename)
			if !hasFilename {
				var oldCol string
				_ = database.QueryRow(`SELECT column_name FROM information_schema.columns WHERE table_name='schema_migrations' ORDER BY ordinal_position LIMIT 1`).Scan(&oldCol)
				if oldCol != "" {
					log.Printf("Renaming schema_migrations column '%s' → 'filename'", oldCol)
					_, renameErr := database.Exec(fmt.Sprintf(`ALTER TABLE schema_migrations RENAME COLUMN %s TO filename`, oldCol))
					if renameErr != nil {
						log.Printf("ERROR: Failed to rename column: %v.", renameErr)
					}
				}
			}

			var colType string
			_ = database.QueryRow(`SELECT data_type FROM information_schema.columns WHERE table_name='schema_migrations' AND column_name='filename'`).Scan(&colType)
			if colType != "" && colType != "character varying" && colType != "text" {
				_, _ = database.Exec(`DROP TABLE schema_migrations`)
				_, _ = database.Exec(`CREATE TABLE schema_migrations (
					filename VARCHAR(255) PRIMARY KEY,
					executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
				)`)
				log.Println("schema_migrations table recreated with correct schema")
			} else {
				var hasExec bool
				_ = database.QueryRow(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='schema_migrations' AND column_name='executed_at')`).Scan(&hasExec)
				if !hasExec {
					_, _ = database.Exec(`ALTER TABLE schema_migrations ADD COLUMN executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`)
				}
			}
		}

		if len(files) == 0 {
			log.Println("Warning: No migration files found!")
		}
		for _, file := range files {
			baseName := filepath.Base(file)
			var alreadyExecuted bool
			errCheck := database.QueryRow("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1)", baseName).Scan(&alreadyExecuted)
			if errCheck != nil {
				log.Printf("Warning: Could not check migration status for %s: %v", baseName, errCheck)
				continue
			}
			if alreadyExecuted {
				continue
			}

			fmt.Printf("Executing migration: %s\n", file)
			migration, err := os.ReadFile(file)
			if err != nil {
				log.Printf("Could not read migration file %s: %v", file, err)
				continue
			}
			_, err = database.Exec(string(migration))
			if err != nil {
				log.Printf("Migration %s FAILED: %v", file, err)
				if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "duplicate") {
					_, _ = database.Exec("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", baseName)
					fmt.Printf("Migration %s skipped (already exists).\n", file)
				}
			} else {
				fmt.Printf("Migration %s executed successfully.\n", file)
				_, insertErr := database.Exec("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", baseName)
				if insertErr != nil {
					log.Printf("Warning: Could not record migration %s: %v", baseName, insertErr)
				}
			}
		}
	}
}

func main() {
	_ = godotenv.Load()
	fmt.Printf("FB_SMARTPICK Backend v%s\n", BackendVersion)

	handlers.ValidateJWTSecret()
	initDBAsync()
	go services.StartCSVWorker(getDB)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	// ── Health ────────────────────────────────────────────────────────────────
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		dbStatus := "connecting..."
		database := getDB()
		var dbStats string
		var lastErr string

		if database != nil {
			stats := database.Stats()
			if err := database.Ping(); err != nil {
				dbStatus = "error: " + err.Error()
			} else {
				dbStatus = "connected"
			}
			dbStats = fmt.Sprintf("Open: %d, InUse: %d, Idle: %d, Wait: %v",
				stats.OpenConnections, stats.InUse, stats.Idle, stats.WaitDuration)
		} else {
			dbMutex.RLock()
			if dbErr != nil {
				dbStatus = "error"
				lastErr = dbErr.Error()
			}
			dbMutex.RUnlock()
		}

		json.NewEncoder(w).Encode(HealthResponse{
			Status:    "running",
			Timestamp: time.Now().Format(time.RFC3339),
			Service:   "FB_SMARTPICK Recalibração de Picking",
			Version:   BackendVersion,
			Features:  FeatureSet,
			Database:  fmt.Sprintf("%s (%s)", dbStatus, dbStats),
			DBError:   lastErr,
		})
	})

	withDB := func(handlerFactory func(*sql.DB) http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			database := getDB()
			if database == nil {
				http.Error(w, "Database initializing, please wait...", http.StatusServiceUnavailable)
				return
			}
			handlerFactory(database)(w, r)
		}
	}

	withAuth := func(handlerFactory func(*sql.DB) http.HandlerFunc, role string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			database := getDB()
			if database == nil {
				http.Error(w, "Database initializing...", http.StatusServiceUnavailable)
				return
			}
			handlers.AuthMiddleware(handlerFactory(database), role)(w, r)
		}
	}

	// ── Auth ──────────────────────────────────────────────────────────────────
	http.HandleFunc("/api/auth/register",        withDB(handlers.RegisterHandler))
	http.HandleFunc("/api/auth/login",           withDB(handlers.LoginHandler))
	http.HandleFunc("/api/auth/me",              withAuth(handlers.GetMeHandler, ""))
	http.HandleFunc("/api/auth/forgot-password", withDB(handlers.ForgotPasswordHandler))
	http.HandleFunc("/api/auth/reset-password",  withDB(handlers.ResetPasswordHandler))
	http.HandleFunc("/api/auth/change-password", withAuth(handlers.ChangePasswordHandler, ""))
	http.HandleFunc("/api/auth/refresh",         withDB(handlers.RefreshHandler))
	http.HandleFunc("/api/auth/logout",          withDB(handlers.LogoutHandler))

	// ── Hierarchy (tenant/grupo/empresa) ──────────────────────────────────────
	http.HandleFunc("/api/user/hierarchy",          withAuth(handlers.GetUserHierarchyHandler, ""))
	http.HandleFunc("/api/user/companies",          withAuth(handlers.GetUserCompaniesHandler, ""))
	http.HandleFunc("/api/user/preferred-company",  withAuth(handlers.UpdatePreferredCompanyHandler, ""))

	// ── Admin — Usuários ─────────────────────────────────────────────────────
	http.HandleFunc("/api/admin/users",         withAuth(handlers.ListUsersHandler, "admin"))
	http.HandleFunc("/api/admin/users/create",  withAuth(handlers.CreateUserHandler, "admin"))
	http.HandleFunc("/api/admin/users/promote", withAuth(handlers.PromoteUserHandler, "admin"))
	http.HandleFunc("/api/admin/users/delete",  withAuth(handlers.DeleteUserHandler, "admin"))
	http.HandleFunc("/api/admin/users/reassign", withAuth(handlers.ReassignUserHandler, "admin"))

	// ── Config — Ambientes / Grupos / Empresas ────────────────────────────────
	http.HandleFunc("/api/config/environments", withAuth(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				handlers.GetEnvironmentsHandler(db)(w, r)
			case http.MethodPost:
				handlers.CreateEnvironmentHandler(db)(w, r)
			case http.MethodPut:
				handlers.UpdateEnvironmentHandler(db)(w, r)
			case http.MethodDelete:
				handlers.DeleteEnvironmentHandler(db)(w, r)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		}
	}, ""))

	http.HandleFunc("/api/config/groups", withAuth(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				handlers.GetGroupsHandler(db)(w, r)
			case http.MethodPost:
				handlers.CreateGroupHandler(db)(w, r)
			case http.MethodDelete:
				handlers.DeleteGroupHandler(db)(w, r)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		}
	}, ""))

	http.HandleFunc("/api/config/companies", withAuth(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				handlers.GetCompaniesHandler(db)(w, r)
			case http.MethodPost:
				handlers.CreateCompanyHandler(db)(w, r)
			case http.MethodDelete:
				handlers.DeleteCompanyHandler(db)(w, r)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		}
	}, ""))

	// ── Filiais (selector global) ─────────────────────────────────────────────
	http.HandleFunc("/api/filiais", withAuth(handlers.GetFiliaisHandler, ""))

	// ── SmartPick — Gestão de Usuários (RBAC) ────────────────────────────────
	withSP := func(handlerFactory func(*sql.DB) http.HandlerFunc, requiredSpRole string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			database := getDB()
			if database == nil {
				http.Error(w, "Database initializing...", http.StatusServiceUnavailable)
				return
			}
			handlers.SmartPickAuthMiddleware(database, handlerFactory(database), requiredSpRole)(w, r)
		}
	}

	http.HandleFunc("/api/sp/usuarios", withSP(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet:
				handlers.SpListUsuariosHandler(db)(w, r)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		}
	}, "admin_fbtax"))
	// ── SmartPick — Filiais, CDs, Parâmetros do Motor e Planos ──────────────
	http.HandleFunc("/api/sp/filiais", withSP(handlers.SpFiliaisHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/filiais/", withSP(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			switch {
			case strings.HasSuffix(path, "/cds"):
				handlers.SpCDsHandler(db)(w, r)
			default:
				handlers.SpFilialItemHandler(db)(w, r)
			}
		}
	}, "gestor_filial"))
	http.HandleFunc("/api/sp/cds/", withSP(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			switch {
			case strings.HasSuffix(path, "/duplicar"):
				handlers.SpDuplicarCDHandler(db)(w, r)
			case strings.HasSuffix(path, "/params"):
				handlers.SpMotorParamsHandler(db)(w, r)
			default:
				handlers.SpCDItemHandler(db)(w, r)
			}
		}
	}, "gestor_filial"))
	http.HandleFunc("/api/sp/plano", withSP(handlers.SpPlanoHandler, "gestor_filial"))

	// ── SmartPick — CSV Upload e Motor ────────────────────────────────────
	http.HandleFunc("/api/sp/csv/upload",    withSP(handlers.SpCSVUploadHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/csv/jobs",      withSP(handlers.SpCSVJobsHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/csv/jobs/",     withSP(handlers.SpCSVJobStatusHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/motor/calibrar", withSP(handlers.SpMotorCalibrarHandler, "gestor_geral"))

	// ── SmartPick — Geração de PDF (Epic 6) ──────────────────────────────────
	http.HandleFunc("/api/sp/pdf/calibracao", withSP(handlers.SpPDFCalibracaoHandler, "gestor_filial"))

	// ── SmartPick — Dashboard de Urgência e Propostas (Epic 5) ───────────────
	http.HandleFunc("/api/sp/propostas", withSP(handlers.SpPropostasHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/propostas/resumo", withSP(handlers.SpPropostasResumoHandler, "gestor_filial"))
	http.HandleFunc("/api/sp/propostas/aprovar-lote", withSP(handlers.SpPropostasAprovarLoteHandler, "gestor_geral"))
	http.HandleFunc("/api/sp/propostas/", withSP(handlers.SpPropostaItemHandler, "gestor_geral"))

	http.HandleFunc("/api/sp/usuarios/", withSP(func(db *sql.DB) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			switch {
			case strings.HasSuffix(path, "/filiais"):
				handlers.SpVincularFiliaisHandler(db)(w, r)
			case strings.HasSuffix(path, "/role"):
				handlers.SpUpdateRoleHandler(db)(w, r)
			default:
				http.Error(w, "Not found", http.StatusNotFound)
			}
		}
	}, "admin_fbtax"))

	// ── Frontend estático (SPA React) ─────────────────────────────────────────
	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		fs := http.FileServer(http.Dir(staticDir))
		http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.NotFound(w, r)
				return
			}
			filePath := filepath.Join(staticDir, filepath.Clean(r.URL.Path))
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
				http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
				return
			}
			if r.URL.Path == "/" || r.URL.Path == "/index.html" {
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
			}
			fs.ServeHTTP(w, r)
		})
		fmt.Println("Serving frontend from ./static")
	}

	fmt.Printf("FB_SMARTPICK starting on port %s...\n", port)

	allowedOrigins := handlers.GetAllowedOrigins()
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handlers.SecurityMiddleware(http.DefaultServeMux, allowedOrigins),
		ReadTimeout:  300 * time.Second,
		WriteTimeout: 300 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)
		sig := <-sigChan
		log.Printf("Received signal %v, shutting down gracefully...", sig)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP server shutdown error: %v", err)
		}

		if database := getDB(); database != nil {
			log.Println("Closing database connections...")
			database.Close()
		}

		log.Println("Shutdown complete.")
		os.Exit(0)
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
