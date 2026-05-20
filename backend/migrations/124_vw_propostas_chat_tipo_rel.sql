-- Migration 124: vw_propostas_chat passa a filtrar TIPO_REL = CALIBRACAO
--
-- Desde a migration 123 cada produto vira 2 propostas (CALIBRACAO e
-- REALOCACAO), diferindo só na curva ABC. A view do assistente de IA
-- (vw_propostas_chat) somava as duas → dobrava contagens nas respostas.
--
-- Alinhado às demais saídas calibração-facing (resumo executivo, histórico,
-- reincidência, resultados, PDF), a view passa a expor apenas o processo
-- de CALIBRACAO. Apenas o WHERE muda — colunas permanecem iguais, então
-- CREATE OR REPLACE atualiza a view sem recriar.

CREATE OR REPLACE VIEW smartpick.vw_propostas_chat AS
SELECT
    p.id,
    p.empresa_id,
    p.cd_id,
    cd.nome              AS cd_nome,
    p.cod_filial,
    f.nome               AS filial_nome,
    p.codprod,
    p.produto,
    e.departamento,
    e.secao,
    p.classe_venda,
    p.capacidade_atual,
    p.sugestao_calibragem,
    p.delta,
    p.status,
    p.justificativa,
    e.qt_giro_dia        AS giro_dia_cx,
    e.med_venda_cx,
    e.ponto_reposicao,
    e.participacao,
    p.created_at,
    p.aprovado_em,
    p.aprovado_por
  FROM smartpick.sp_propostas p
  JOIN smartpick.sp_centros_dist cd ON cd.id = p.cd_id
  JOIN smartpick.sp_filiais     f  ON f.id = cd.filial_id
  LEFT JOIN smartpick.sp_enderecos e ON e.id = p.endereco_id
  WHERE p.tipo_rel = 'CALIBRACAO';

COMMENT ON VIEW smartpick.vw_propostas_chat IS
  'Propostas de CALIBRAÇÃO (tipo_rel=CALIBRACAO) com nome do CD, filial, depto e seção. Para o assistente IA. Realocação não entra aqui.';
