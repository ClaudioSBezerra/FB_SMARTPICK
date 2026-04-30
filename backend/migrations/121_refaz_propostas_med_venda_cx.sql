-- Migration 121: refaz propostas usando MED_VENDA_DIAS_CX como fonte primária de giro
--
-- A partir desta migration, o motor passa a usar MED_VENDA_DIAS_CX (med_venda_cx)
-- como fonte primária do giro diário, substituindo QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS.
--
-- Nova ordem de prioridade:
--   1. MED_VENDA_DIAS_CX × QTUNITCX  (primário — solicitado pelo responsável do depósito)
--   2. QTACESSO_PICKING_PERIODO_90 ÷ QT_DIAS
--   3. MED_VENDA_DIAS
--   4. MED_VENDA_CX_ANOANT_MESSEG × QTUNITCX
--
-- Esta migration apaga as propostas pendentes e calibradas para que o motor
-- possa ser re-executado com a nova fórmula. Propostas já aprovadas ou
-- rejeitadas são preservadas (histórico de decisões do gestor).

DELETE FROM smartpick.sp_propostas
WHERE status IN ('pendente', 'calibrado');
