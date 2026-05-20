-- Migration 123: TIPO_REL (CALIBRACAO | REALOCACAO)
--
-- O WMS passou a exportar a mesma linha de produto duas vezes: uma para o
-- processo de CALIBRAÇÃO e outra para REALOCAÇÃO. Os dados são idênticos
-- EXCETO a CURVA ABC (classe_venda), que é calculada de forma diferente
-- em cada processo.
--
-- Para rotear cada conjunto ao painel correto, persistimos o TIPO_REL
-- normalizado (maiúsculas, sem acento) tanto na importação (sp_enderecos)
-- quanto na proposta gerada pelo motor (sp_propostas).
--
-- Valores canônicos: 'CALIBRACAO' | 'REALOCACAO'. NULL = origem desconhecida
-- (CSV em formato antigo) — não casa com nenhum filtro de painel.

ALTER TABLE smartpick.sp_enderecos
    ADD COLUMN IF NOT EXISTS tipo_rel TEXT;

ALTER TABLE smartpick.sp_propostas
    ADD COLUMN IF NOT EXISTS tipo_rel TEXT;

-- Índices p/ filtragem por painel
CREATE INDEX IF NOT EXISTS idx_sp_enderecos_tipo_rel
    ON smartpick.sp_enderecos (job_id, tipo_rel);

CREATE INDEX IF NOT EXISTS idx_sp_propostas_tipo_rel
    ON smartpick.sp_propostas (cd_id, tipo_rel, status);

COMMENT ON COLUMN smartpick.sp_enderecos.tipo_rel IS
    'Processo de origem: CALIBRACAO ou REALOCACAO (normalizado upper/sem acento). Mesma linha de produto vem 2x, diferindo só na classe_venda.';
COMMENT ON COLUMN smartpick.sp_propostas.tipo_rel IS
    'Processo de origem herdado de sp_enderecos: CALIBRACAO → painel de Calibragem; REALOCACAO → painel de Realocação.';
