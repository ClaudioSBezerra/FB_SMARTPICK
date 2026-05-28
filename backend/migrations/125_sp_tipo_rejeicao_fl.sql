-- Migration 125: adiciona o motivo de rejeição "FL - Fora de Linha"
--
-- Solicitação do usuário final: além dos 3 motivos da migration 109
-- (Estratégia de alocação, Sazonalidade, Opção do gestor), o gestor
-- precisa poder rejeitar uma proposta de calibragem quando o produto
-- está fora de linha (descontinuado). O endpoint
-- /api/sp/propostas/motivos-rejeicao lê esta tabela dinamicamente,
-- então o novo motivo aparece automaticamente no dropdown da UI.

INSERT INTO smartpick.sp_tipo_rejeicao (codigo, descricao) VALUES
    (4, 'FL - Fora de Linha')
ON CONFLICT (codigo) DO NOTHING;
