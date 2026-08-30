-- 131 — Snapshots do painel "Faturamento sem Calibragem" (Farol)
--
-- Mesma forma de sp_relatorios_semanais (117, ajustada por 130): persiste um
-- snapshot do painel para permitir geração de PDF e envio por email (manual
-- ou pelo worker diário), sem recalcular ao vivo a cada exportação.
-- Ver skills/implementation-artifacts/spec-faturamento-pdf-email.md.

CREATE TABLE IF NOT EXISTS smartpick.sp_relatorios_faturamento (
    id              SERIAL      PRIMARY KEY,
    cd_id           INTEGER     NOT NULL REFERENCES smartpick.sp_centros_dist(id) ON DELETE CASCADE,
    periodo_inicio  TIMESTAMPTZ NOT NULL,
    periodo_fim     TIMESTAMPTZ NOT NULL,
    dados_json      JSONB       NOT NULL,
    enviado_em      TIMESTAMPTZ,
    enviado_para    TEXT[],
    erro_envio      TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_por      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sp_relatorios_faturamento_cd_data ON smartpick.sp_relatorios_faturamento(cd_id, criado_em DESC);

COMMENT ON TABLE  smartpick.sp_relatorios_faturamento IS 'Snapshots do painel Faturamento sem Calibragem, usados para PDF e envio por email (manual ou worker diário)';
COMMENT ON COLUMN smartpick.sp_relatorios_faturamento.dados_json  IS 'Snapshot completo da resposta do painel (FaturamentoSemCalibragemResponse) no momento da geração';
COMMENT ON COLUMN smartpick.sp_relatorios_faturamento.criado_em   IS 'Momento em que o snapshot foi gerado — usado pelo worker diário para dedup (não gerar 2x no mesmo dia)';
