# Avaliação inicial — 18/11/2026

Áudios sintéticos gerados com a voz local Luciana (pt-BR), sem reprodução sonora. Referências definidas antes da transcrição. Execução no navegador do Codex, Transformers.js 3.8.1, WASM q8, português, tarefa transcribe. Os tempos incluem inferência, não download. A comparação não mede precisão em rádio real, não é uma amostra representativa e não estabelece uma taxa geral de acerto.

## Campinas, Valinhos e Jundiaí

Referência: “Eu moro em Campinas. O ônibus para Valinhos sai às oito e trinta. A passagem custa cinco reais. Maria trabalha em Jundiaí.”

| Configuração | Transcrição obtida | Tempo |
|---|---|---|
| base, anterior | Eu moro e cantinas, o ônibus para Valinho saia às 8.30, a passagem custa R$ 5, Maria trabalha e junge aí | 4,15 s |
| small, anterior | Eu moro em Campinas, o ônibus para Valinho saia às 8h30. A passagem custa R$ 5. Maria trabalha e Jundiaí | 13,73 s |
| base, sem penalidade de repetição | Eu moro e cantinas, o ônibus para Valinho saia às 8.30, a passagem custa R$ 5, Maria trabalha e junge aí. | 3,50 s |
| small, sem penalidade de repetição | Eu moro em Campinas, o ônibus para Valinho saia às 8h30, a passagem custa R$ 5, Maria trabalha e Jundiaí. | 12,34 s |

O modelo small reconheceu Campinas e Jundiaí corretamente neste caso. Valinhos e outras palavras continuaram incorretas. A retirada da penalidade não demonstrou melhora neste trecho. Números foram formatados de maneiras diferentes; isso não deve ser confundido com erro de conteúdo.

## Cidades da região (configuração anterior)

Referência: “Em Hortolândia, Sumaré e Paulínia, a vacinação começa na segunda-feira. Ana Paula atende em Indaiatuba.”

- base: “E o Ortolandia, Sumarei Paulinia, a vacinação ou começa na segunda feira, Ana Paula atende ainda e à tuba.” — 2,94 s.
- small: “E Ortolândia, Sumaré e Paulínia. A vacinação começa na segunda-feira. Ana Paula atende e ainda Atuba” — 12,66 s.

Sumaré e Paulínia melhoraram no modelo maior, mas Hortolândia e Indaiatuba continuaram incorretas. O custo de processamento do small foi maior.

## Reprodução

Os WAVs usados nesta avaliação são sintéticos e não são distribuídos no repositório. No macOS, execute `node scripts/generate-precision-fixtures.mjs` para criá-los nesta pasta. Em outros sistemas, gere WAVs mono de 16 kHz com as referências acima e os nomes `_precision-test.wav`, `_precision-regiao.wav` e `_precision-esportes.wav`. Para executar o comparador de desenvolvimento, sirva a raiz do repositório em HTTP local e abra `tests/precision/runner.html`. Use `?case=regiao` ou `?case=esportes` para outros casos. O teste baixa os modelos no navegador. O comparador não integra o site publicado.

Próxima validação: amostras independentes de rádio real com transcrição humana de referência, incluindo nomes, números, silêncio, música e falas sobrepostas. Nenhuma avaliação humana independente foi realizada nesta etapa.

## Times e números (sem penalidade de repetição)

Referência: “O Guarani enfrenta a Ponte Preta em Campinas. O ingresso custa vinte reais. A partida começa às quinze horas.”

- base: “Agora nem enfrenta a ponti preta e campinas, o ingresso custa 20 reais, a partir da começa às 15 horas.” — 3,16 s.
- small: “O Guarani enfrenta a ponte preta e campinas. O ingresso custa R$ 20,00, a partir da começa às 15 horas.” — 12,21 s.

Guarani e Ponte Preta melhoraram no modelo maior. Ambos mantiveram os valores vinte e quinze, com diferenças de formatação. Ambos trocaram “a partida” por “a partir da”.
