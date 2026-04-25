package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
)

const smartpickSystemPrompt = `Você é o assistente de treinamento do SmartPick (sistema de calibragem de slots de picking para CDs). Responda sempre em português do Brasil, de forma direta e prática.

CONCEITOS BÁSICOS:
- Slot = endereço de picking (Rua-Prédio-Apto) com capacidade em caixas
- Giro/dia = QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS
- Delta (Δ) = sugestão − capacidade: positivo (+CX) = ampliar, negativo (−CX) = reduzir, zero = calibrado
- Curva A = alto giro (nunca reduz sozinho); B = médio; C = baixo. Ex: "A – 12.35%" = participação na curva ABC

ABAS DO PAINEL:
- Ampliar Slot: sugestão > capacidade → adicionar caixas no endereço físico
- Reduzir Slot: sugestão < capacidade → retirar caixas do endereço físico
- Já Calibrados: delta ≈ 0 (dentro de 5%) → nenhuma ação necessária
- Curva A — Revisar: Curva A protegida de redução → gestor decide manualmente
- Produtos Ignorados: excluídos da calibragem (sazonais, promoções etc.)

AÇÕES:
- Aprovar: botão verde → ajustar fisicamente depois
- Rejeitar: botão vermelho → selecionar motivo → confirmar
- Editar sugestão: clicar no número em "Sug./Δ" → novo valor → Enter
- Aprovar em lote: "Aprovar todos (N)" — revisar alertas ⚠ antes
- Ignorar produto: ícone olho riscado → tipo de motivo → confirmar
- Buscar: campo "Código ou descrição" filtra em tempo real

IMPORTAÇÃO CSV:
1. Menu "Importação CSV" → "Upload CSV"
2. Selecionar Filial e CD
3. Fazer upload do arquivo
4. Aguardar status "Concluído"
5. Abrir o Painel de Calibragem para ver as propostas

ALERTAS ⚠ (3 pontos por produto):
- GiroCap vermelho: giro ≥ capacidade → risco de ruptura
- GPRepos laranja: giro ≥ ponto de reposição → estado crítico
- CMEN2DDV amarelo: capacidade < 2 dias de venda

FILTROS: Departamento, Seção, Endereço, GiroCap, GPRepos, CMEN2DDV. Botão "Exportar Excel" baixa lista filtrada.

OUTROS MENUS: Histórico (calibragens + compliance) | Reincidência (produtos que voltam a desviar) | Painel de Resultados (métricas 4 ciclos) | Administração (Filiais, CDs, Regras do motor)`

// ── Tipos internos ────────────────────────────────────────────────────────────

type ajudaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ajudaChatRequest struct {
	Messages []ajudaMessage `json:"messages"`
	Context  string         `json:"context,omitempty"`
}

// Formato OpenAI-compatível usado pela Mistral AI
type mistralRequest struct {
	Model       string         `json:"model"`
	Messages    []ajudaMessage `json:"messages"`
	MaxTokens   int            `json:"max_tokens"`
	Temperature float64        `json:"temperature"`
}

type mistralResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	// Mistral retorna erros no formato plano, não aninhado
	Message string `json:"message,omitempty"`
	// Fallback para formato OpenAI-style
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// ── Handler ───────────────────────────────────────────────────────────────────

func SpAjudaChatHandler(_ *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		apiKey := os.Getenv("ZAI_API_KEY")
		if apiKey == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"Assistente não configurado. Contate o administrador."}`))
			return
		}

		var req ajudaChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) == 0 {
			http.Error(w, `{"error":"Requisição inválida"}`, http.StatusBadRequest)
			return
		}

		// Injeta contexto da página atual como primeira mensagem de sistema
		systemContent := smartpickSystemPrompt
		if req.Context != "" {
			systemContent += "\n\n## CONTEXTO ATUAL\nO usuário está na página: " + req.Context
		}

		// Monta o array de mensagens com a mensagem de sistema no início
		messages := []ajudaMessage{
			{Role: "system", Content: systemContent},
		}
		messages = append(messages, req.Messages...)

		payload, _ := json.Marshal(mistralRequest{
			Model:       "glm-4.5",
			Messages:    messages,
			MaxTokens:   1024,
			Temperature: 0.3,
		})

		httpReq, err := http.NewRequest("POST", "https://api.z.ai/api/paas/v4/chat/completions", bytes.NewReader(payload))
		if err != nil {
			http.Error(w, `{"error":"Erro interno"}`, http.StatusInternalServerError)
			return
		}
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
		httpReq.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			http.Error(w, `{"error":"Falha ao contactar o assistente. Tente novamente."}`, http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		raw, _ := io.ReadAll(resp.Body)

		writeErr := func(msg string) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, `{"error":%q}`, msg)
		}

		// Se o status HTTP não for 200, extrai a mensagem de erro da API
		if resp.StatusCode != http.StatusOK {
			log.Printf("[ajuda] Mistral API status %d: %s", resp.StatusCode, string(raw))
			var errBody map[string]interface{}
			if json.Unmarshal(raw, &errBody) == nil {
				if msg, ok := errBody["message"].(string); ok && msg != "" {
					writeErr("Erro da API: " + msg)
					return
				}
			}
			writeErr(fmt.Sprintf("Erro da API (status %d)", resp.StatusCode))
			return
		}

		var mistralResp mistralResponse
		if err := json.Unmarshal(raw, &mistralResp); err != nil {
			log.Printf("[ajuda] parse error: %v — body: %s", err, string(raw))
			writeErr("Resposta inesperada do assistente")
			return
		}

		// Erros no formato plano Mistral ({"message": "..."})
		if mistralResp.Message != "" && len(mistralResp.Choices) == 0 {
			log.Printf("[ajuda] Mistral error message: %s", mistralResp.Message)
			writeErr("Erro da API: " + mistralResp.Message)
			return
		}

		// Erros no formato OpenAI-style ({"error": {"message": "..."}})
		if mistralResp.Error != nil {
			log.Printf("[ajuda] Mistral error: %s", mistralResp.Error.Message)
			writeErr("Erro da API: " + mistralResp.Error.Message)
			return
		}

		if len(mistralResp.Choices) == 0 {
			log.Printf("[ajuda] empty choices — body: %s", string(raw))
			writeErr("Assistente não retornou resposta")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"reply": mistralResp.Choices[0].Message.Content,
		})
	}
}
