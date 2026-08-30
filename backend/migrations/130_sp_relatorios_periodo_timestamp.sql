-- 130 — periodo_inicio/periodo_fim de sp_relatorios_semanais viram timestamp
--
-- Eram DATE, truncando a hora do momento exato em que cada resumo era
-- gerado. Como o período agora é dinâmico (continua exatamente de onde o
-- resumo anterior parou — ver calcularInicioPeriodo em resumo_executivo.go),
-- essa truncagem causava um buraco real de várias horas entre o fim de um
-- resumo e o início do próximo: nada gerado nesse intervalo aparecia em
-- nenhum dos dois relatórios.

ALTER TABLE smartpick.sp_relatorios_semanais
    ALTER COLUMN periodo_inicio TYPE TIMESTAMPTZ USING periodo_inicio::timestamptz,
    ALTER COLUMN periodo_fim    TYPE TIMESTAMPTZ USING periodo_fim::timestamptz;

COMMENT ON COLUMN smartpick.sp_relatorios_semanais.periodo_inicio IS 'Início exato do período coberto (timestamp, não só a data) — continua do fim do resumo anterior sem lacunas';
COMMENT ON COLUMN smartpick.sp_relatorios_semanais.periodo_fim    IS 'Fim exato do período coberto (timestamp do momento de geração)';
