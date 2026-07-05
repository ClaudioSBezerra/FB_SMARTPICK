package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"

	"fb_smartpick/services"
)

// rxCodProd extrai códigos de produto (4–7 dígitos isolados) das mensagens.
var rxCodProd = regexp.MustCompile(`\b(\d{4,7})\b`)

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

// ── Handler ───────────────────────────────────────────────────────────────────

func SpAjudaChatHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		if os.Getenv("ZAI_API_KEY") == "" {
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

		// Se alguma mensagem mencionar um código de produto, busca os dados reais
		// e injeta no contexto para que a IA responda com números corretos.
		spCtx := GetSpContext(r)
		if db != nil && spCtx != nil && spCtx.EmpresaID != "" {
			systemContent += buscarContextoProduto(db, req.Messages, spCtx.EmpresaID)
		}

		// Monta o array de mensagens com a mensagem de sistema no início
		messages := []services.ZAIMessage{
			{Role: "system", Content: systemContent},
		}
		for _, m := range req.Messages {
			messages = append(messages, services.ZAIMessage{Role: m.Role, Content: m.Content})
		}

		// Cliente compartilhado (services/zai.go): thinking desligado, retry em
		// timeout e fallback glm-4.6 em sobrecarga — corrige os "context deadline
		// exceeded" que apareciam em produção.
		reply, err := services.ZAIChat(messages, 1024, 0.3)
		if err != nil {
			log.Printf("[ajuda] Z.AI falhou: %v", err)
			w.Header().Set("Content-Type", "application/json")

			if ze, ok := err.(*services.ZAIError); ok {
				if ze.Code == "1113" {
					w.WriteHeader(http.StatusBadGateway)
					w.Write([]byte(`{"error":"Saldo insuficiente na conta da plataforma de IA. Contate o administrador para recarregar."}`))
					return
				}
				w.WriteHeader(http.StatusBadGateway)
				fmt.Fprintf(w, `{"error":%q}`, fmt.Sprintf("Erro da API (%d): %s", ze.Status, ze.Message))
				return
			}
			// Erro de transporte (timeout/rede) mesmo após retry+fallback
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"Serviço de IA momentaneamente indisponível. Tente novamente em alguns segundos."}`))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"reply": reply})
	}
}

// buscarContextoProduto varre as mensagens em busca de códigos de produto e,
// se encontrar, consulta vw_propostas_chat e devolve um bloco de contexto para
// ser injetado no system prompt. Assim a IA responde com dados reais em vez de
// inventar números.
func buscarContextoProduto(db *sql.DB, msgs []ajudaMessage, empresaID string) string {
	// Coleta todos os candidatos a codprod nas mensagens do usuário
	seen := map[string]bool{}
	var codprods []string
	for _, m := range msgs {
		if m.Role != "user" {
			continue
		}
		for _, match := range rxCodProd.FindAllString(m.Content, -1) {
			if !seen[match] {
				seen[match] = true
				codprods = append(codprods, match)
			}
		}
	}
	if len(codprods) == 0 {
		return ""
	}

	// Consulta os dados do(s) produto(s) — máx. 3 para não inflar o prompt
	if len(codprods) > 3 {
		codprods = codprods[:3]
	}

	var bloco string
	for _, cp := range codprods {
		var (
			codprod        int
			produto        string
			classeVenda    string
			capAtual       sql.NullInt64
			sugestao       sql.NullInt64
			delta          sql.NullInt64
			justificativa  sql.NullString
			giroDia        sql.NullFloat64
			medVendaCx     sql.NullFloat64
			pontoReposicao sql.NullInt64
		)
		err := db.QueryRow(`
			SELECT codprod, produto, COALESCE(classe_venda,''),
			       capacidade_atual, sugestao_calibragem, delta,
			       justificativa, giro_dia_cx, med_venda_cx, ponto_reposicao
			FROM smartpick.vw_propostas_chat
			WHERE codprod = $1 AND empresa_id = $2::uuid
			ORDER BY created_at DESC
			LIMIT 1
		`, cp, empresaID).Scan(
			&codprod, &produto, &classeVenda,
			&capAtual, &sugestao, &delta,
			&justificativa, &giroDia, &medVendaCx, &pontoReposicao,
		)
		if err != nil {
			continue
		}
		bloco += fmt.Sprintf(`

## DADOS REAIS DO PRODUTO %d — %s
- Curva: %s
- Capacidade atual: %v cx
- Sugestão calibragem: %v cx
- Delta (Δ): %v cx
- Giro/dia (cx): %v
- Média venda cx/dia: %v
- Ponto de reposição: %v
- Fórmula aplicada pelo motor: %s

Use esses dados exatos ao explicar qualquer cálculo sobre este produto.`,
			codprod, produto, classeVenda,
			nullInt(capAtual), nullInt(sugestao), nullInt(delta),
			nullFloat(giroDia), nullFloat(medVendaCx), nullInt(pontoReposicao),
			nullStr(justificativa),
		)
	}
	return bloco
}

func nullInt(v sql.NullInt64) interface{} {
	if v.Valid {
		return v.Int64
	}
	return "—"
}

func nullFloat(v sql.NullFloat64) interface{} {
	if v.Valid {
		return fmt.Sprintf("%.4f", v.Float64)
	}
	return "—"
}

func nullStr(v sql.NullString) string {
	if v.Valid {
		return v.String
	}
	return "—"
}
