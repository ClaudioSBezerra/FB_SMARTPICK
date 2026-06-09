-- Migration 128: persistência das realocações de mercadoria na rua
--
-- Até aqui o Painel de Realocação só gerava um PDF efêmero — as movimentações
-- físicas (produto saiu do endereço A para o B) não eram salvas. Estas tabelas
-- capturam cada lote de realocação e seus movimentos, base para indicadores
-- precisos (movimentações no mês, ruas organizadas, curva A reposicionada, etc.).

CREATE TABLE IF NOT EXISTS smartpick.sp_realocacao_lote (
    id               BIGSERIAL    PRIMARY KEY,
    empresa_id       UUID         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    cd_id            INTEGER      NOT NULL REFERENCES smartpick.sp_centros_dist(id) ON DELETE CASCADE,
    rua              INTEGER,
    criado_por       UUID         REFERENCES public.users(id) ON DELETE SET NULL,
    criado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    total_slots      INTEGER      NOT NULL DEFAULT 0,  -- endereços da rua no lote
    total_movimentos INTEGER      NOT NULL DEFAULT 0   -- quantos produtos mudaram de endereço
);

CREATE TABLE IF NOT EXISTS smartpick.sp_realocacao_item (
    id            BIGSERIAL  PRIMARY KEY,
    lote_id       BIGINT     NOT NULL REFERENCES smartpick.sp_realocacao_lote(id) ON DELETE CASCADE,
    codprod       INTEGER    NOT NULL,
    produto       TEXT,
    classe_venda  CHAR(1),               -- curva ABC do produto realocado
    end_origem    TEXT,                  -- endereço de onde o produto saiu (rua-predio-apto)
    end_destino   TEXT,                  -- endereço para onde foi
    qt_acesso_90  INTEGER,               -- acessos ao picking em 90d (impacto)
    observacao    TEXT                   -- observação do gestor (até 70 chars)
);

CREATE INDEX IF NOT EXISTS idx_realocacao_lote_empresa_cd
    ON smartpick.sp_realocacao_lote (empresa_id, cd_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_realocacao_item_lote
    ON smartpick.sp_realocacao_item (lote_id);

COMMENT ON TABLE smartpick.sp_realocacao_lote IS
    'Lote de realocação gerado no Painel de Realocação (1 por rua/geração de PDF).';
COMMENT ON TABLE smartpick.sp_realocacao_item IS
    'Movimentos do lote: produto que mudou de endereço (origem → destino).';
