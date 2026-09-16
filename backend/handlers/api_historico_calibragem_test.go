package handlers

// api_historico_calibragem_test.go — testa a auth por API key sem banco
// nem rede (mesmo padrão adotado no FB_FAROL/FB_CEREBRO pra essa classe
// de endpoint machine-to-machine).

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func fakeNextParaTeste(t *testing.T, empresaIDEsperado string) func(db *sql.DB, empresaID string) http.HandlerFunc {
	return func(db *sql.DB, empresaID string) http.HandlerFunc {
		if empresaID != empresaIDEsperado {
			t.Errorf("empresaID recebido = %q, want %q", empresaID, empresaIDEsperado)
		}
		return func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}
	}
}

func TestSmartPickAPIKeyAuthSemConfiguracao(t *testing.T) {
	t.Setenv("SMARTPICK_API_KEY", "")
	t.Setenv("SMARTPICK_API_KEY_EMPRESA_ID", "")

	handler := SmartPickAPIKeyAuth(fakeNextParaTeste(t, ""))(nil)
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d (integração não configurada)", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestSmartPickAPIKeyAuthChaveErrada(t *testing.T) {
	t.Setenv("SMARTPICK_API_KEY", "chave-certa")
	t.Setenv("SMARTPICK_API_KEY_EMPRESA_ID", "empresa-x")

	handler := SmartPickAPIKeyAuth(fakeNextParaTeste(t, "empresa-x"))(nil)
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem", nil)
	r.Header.Set("X-API-Key", "chave-errada")
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestSmartPickAPIKeyAuthSemHeader(t *testing.T) {
	t.Setenv("SMARTPICK_API_KEY", "chave-certa")
	t.Setenv("SMARTPICK_API_KEY_EMPRESA_ID", "empresa-x")

	handler := SmartPickAPIKeyAuth(fakeNextParaTeste(t, "empresa-x"))(nil)
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestSmartPickAPIKeyAuthChaveCertaChamaNext(t *testing.T) {
	t.Setenv("SMARTPICK_API_KEY", "chave-certa")
	t.Setenv("SMARTPICK_API_KEY_EMPRESA_ID", "empresa-x")

	handler := SmartPickAPIKeyAuth(fakeNextParaTeste(t, "empresa-x"))(nil)
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem", nil)
	r.Header.Set("X-API-Key", "chave-certa")
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (next deveria ter sido chamado)", rec.Code, http.StatusOK)
	}
}

func TestHistoricoCalibragemAPIHandlerSemCdID(t *testing.T) {
	handler := HistoricoCalibragemAPIHandler(nil, "empresa-x")
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d (cd_id obrigatório)", rec.Code, http.StatusBadRequest)
	}
}

func TestHistoricoCalibragemAPIHandlerCdIDInvalido(t *testing.T) {
	handler := HistoricoCalibragemAPIHandler(nil, "empresa-x")
	r := httptest.NewRequest(http.MethodGet, "/api/relatorios/historico-calibragem?cd_id=abc", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d (cd_id inválido)", rec.Code, http.StatusBadRequest)
	}
}

func TestHistoricoCalibragemAPIHandlerMetodoErrado(t *testing.T) {
	handler := HistoricoCalibragemAPIHandler(nil, "empresa-x")
	r := httptest.NewRequest(http.MethodPost, "/api/relatorios/historico-calibragem?cd_id=1", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
