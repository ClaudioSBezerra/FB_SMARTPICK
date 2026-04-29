# Questionário — Diagnóstico Operacional do CD
**Para:** Gerente do Centro de Distribuição  
**Objetivo:** Mapear o modelo de endereçamento, fluxo de picking e reserva, e identificar as oportunidades de otimização com o SmartPick  
**Contexto:** 10.000 itens no CD. O mesmo produto pode ter 1 ou mais endereços (picking + reserva). A solução proposta vai além da calibração do picking — propõe também trazer os endereços de reserva para próximo do ponto de apanho.

---

## Bloco 1 — Estrutura física do CD

**1. Como o CD está fisicamente organizado?**

> Quantas ruas existem no total? As ruas são numeradas sequencialmente? Existe alguma divisão física já reconhecida entre áreas (por exemplo, uma área de produtos de alto giro separada de uma área de baixo giro)? Onde ficam as docas de carregamento em relação às ruas — na frente, no fundo, na lateral?

*Por que perguntamos:* Para mapear as zonas A/B/C/D e calcular corretamente a distância de deslocamento.

**Respostas:**

---

**2. O CD opera com área de picking separada da área de reserva, ou os produtos de reserva ficam nas ruas junto ao picking?**

> Em alguns CDs, existe uma área específica de picking (frentes de rua, nível ergonômico) e o estoque de reserva fica nos níveis altos da mesma rua ou em ruas de armazenagem separadas. Como é no caso de vocês?

*Por que perguntamos:* Define a arquitetura da solução — se a reserva fica na mesma rua do picking, a proposta é diferente de um CD onde a reserva está em outro corredor.

**Respostas:**

---

**3. Qual é a estrutura de um endereço completo no CD?**

> Por exemplo: `Rua 05 / Módulo 03 / Nível 02 / Posição 01`. Quais são os níveis físicos disponíveis por módulo (quantos andares de prateleira)? Qual é a altura de cada nível? Existe diferenciação de capacidade entre posições do mesmo módulo?

*Por que perguntamos:* Para implementar a regra ergonômica (produtos pesados apenas em nível 1/chão) e calcular capacidade por tipo de posição.

**Respostas:**

---

## Bloco 2 — Modelo de endereçamento por produto

**4. Como funciona o endereçamento de um produto que tem mais de um endereço no CD?**

> Quando um produto tem múltiplos endereços, qual é a lógica? Existe sempre um endereço principal de picking (ponto de apanho) e os demais são de reserva? Ou todos os endereços servem para picking? O Winthor define um tipo específico para cada endereço (picking, reserva, blocado)?

*Por que perguntamos:* Para entender se a distinção picking/reserva está estruturada no WMS ou só existe na prática operacional.

**Respostas:**

---

**5. Como funciona o processo de reposição? Quem abastece o ponto de apanho quando ele esvazia?**

> Quando o endereço de picking zera ou atinge o ponto de reposição, quem vai buscar na reserva? É um operador dedicado (repositor)? O picking para enquanto repõe? Tem alguma indicação no sistema (RF, impressora, tela)? Com que frequência isso acontece para produtos de alto giro (Curva A)?

*Por que perguntamos:* O tempo de reposição é um custo oculto que a solução pode atacar. Se a reserva está na rua 40 e o picking está na rua 5, cada reposição gasta muito mais tempo.

**Respostas:**

---

**6. Para um produto típico de alto giro (Curva A), onde fica a reserva hoje? Próxima ao picking ou em qualquer rua disponível?**

> Quando o produto chega do fornecedor, tem regra de onde guardar a reserva? Ou vai para onde tem espaço? O Winthor sugere endereço de guarda ou é o operador que decide?

*Por que perguntamos:* Identificar se a reserva já tem alguma lógica de proximidade ou se é totalmente aleatória. Esse é o principal ponto de ganho da solução proposta.

**Respostas:**

---

## Bloco 3 — Operação de picking

**7. Como é a rotina diária de separação? Pedidos são separados rua por rua (roteiro fixo) ou o operador vai direto ao endereço indicado pelo WMS?**

> O sistema emite um roteiro de separação que leva o operador pela rua mais eficiente, ou cada pedido gera uma lista independente? Existe o conceito de "onda de separação" (vários pedidos separados juntos)? Quantos operadores trabalham em picking simultaneamente no pico?

*Por que perguntamos:* Para dimensionar o impacto real de uma melhoria de 1 metro por pick — multiplicado por N operadores e M picks por dia.

**Respostas:**

---

**8. Quais são os maiores pontos de congestionamento ou reclamação dos operadores hoje?**

> Existem ruas que concentram muito movimento ao mesmo tempo? Produtos que estão sempre longe de onde deveriam estar? Operadores que cruzam o CD inteiro para pegar um item de alto giro?

*Por que perguntamos:* Os "ofensores de distância" que o SmartPick vai identificar automaticamente provavelmente já são conhecidos pelo gestor — a conversa valida o modelo.

