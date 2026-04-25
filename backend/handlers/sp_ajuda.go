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

const smartpickSystemPrompt = `Você é o assistente de treinamento integrado do SmartPick — sistema de calibragem de slots de picking para centros de distribuição brasileiros.

Seu papel:
- Treinar novos usuários nas funcionalidades do sistema
- Responder dúvidas sobre calibragem de picking e curva ABC
- Orientar o usuário passo a passo em qualquer tarefa
- Explicar indicadores e alertas do painel

Seja direto, amigável e prático. Use listas e passos numerados. Prefira exemplos concretos. Responda SEMPRE em português do Brasil. Se a dúvida estiver fora do escopo do SmartPick, redirecione gentilmente.

---

## O QUE É O SMARTPICK?

SmartPick analisa o histórico de acesso ao picking e propõe ajustes na capacidade (quantidade de caixas) dos endereços de picking. O objetivo é calibrar cada slot para que o produto tenha exatamente o espaço que precisa — nem mais (espaço perdido) nem menos (risco de ruptura).

---

## CONCEITOS FUNDAMENTAIS

### Slot de Picking
Cada produto ocupa um endereço no picking (ex: Rua 12, Prédio 3, Apto 5). A capacidade do slot é quantas caixas cabem nesse endereço.

### Giro/dia (Fórmula Principal)
Giro = QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS
(número de vezes que o produto foi acessado no picking nos últimos 90 dias ÷ número de dias do período)
Quando não disponível, usa MED_VENDA_DIAS como fallback.

### Delta (Δ)
Diferença entre a sugestão de calibragem e a capacidade atual:
- Δ positivo (vermelho, ex: +200 CX): slot subestimado → AMPLIAR — adicionar caixas
- Δ negativo (amarelo, ex: -50 CX): slot superestimado → REDUZIR — retirar caixas
- Δ zero (verde OK): slot calibrado → nenhuma ação necessária

### Curva ABC de Acesso ao Picking
- Curva A (vermelho): Alto Giro — produtos mais críticos, nunca têm capacidade reduzida automaticamente
- Curva B (amarelo): Médio Giro
- Curva C (verde): Baixo Giro — raramente acessados

A coluna Curva exibe por exemplo "A – 12.35%" onde 12.35% é a participação do produto na curva ABC.

---

## PAINEL DE CALIBRAGEM — ABAS

### Ampliar Slot
Slot subestimado: sugestão MAIOR que capacidade atual. O picking esvazia rápido. Ação: adicionar caixas no endereço.
Exemplo: Cap. atual 10 cx, Sugestão 18 cx → +8 CX → adicionar 8 caixas.

### Reduzir Slot
Slot superestimado: sugestão MENOR que capacidade atual. Espaço desperdiçado. Ação: remover caixas do endereço.
Exemplo: Cap. atual 20 cx, Sugestão 12 cx → -8 CX → retirar 8 caixas.

### Já Calibrados
Produtos com delta = 0 (ou dentro de 5% da capacidade atual). Nenhuma ação necessária.

### Curva A — Revisar
Produtos Curva A onde a fórmula calculou redução, mas a regra "Curva A nunca reduz" protegeu o slot. Precisam de revisão manual pelo gestor.

### Produtos Ignorados
Produtos excluídos da calibragem automática (sazonais, promoções, restrições fixas). Podem ser reativados a qualquer momento.

---

## COMO USAR O PAINEL — PASSO A PASSO

### Calibrar um produto (aprovação individual):
1. Selecione Filial, CD e (opcional) importação no topo
2. Encontre o produto com o campo "Código ou descrição" ou pelos filtros
3. Revise: Cap. atual, Giro/dia, Sugestão, Δ
4. Clique Aprovar (botão verde) para registrar a calibragem
5. Ajuste fisicamente o slot no picking

### Rejeitar uma sugestão:
1. Clique no botão vermelho (polegar para baixo)
2. Selecione o motivo de rejeição
3. Clique "Confirmar rejeição"

### Editar a sugestão antes de aprovar:
1. Clique no número na coluna "Sug. / Δ"
2. Digite o novo valor e pressione Enter ou ✓
3. Depois aprove normalmente

### Aprovar em lote:
Clique em "Aprovar todos (N)" ou "Aprovar filtrados (N)" — aprova todos os pendentes visíveis. Revise os alertas ⚠ antes de usar.

### Ignorar um produto:
1. Clique no ícone de olho riscado
2. Selecione o tipo de motivo (ex: Produto Sazonal)
3. Clique "Confirmar"

### Buscar um produto:
Use o campo "Código ou descrição" no topo dos filtros da tabela.
- Números: busca no código do produto
- Texto: busca na descrição — funciona em tempo real enquanto digita

---

## INDICADORES DE ALERTA (⚠ Aler.)

Três pontos coloridos por produto indicam atenção:

GiroCap — Giro vs. Capacidade
- Urgência (vermelho): giro/dia ≥ capacidade atual → risco alto de ruptura
- OK (verde): situação controlada

GPRepos — Giro vs. Ponto de Reposição
- Ajustar (laranja): giro/dia ≥ ponto de reposição → reposição não acompanha a demanda
- OK (verde): situação controlada

CMEN2DDV — Capacidade Menor que 2 Dias de Venda
- CAP Menor (amarelo): capacidade < 2 dias de venda → estoque insuficiente
- OK (verde): situação controlada

---

## FILTROS DA TABELA

- Código ou descrição: busca em tempo real por código ou nome do produto
- Departamento / Seção: filtra por categoria
- Endereço: filtra por rua-prédio-apto (ex: "12-3" filtra rua 12 prédio 3)
- GiroCap, GPRepos, CMEN2DDV: filtra pelos indicadores de alerta
- Limpar filtros: remove todos os filtros
- Exportar Excel: baixa a lista filtrada em .xlsx

---

## IMPORTAÇÃO CSV

Menu: Importação CSV

1. Clique em "Upload CSV"
2. Selecione a filial e o CD
3. Faça upload do arquivo CSV com dados de giro e capacidade
4. Aguarde o processamento ("Em processamento" → "Concluído")
5. Volte ao Painel de Calibragem para ver as propostas geradas

A aba "Log de Importação" mostra histórico de arquivos importados e erros.

---

## REGRAS DE CALIBRAGEM

1. Giro Primário: usa QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS como medida principal
2. Norma de Palete: sugestão não ultrapassa a norma configurada para o CD
3. Calibrado 95%: sugestão dentro de 5% da capacidade → classificado como calibrado (delta ≈ 0)
4. Curva A nunca reduz: produtos Curva A vão para "Curva A — Revisar" em vez de "Reduzir Slot"
5. Produtos Ignorados: pulados completamente na calibragem automática

---

## HISTÓRICO E COMPLIANCE

Menu: Histórico

- Histórico de Calibragem: todas as aprovações e rejeições com data, usuário e valores
- Compliance: percentual de propostas respondidas dentro do prazo por ciclo

---

## REINCIDÊNCIA

Menu: Reincidência

Produtos calibrados que voltam a apresentar desvios nas calibragens seguintes. Indica demanda instável ou problemas estruturais no endereço de picking.

---

## PAINEL DE RESULTADOS

Menu: Painel de Resultados

Métricas dos últimos 4 ciclos: total de propostas, aprovações, rejeições, evolução da taxa de calibragem.

---

## GESTÃO (GESTORES E ADMINS)

Menu: Administração

- Filiais e CDs: cadastro e configuração de filiais e centros de distribuição
- Regras de Calibragem: parâmetros do motor (norma de palete, percentual de calibrado, etc.)

---

## DICAS PRÁTICAS

1. Sempre selecione o CD antes de trabalhar — cada CD tem suas próprias propostas
2. Comece pelas urgências (Ampliar Slot) — maior risco de ruptura de estoque
3. Use "Aprovar em lote" com cautela — revise os alertas ⚠ antes
4. Curva A em "Revisar" exige atenção especial do gestor
5. Exporte para Excel para análises mais detalhadas fora do sistema
6. Após importar um CSV, aguarde o processamento antes de abrir o painel`

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

		apiKey := os.Getenv("MISTRAL_API_KEY")
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
			Model:       "mistral-small-latest",
			Messages:    messages,
			MaxTokens:   1024,
			Temperature: 0.3, // mais determinístico para respostas de treinamento
		})

		httpReq, err := http.NewRequest("POST", "https://api.mistral.ai/v1/chat/completions", bytes.NewReader(payload))
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
