package services

// farol_client.go — Cliente HTTP para a API de vendas faturadas do Farol (FB_FAROL).
//
// Segue o padrão de zai.go: configuração via env vars, erro claro se ausentes,
// falha sempre tratada (nunca panic). O endpoint do Farol é um pré-requisito
// externo ainda não implementado — ver spec-farol-faturamento-sem-calibragem.md.
//
// Contrato assumido (Design Notes da spec — Ask First: renegociar se mudar):
//
//	GET {FAROL_BASE_URL}/api/farol/produtos-faturados?empresa={cod_filial}&data_ini=YYYY-MM-DD&data_fim=YYYY-MM-DD
//	Header: X-API-Key: {FAROL_API_KEY}
//	Resposta: [{ "cod_prod": "12345", "empresa": "11", "data_faturamento": "2026-08-15", "qt": 42.0 }]

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Timeout por chamada. O Farol é um serviço externo — não deixa o painel travado
// esperando indefinidamente; falha rápido e o painel mostra indisponibilidade.
var farolHTTPClient = &http.Client{Timeout: 20 * time.Second}

// ErrCDNaoEncontrado sinaliza que o cd_id genuinamente não existe ou não pertence
// à empresa do usuário — distinto de uma falha de banco (o handler mapeia cada
// caso para HTTP diferente: 404 vs 500).
var ErrCDNaoEncontrado = errors.New("cd não encontrado ou não pertence à empresa")

// FarolProdutoFaturado é um item da resposta do endpoint de vendas faturadas do Farol.
type FarolProdutoFaturado struct {
	CodProd         string  `json:"cod_prod"`
	Empresa         string  `json:"empresa"`
	DataFaturamento string  `json:"data_faturamento"`
	Qt              float64 `json:"qt"`
	// CodDepto/CodSec — adicionados no Farol em 31/08/2026 pra permitir casar
	// produto→Seção sem uma segunda chamada de dimensão. Usado por
	// ColetarFaturamentoSemCalibragem pra buscar o índice sazonal da seção do
	// produto (GetSazonalidadeSecao).
	CodDepto string `json:"cod_depto,omitempty"`
	CodSec   string `json:"cod_sec,omitempty"`
}

// FarolSazonalidadeSecao é um item da resposta do endpoint de sazonalidade por
// Seção do Farol — índice mensal (venda do mês / média do ano, sobre 2025) e o
// mês de maior impacto, por Departamento×Seção de uma filial.
type FarolSazonalidadeSecao struct {
	CodDepto   string      `json:"cod_depto"`
	Depto      string      `json:"depto"`
	CodSec     string      `json:"cod_sec"`
	Secao      string      `json:"secao"`
	Indices    [12]float64 `json:"indices"`
	MesPico    int         `json:"mes_pico"`
	IndicePico float64     `json:"indice_pico"`
}

// CDFarolInfo agrega os dados do CD necessários para chamar o Farol e exibir o painel.
type CDFarolInfo struct {
	CdNome     string
	FilialID   int
	FilialNome string
	CodFilial  int
}

// ResolveCDFarolInfo carrega nome do CD, filial e cod_filial (chave usada para
// casar com o campo "empresa" do Farol), escopado à empresa do usuário.
//
// Retorna ErrCDNaoEncontrado quando o CD genuinamente não existe/não pertence à
// empresa — QUALQUER outro erro (queda de banco, etc.) é propagado como erro comum,
// para o handler responder 500 em vez de mascarar como "CD não encontrado".
func ResolveCDFarolInfo(db *sql.DB, cdID int, empresaID string) (*CDFarolInfo, error) {
	var info CDFarolInfo
	err := db.QueryRow(`
		SELECT cd.nome, f.id, f.nome, f.cod_filial
		  FROM smartpick.sp_centros_dist cd
		  JOIN smartpick.sp_filiais f ON f.id = cd.filial_id
		 WHERE cd.id = $1 AND f.empresa_id = $2
	`, cdID, empresaID).Scan(&info.CdNome, &info.FilialID, &info.FilialNome, &info.CodFilial)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrCDNaoEncontrado
		}
		return nil, fmt.Errorf("erro consultando CD: %w", err)
	}
	return &info, nil
}

// GetProdutosFaturados busca no Farol os produtos faturados por uma filial
// (cod_filial) numa janela de datas [dataIni, dataFim]. Erro sempre tratado
// (rede, HTTP não-200, corpo ilegível ou JSON inválido) — nunca panic.
func GetProdutosFaturados(codFilial int, dataIni, dataFim time.Time) ([]FarolProdutoFaturado, error) {
	baseURL := os.Getenv("FAROL_BASE_URL")
	apiKey := os.Getenv("FAROL_API_KEY")
	if baseURL == "" || apiKey == "" {
		return nil, fmt.Errorf("FAROL_BASE_URL/FAROL_API_KEY não configuradas")
	}

	url := fmt.Sprintf("%s/api/farol/produtos-faturados?empresa=%d&data_ini=%s&data_fim=%s",
		strings.TrimRight(baseURL, "/"), codFilial, dataIni.Format("2006-01-02"), dataFim.Format("2006-01-02"))

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("erro montando requisição ao Farol: %w", err)
	}
	req.Header.Set("X-API-Key", apiKey)

	resp, err := farolHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("erro de transporte ao chamar Farol: %w", err)
	}
	defer resp.Body.Close()

	// io.ReadAll: erro nunca ignorado (corpo truncado/conexão cortada no meio
	// da leitura precisa virar erro tratado, não corpo parcial silencioso).
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("erro lendo resposta do Farol: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Farol respondeu status %d: %s", resp.StatusCode, string(raw))
	}

	var produtos []FarolProdutoFaturado
	if err := json.Unmarshal(raw, &produtos); err != nil {
		return nil, fmt.Errorf("erro parseando resposta do Farol: %w", err)
	}
	return produtos, nil
}

// GetSazonalidadeSecao busca no Farol o índice sazonal mensal por Seção
// (Departamento×Seção) de uma filial — calculado sobre 2025 (único ano
// fechado). Erro sempre tratado (rede, HTTP não-200, corpo ilegível ou JSON
// inválido) — nunca panic. Ver ColetarFaturamentoSemCalibragem: falha aqui é
// tratada como indisponibilidade PONTUAL (não aborta a coleta principal, só
// deixa a coluna de sazonalidade vazia) — a lista de pendências em si não
// depende deste dado.
func GetSazonalidadeSecao(codFilial int) ([]FarolSazonalidadeSecao, error) {
	baseURL := os.Getenv("FAROL_BASE_URL")
	apiKey := os.Getenv("FAROL_API_KEY")
	if baseURL == "" || apiKey == "" {
		return nil, fmt.Errorf("FAROL_BASE_URL/FAROL_API_KEY não configuradas")
	}

	url := fmt.Sprintf("%s/api/farol/sazonalidade-secao?empresa=%d",
		strings.TrimRight(baseURL, "/"), codFilial)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("erro montando requisição ao Farol: %w", err)
	}
	req.Header.Set("X-API-Key", apiKey)

	resp, err := farolHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("erro de transporte ao chamar Farol: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("erro lendo resposta do Farol: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Farol respondeu status %d: %s", resp.StatusCode, string(raw))
	}

	var secoes []FarolSazonalidadeSecao
	if err := json.Unmarshal(raw, &secoes); err != nil {
		return nil, fmt.Errorf("erro parseando resposta do Farol: %w", err)
	}
	return secoes, nil
}