**Respostas:**

---

## Bloco 4 — Restrições e regras de negócio

**9. Existem produtos que NÃO podem ser movidos de endereço, ou que têm restrições específicas de posição?**

> Por exemplo: produtos refrigerados (câmara fria), produtos perigosos (área isolada), produtos de alto valor (área com controle de acesso), produtos muito pesados (só no nível do chão), produtos frágeis (nunca no topo), produtos de grande volume (só em posições especiais). Existe algum agrupamento por família de produto que precisa ser mantido?

*Por que perguntamos:* Para configurar as restrições do motor de sugestão e evitar que ele proponha movimentações impossíveis ou perigosas.

**Respostas:**

---

**10. Com que frequência produtos entram e saem do mix ativo do CD? Existe sazonalidade relevante?**

> Vocês têm produtos que só giram em algumas épocas do ano (datas comemorativas, safras)? Existe um processo de "ruptura de linha" (produto sai definitivamente do mix)? Quando um produto novo entra, onde vai parar inicialmente?

*Por que perguntamos:* Para definir a janela de recálculo da curva ABC (90 dias pode distorcer se houver sazonalidade) e para tratar produtos sazonais com override manual.

**Respostas:**

---

## Bloco 5 — Dados e sistemas

**11. Quem gera o CSV que alimenta o SmartPick hoje? Quanto tempo leva para gerar e enviar?**

> É um processo manual (alguém exporta do Winthor na mão) ou existe um relatório/automação que gera na hora? Existe algum campo que vocês gostariam de incluir no export mas que não está hoje?

*Por que perguntamos:* Para mapear se conseguimos adicionar os 4 campos que precisamos (NIVEL, CODENDERECO, TIPO, PESOBRUTO) no mesmo processo de exportação atual.

**Respostas:**

---

**12. O Winthor registra o histórico de movimentações de reserva para reserva (quando um produto é guardado ou transferido entre endereços de armazenagem)?**

> Em `PCMOVIMENTOW`, existem registros de operações de guarda (entrada no endereço de reserva) e de transferência entre endereços? Ou só de saída (picking)? Existe algum outro sistema de controle de movimentação interna?

*Por que perguntamos:* Para saber se conseguimos rastrear o tempo de reposição (reserva → picking) e calcular o custo real do deslocamento atual.

**Respostas:**

---

## Bloco 6 — Execução das movimentações

**13. Quando o SmartPick aprovar uma lista de realocações, como o CD vai executar fisicamente as movimentações?**

> Existe uma equipe de repositores que pode fazer isso em um turno de baixo movimento? O processo precisaria ser feito com o CD parado ou pode ser feito gradualmente (rua por rua)? Quem emite a tarefa no Winthor para mover o produto?

*Por que perguntamos:* Para dimensionar o plano de execução e entender se a lista de prioridades do SmartPick precisa considerar o impacto operacional da movimentação em si.

**Respostas:**

---

**14. Qual seria o número ideal de sugestões de realocação para trabalhar por semana?**

> Se o SmartPick gerar 500 sugestões de movimentação, a equipe consegue executar todas em uma semana? Qual seria uma quantidade realista para começar?

*Por que perguntamos:* Para calibrar o filtro de priorização do motor — em vez de mostrar todas as sugestões de uma vez, mostrar as N de maior impacto que caibam na capacidade operacional da semana.

**Respostas:**

---

## Bloco 7 — Objetivos e expectativas

**15. O que seria uma vitória clara para você nos primeiros 3 meses de uso do módulo?**

> Uma redução no tempo médio de separação? Menos reclamações dos operadores sobre caminhadas longas? Um número específico de SKUs de alto giro realocados para a zona correta? Menos interrupções na separação por reposição urgente?

*Por que perguntamos:* Para definir as métricas de sucesso do piloto e garantir que o que construímos resolve o problema certo para o gestor, não apenas o problema técnico.

**Respostas:**

---

## Observações gerais da reunião

*(Preencher durante/após a conversa)*

---

## Síntese pós-reunião — decisões de arquitetura

| Pergunta | Decisão que ela desbloqueia | Resposta obtida |
|---|---|---|
| 1, 3 | Mapeamento das zonas A/B/C/D e cálculo de distância | |
| 2, 4 | Se o motor trata reserva separado de picking ou em conjunto | |
| 5, 6 | Se o módulo inclui otimização de proximidade reserva→picking | |
| 9, 10 | Quais restrições implementar no motor de sugestão | |
| 11, 12 | Quais campos adicionar ao CSV atual | |
| 13, 14 | Como paginar e priorizar a lista de sugestões | |
| 15 | KPIs do piloto e critério de sucesso do projeto | |

---

*Documento criado em: 22/04/2026*  
*Projeto: SmartPick — Módulo ABC Slotting*  
*Cliente: Grupo Jorge Costa*
