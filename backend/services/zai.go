package services

// zai.go — Cliente único da Z.AI (GLM Coding Plan) para todo o backend.
//
// Corrige em definitivo os erros de IA em produção:
//
//  1. "context deadline exceeded (Client.Timeout exceeded while awaiting
//     headers)": os modelos GLM-4.5+ vêm com THINKING (raciocínio) ligado por
//     padrão — o modelo gera tokens ocultos antes do primeiro byte da resposta,
//     estourando o timeout do cliente. Aqui o thinking é DESLIGADO em toda
//     chamada ("thinking": {"type":"disabled"}), o que também elimina o bug de
//     content vazio (raciocínio consumia o max_tokens inteiro e a resposta
//     vinha só em reasoning_content).
//
//  2. Fallback errado: em sobrecarga o código antigo caía para glm-4.7-flash
//     (tier FREE, notório por 1305 "Service overloaded"). O fallback correto é
//     glm-4.6 — pago e coberto pelo plano GLM Coding Lite.
//
//  3. Código triplicado: sp_ajuda.go, text_to_sql.go e resumo_executivo.go
//     tinham clientes próprios com timeouts e tratamento de erro divergentes.
//
// Plano do usuário: GLM Coding Lite (cobre glm-4.7, glm-4.6, glm-4.5,
// glm-4.5-air). Endpoint EXCLUSIVO do plano: /api/coding/paas/v4 (o /api/paas/v4
// geral retorna 1113 "Insufficient balance" para esta chave).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	zaiEndpoint      = "https://api.z.ai/api/coding/paas/v4/chat/completions"
	zaiModeloPrimario = "glm-4.5-air" // mais barato/estável do plano
	zaiModeloFallback = "glm-4.6"     // pago, coberto pelo plano — NUNCA usar *-flash (free, vive em 1305)
)

// Timeout por tentativa. Com thinking desligado o glm-4.5-air responde em
// segundos; 30s cobre folgadamente sem prender o usuário em espera longa.
var zaiHTTPClient = &http.Client{Timeout: 30 * time.Second}

// ZAIMessage é uma mensagem no formato OpenAI-compatível da Z.AI.
type ZAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ZAIError carrega status HTTP e código de erro da Z.AI para os handlers
// mapearem mensagens amigáveis (1113 = sem saldo, 1305 = sobrecarga, etc).
type ZAIError struct {
	Status  int
	Code    string
	Message string
}

func (e *ZAIError) Error() string {
	return fmt.Sprintf("Z.AI status %d code=%s: %s", e.Status, e.Code, e.Message)
}

// IsUsageLimit indica code=1308 ("Usage limit reached for 5 hour"): limite de
// uso da CONTA/chave de API, não do modelo. Trocar de modelo não ajuda — o
// fallback usa a mesma chave e recebe o mesmo 1308.
func (e *ZAIError) IsUsageLimit() bool {
	return e.Code == "1308"
}

// ZAIChat faz uma chamada de chat à Z.AI com thinking desligado, retry em
// falha de transporte e fallback de modelo em sobrecarga/rate-limit.
//
// Estratégia (máx. 3 tentativas, ~30s cada):
//  1. glm-4.5-air
//  2. transporte falhou (timeout/rede)? → repete glm-4.5-air
//  3. 429/1305 ou nova falha?           → glm-4.6
func ZAIChat(messages []ZAIMessage, maxTokens int, temperature float64) (string, error) {
	apiKey := os.Getenv("ZAI_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("ZAI_API_KEY não configurada")
	}

	tentar := func(model string) (string, error) {
		body, _ := json.Marshal(map[string]any{
			"model":       model,
			"max_tokens":  maxTokens,
			"temperature": temperature,
			"messages":    messages,
			// Desliga o raciocínio oculto: resposta rápida e content sempre preenchido.
			"thinking": map[string]string{"type": "disabled"},
		})
		req, err := http.NewRequest("POST", zaiEndpoint, bytes.NewReader(body))
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := zaiHTTPClient.Do(req)
		if err != nil {
			return "", err // erro de transporte (timeout, DNS, conexão)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)

		if resp.StatusCode != http.StatusOK {
			var eb struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal(raw, &eb)
			msg := eb.Error.Message
			if msg == "" {
				msg = eb.Message
			}
			if msg == "" {
				msg = string(raw)
			}
			return "", &ZAIError{Status: resp.StatusCode, Code: eb.Error.Code, Message: msg}
		}

		var r struct {
			Choices []struct {
				Message struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			return "", fmt.Errorf("parse da resposta Z.AI falhou: %w", err)
		}
		if len(r.Choices) == 0 {
			return "", fmt.Errorf("Z.AI sem choices na resposta")
		}
		out := r.Choices[0].Message.Content
		if out == "" {
			// Não deveria ocorrer com thinking desligado; mantido por segurança.
			out = r.Choices[0].Message.ReasoningContent
		}
		return strings.TrimSpace(out), nil
	}

	// 1ª tentativa: modelo primário
	out, err := tentar(zaiModeloPrimario)
	if err == nil {
		return out, nil
	}

	// Falha de transporte (timeout/rede): repete o primário uma vez.
	if _, ok := err.(*ZAIError); !ok {
		log.Printf("[zai] transporte falhou em %s (%v) — retry", zaiModeloPrimario, err)
		out, err = tentar(zaiModeloPrimario)
		if err == nil {
			return out, nil
		}
	}

	// 1308 = limite de uso da CONTA (não do modelo): glm-4.6 usa a mesma
	// chave de API e falharia com o mesmo erro — pula o fallback e some com
	// uma chamada e um log inúteis. A mensagem da Z.AI já traz o horário de reset.
	if ze, ok := err.(*ZAIError); ok && ze.IsUsageLimit() {
		log.Printf("[zai] %s: limite de uso da conta atingido — sem fallback (mesma chave de API): %v", zaiModeloPrimario, err)
		return "", err
	}

	// 429 (sobrecarga do modelo) / 1305 / nova falha de transporte: tenta o fallback pago.
	deveFallback := false
	if ze, ok := err.(*ZAIError); ok {
		if ze.Status == http.StatusTooManyRequests || ze.Code == "1305" {
			deveFallback = true
		}
	} else {
		deveFallback = true // transporte falhou 2x no primário
	}
	if deveFallback {
		log.Printf("[zai] %s falhou (%v) — fallback %s", zaiModeloPrimario, err, zaiModeloFallback)
		if out2, err2 := tentar(zaiModeloFallback); err2 == nil {
			return out2, nil
		} else {
			log.Printf("[zai] fallback %s também falhou: %v", zaiModeloFallback, err2)
		}
	}
	return "", err
}
