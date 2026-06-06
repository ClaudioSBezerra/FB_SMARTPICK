-- Migration 127: índices para acelerar o painel de Reincidência
--
-- A reincidência roda subconsultas correlacionadas em sp_propostas filtrando
-- por (cd_id, codprod, rua, predio, apto) e ordenando por created_at do job.
-- Sem índice, cada grupo varre a tabela inteira → painel fica "carregando".
-- O índice em sp_enderecos ajuda o agrupamento por produto/endereço.
-- (sp_enderecos não tem cd_id — o CD vem do join com sp_csv_jobs.)

CREATE INDEX IF NOT EXISTS idx_sp_propostas_reincidencia
    ON smartpick.sp_propostas (cd_id, codprod, rua, predio, apto);

CREATE INDEX IF NOT EXISTS idx_sp_enderecos_reincidencia
    ON smartpick.sp_enderecos (codprod, rua, predio, apto);
