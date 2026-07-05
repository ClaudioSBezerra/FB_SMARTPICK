-- Migration 129: view de realocações para o assistente de IA (Text-to-SQL)
--
-- Expõe os movimentos de realocação persistidos (migration 128) no mesmo
-- padrão das demais vw_*_chat: JOINs prontos, empresa_id presente (o runtime
-- injeta o filtro por empresa), uma linha por movimento com os metadados do
-- lote. Permite perguntas como "quantas realocações fizemos este mês?",
-- "quais produtos curva A foram movimentados na rua 12?".

CREATE OR REPLACE VIEW smartpick.vw_realocacoes_chat AS
SELECT
    i.id,
    l.empresa_id,
    l.cd_id,
    cd.nome                    AS cd_nome,
    f.nome                     AS filial_nome,
    l.rua,
    i.codprod,
    i.produto,
    i.classe_venda,
    i.end_origem,
    i.end_destino,
    i.qt_acesso_90,
    COALESCE(i.observacao, '') AS observacao,
    l.id                       AS lote_id,
    l.total_slots,
    l.total_movimentos,
    COALESCE(u.email, '')      AS criado_por_email,
    l.criado_em
  FROM smartpick.sp_realocacao_item i
  JOIN smartpick.sp_realocacao_lote l ON l.id = i.lote_id
  JOIN smartpick.sp_centros_dist   cd ON cd.id = l.cd_id
  LEFT JOIN smartpick.sp_filiais    f ON f.id = cd.filial_id
  LEFT JOIN public.users            u ON u.id = l.criado_por;

COMMENT ON VIEW smartpick.vw_realocacoes_chat IS
  'Movimentos de realocação física (origem → destino) com CD, filial, lote e autor. Para o assistente IA.';
