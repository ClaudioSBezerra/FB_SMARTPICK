package services

// omniroute.go — Cliente único do OmniRoute (proxy self-hosted, unified AI
// endpoint) para todo o backend. Substitui zai.go — a chave da Z.AI foi
// revogada pelo usuário; a plataforma de IA do SmartPick agora é o OmniRoute
// (https://omniroute.fbtechia.com), compatível com a API de chat da OpenAI.
//
// O modelo enviado é "combo_omniroute": um combo configurado no próprio
// OmniRoute que roteia/faz fallback entre vários modelos gratuitos via
// OpenRouter (glm-5.2:free, nemotron-3-*:free, lfm-2.5:free, nex-n2.5-mini:free
// etc.) — o balanceamento entre eles é responsabilidade do proxy, não deste
// cliente. Por serem modelos free, latência e disponibilidade variam mais que
// um provedor pago único; timeout generoso (45s) e um retry em falha de
// transporte cobrem isso sem prender o usuário indefinidamente.
//
// Erros são sempre tratados (nunca panic) e propagados como *OmniRouteError
// quando a API responde com status != 200, para os handlers decidirem a
// mensagem amigável (padrão idêntico ao zai.go que substitui).

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
	omniRouteEndpoint = "https://omniroute.fbtechia.com/v1/chat/completions"
	omniRouteModelo   = "combo_omniroute"
)

// Timeout por tentativa. Modelos gratuitos via OpenRouter podem demorar mais
// que um provedor pago dedicado — 45s dá margem sem travar a UI por tempo
// desproporcional.
var omniRouteHTTPClient = &http.Client{Timeout: 45 * time.Second}

// OmniRouteMessage é uma mensagem no formato OpenAI-compatível do OmniRoute.
type OmniRouteMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OmniRouteError carrega status HTTP e código de erro do OmniRoute para os
// handlers mapearem mensagens amigáveis.
type OmniRouteError struct {
	Status  int
	Code    string
	Message string
}

func (e *OmniRouteError) Error() string {
	return fmt.Sprintf("OmniRoute status %d code=%s: %s", e.Status, e.Code, e.Message)
}

// OmniRouteChat faz uma chamada de chat ao OmniRoute (combo_omniroute), com
// retry em falha de transporte (timeout/rede) — o combo já cuida de
// fallback entre modelos do lado dele.
func OmniRouteChat(messages []OmniRouteMessage, maxTokens int, temperature float64) (string, error) {
	apiKey := os.Getenv("OMNIROUTE_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("OMNIROUTE_API_KEY não configurada")
	}

	tentar := func() (string, error) {
		body, _ := json.Marshal(map[string]any{
			"model":       omniRouteModelo,
			"max_tokens":  maxTokens,
			"temperature": temperature,
			"messages":    messages,
		})
		req, err := http.NewRequest("POST", omniRouteEndpoint, bytes.NewReader(body))
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := omniRouteHTTPClient.Do(req)
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
			return "", &OmniRouteError{Status: resp.StatusCode, Code: eb.Error.Code, Message: msg}
		}

		var r struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			return "", fmt.Errorf("parse da resposta OmniRoute falhou: %w", err)
		}
		if len(r.Choices) == 0 {
			return "", fmt.Errorf("OmniRoute sem choices na resposta")
		}
		return strings.TrimSpace(r.Choices[0].Message.Content), nil
	}

	out, err := tentar()
	if err == nil {
		return out, nil
	}

	// Falha de transporte (timeout/rede): repete uma vez — pode cair num
	// modelo diferente do combo na tentativa seguinte.
	if _, ok := err.(*OmniRouteError); !ok {
		log.Printf("[omniroute] transporte falhou (%v) — retry", err)
		out, err = tentar()
		if err == nil {
			return out, nil
		}
	}

	return "", err
}
