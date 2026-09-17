package handlers

// api_centros_distribuicao_test.go — testa os caminhos de validação sem
// banco (auth já é coberta por api_historico_calibragem_test.go, mesma
// SmartPickAPIKeyAuth).

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCentrosDistribuicaoAPIHandlerMetodoErrado(t *testing.T) {
	handler := CentrosDistribuicaoAPIHandler(nil, "empresa-x")
	r := httptest.NewRequest(http.MethodPost, "/api/relatorios/centros-distribuicao", nil)
	rec := httptest.NewRecorder()
	handler(rec, r)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
