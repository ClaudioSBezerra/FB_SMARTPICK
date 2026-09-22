-- 130 — periodo_inicio/periodo_fim de sp_relatorios_semanais viram timestamp
--
-- Eram DATE, truncando a hora do momento exato em que cada resumo era
-- gerado. Como o período agora é dinâmico (continua exatamente de onde o
-- resumo anterior parou — ver calcularInicioPeriodo em resumo_executivo.go),
-- essa truncagem causava um buraco real de várias horas entre o fim de um
-- resumo e o início do próximo: nada gerado nesse intervalo aparecia em
-- nenhum dos dois relatórios.

-- vw_resumo_executivo_chat (migration 119) faz SELECT direto de periodo_inicio/
-- periodo_fim — Postgres bloqueia ALTER COLUMN TYPE em coluna usada por view
-- (0A000: "cannot alter type of a column used by a view or rule"). Dropa antes,
-- recria depois com a definição exata de 119 (só os tipos das duas colunas
-- mudam, o corpo da view é idêntico).
DROP VIEW IF EXISTS smartpick.vw_resumo_executivo_chat;

ALTER TABLE smartpick.sp_relatorios_semanais
    ALTER COLUMN periodo_inicio TYPE TIMESTAMPTZ USING periodo_inicio::timestamptz,
    ALTER COLUMN periodo_fim    TYPE TIMESTAMPTZ USING periodo_fim::timestamptz;

COMMENT ON COLUMN smartpick.sp_relatorios_semanais.periodo_inicio IS 'Início exato do período coberto (timestamp, não só a data) — continua do fim do resumo anterior sem lacunas';
COMMENT ON COLUMN smartpick.sp_relatorios_semanais.periodo_fim    IS 'Fim exato do período coberto (timestamp do momento de geração)';

CREATE OR REPLACE VIEW smartpick.vw_resumo_executivo_chat AS
SELECT
    r.id,
    cd.empresa_id,
    r.cd_id,
    cd.nome              AS cd_nome,
    f.nome               AS filial_nome,
    r.periodo_inicio,
    r.periodo_fim,
    r.criado_em,
    r.enviado_em,
    array_length(r.enviado_para, 1) AS qtd_enviados
  FROM smartpick.sp_relatorios_semanais r
  JOIN smartpick.sp_centros_dist cd ON cd.id = r.cd_id
  LEFT JOIN smartpick.sp_filiais f ON f.id = cd.filial_id;

COMMENT ON VIEW smartpick.vw_resumo_executivo_chat IS
  'Resumos executivos semanais gerados.';
