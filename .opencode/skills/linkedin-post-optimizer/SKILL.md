---
name: linkedin-post-optimizer
description: Cria e otimiza posts para LinkedIn (nicho Tech/TI, tom profissional e direto) levando em conta como o algoritmo do LinkedIn realmente distribui conteúdo — filtro de spam, classificação inicial, grupo de teste, monitoramento de engajamento, pontuação de qualidade e gatilhos de viralidade. Use esta skill sempre que o usuário pedir para "escrever um post", "criar conteúdo pro LinkedIn", "melhorar/revisar um post", "aumentar alcance no LinkedIn" ou mencionar o algoritmo do LinkedIn, mesmo que não peça explicitamente por "otimização".
---

# LinkedIn Post Optimizer (Tech/TI)

Skill para redigir posts de LinkedIn escritos para performar bem dentro da lógica real do algoritmo da plataforma, mantendo tom **profissional e direto**, voltado a audiência de **Tech/TI**.

## Como o algoritmo do LinkedIn funciona (modelo mental usado nesta skill)

1. **Classificação inicial**: todo post é classificado como Spam / Baixa Qualidade / Alta Qualidade antes de ser distribuído.
2. **Grupo de teste**: se não é spam, o post é mostrado primeiro a uma fração pequena da rede de conexões de 1º grau.
3. **Monitoramento de engajamento**: o LinkedIn observa como esse grupo reage nos primeiros 60–90 minutos.
4. **Pontuação de qualidade**: uma IA avalia se o engajamento é de qualidade (comentários substantivos, compartilhamentos, tempo de leitura) ou raso (só likes rápidos).
5. **Gatilhos de viralidade**: engajamento constante + palavras-chave relevantes → post ganha mais alcance e é reexposto a públicos mais amplos.
6. **Decaimento com o tempo**: sem sinais de qualidade sustentados, o alcance cai rapidamente (post "morre").

## Implicações práticas para escrever o post

Ao gerar ou revisar um post, aplicar estas regras:

**Evitar sinais de spam/baixa qualidade:**
- Sem links externos na primeira linha (cortam o alcance); se precisar linkar, colocar no primeiro comentário e mencionar isso no texto.
- Sem hashtags em excesso (máx. 3, relevantes ao nicho tech).
- Sem "engagement bait" óbvio ("comenta SIM", "marca 5 pessoas").
- Sem excesso de emojis ou texto todo em caps.

**Maximizar o "grupo de teste" e engajamento inicial:**
- Primeira linha (hook) precisa parar o scroll em 1-2 segundos: dado surpreendente, pergunta direta, afirmação contra-intuitiva ou erro comum do nicho tech.
- Quebrar em parágrafos curtos (1-3 linhas), com espaço em branco — favorece tempo de leitura.
- Terminar com uma pergunta genuína ou convite a opinião técnica, que gere comentários (não só curtidas) — comentário pesa mais que like na pontuação de qualidade.

**Gatilhos de viralidade (tech/TI):**
- Usar 1-2 termos técnicos específicos e atuais do nicho (ex: nome de ferramenta, framework, prática) — sinalizam relevância de assunto.
- Estruturar como insight prático, lição aprendida ou contraste ("a maioria faz X, eu faço Y e o resultado foi Z") — gera mais comentários que anúncios genéricos.
- Evitar textão sem quebra; usar bullet/numeração quando fizer sentido para "escaneabilidade".

**Tom profissional e direto:**
- Frases curtas, sem enrolação, sem jargão de "guru de LinkedIn".
- Primeira pessoa, afirmações concretas, dados/exemplos reais quando possível — nada de clichê vazio tipo "a jornada é mais importante que o destino".
- Fechar com clareza (pergunta ou chamada objetiva), não com frase motivacional genérica.

## Idioma

Por padrão, escrever **sempre em inglês**, independentemente do idioma usado pelo usuário na conversa. Só escrever em outro idioma se o usuário pedir explicitamente naquela mensagem (ex: "escreve esse em português"). Nesse caso, usar apenas para aquele post; o padrão continua sendo inglês nos próximos pedidos, a menos que o usuário diga o contrário.

## Workflow

1. Perguntar (se ainda não souber): tema do post, objetivo (autoridade, vaga, produto, rede), e se há algum dado/caso real para usar como gancho.
2. Escrever o post seguindo as regras acima. Entregar **direto no chat** (é conteúdo curto, não precisa de arquivo/artifact).
3. Depois do rascunho, mostrar rapidamente 2-3 pontos do "porquê" de decisões-chave (ex: "comecei sem link pra não ativar filtro de spam", "terminei com pergunta técnica pra puxar comentário, não só like") — isso ajuda o usuário a aprender o padrão, não só receber o texto.
4. Se o usuário pedir para revisar um post existente em vez de criar um novo, apontar especificamente quais elementos do texto atual provavelmente prejudicam o alcance (à luz do modelo acima) antes de reescrever.

## Formato de saída

- Responder em texto normal no chat, não em artifact/arquivo (post de LinkedIn é conteúdo curto e conversacional).
- Sempre entregar o post pronto para copiar e colar, seguido de uma linha "Por que funciona:" com os pontos-chave.
