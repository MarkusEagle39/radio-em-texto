# Rádio em Texto — Campinas

Piloto de acessibilidade para acompanhar uma rádio pela leitura de legendas em português.

## Executar

Requer Node.js 20 ou superior. Não há dependências de instalação ou chave de API.

```sh
git clone https://github.com/MarkusEagle39/radio-em-texto.git
cd radio-em-texto
npm run dev
```

Abra a URL local mostrada no terminal. Para publicar, sirva a pasta `dist` por HTTPS. O reconhecimento só inicia ao clicar em **Iniciar legendas**.

## O que funciona

- CBN Campinas, Bandeirantes Campinas, Jovem Pan News Campinas e Difusora Jundiaí: áudio direto dos players oficiais, processado com Web Audio e AudioWorklet.
- Transcrição local em um Web Worker com Transformers.js 3.8.1, Whisper multilíngue ONNX, português e tarefa `transcribe`.
- Modelo `base` por padrão, opção `tiny` para dispositivos mais lentos e `small` em Precisão ampliada, recomendada para computador. O primeiro uso baixa aproximadamente 60–110 MB nas opções leves ou cerca de 280 MB em Precisão ampliada. Os modelos podem ser reaproveitados pelo cache do navegador.
- Som desligado por padrão sem interromper a captura para reconhecimento.
- Legendas em janelas de 6 segundos nos modos base/tiny e 10 segundos no small, com 1 segundo de sobreposição e conciliação apenas entre resultados consecutivos.
- Ajuste de fonte, alto contraste, rolagem pausável, tela cheia quando suportada e exportação TXT.
- Demonstração separada com textos explicitamente fictícios.
- Histórico limitado aos últimos 180 trechos, apenas em memória durante a sessão. As preferências de fonte e contraste ficam no armazenamento local.

## Limites do piloto

O reconhecimento é experimental: nomes, números, vozes sobrepostas, músicas e cortes entre janelas podem ser transcritos incorretamente. Não há revisão humana. O atraso depende do aparelho e da rede; a tela informa o atraso de cada bloco. Se o dispositivo não acompanha, a fila é limitada e a lacuna é explicitamente indicada.

O decodificador preserva repetições literais: não aplica penalidade genérica de repetição nem proíbe sequências de três palavras repetidas. Um filtro separado identifica sequências obviamente repetitivas. Nesses casos, a interface mostra “Trecho não reconhecido com clareza”. Esse filtro não mede confiança e não detecta todos os erros.

O áudio não é enviado para uma API de transcrição: a rádio fornece o fluxo e os modelos são baixados do Hugging Face/CDN. É necessário manter a página aberta. Abas em segundo plano e dispositivos móveis podem suspender o processamento. Firefox/Chrome/Edge/Safari atuais precisam de verificação em cada aparelho; apenas os navegadores efetivamente testados devem ser descritos como validados.

As emissoras incluem programação local e de rede, esportes, publicidade e, em alguns casos, música. Não são todas jornalísticas durante 24 horas. Expansão para outras emissoras depende de acesso técnico e das condições de uso de cada fonte.

## Fontes técnicas e integração

- [Página oficial da CBN Campinas](https://cbncampinas.com.br/ouca-ao-vivo/)
- [Configuração pública do player](https://player.brasilstream.com.br/1176847539/js.js)
- Fluxo referenciado pelo player: `https://8214.brasilstream.com.br/stream` (AAC, CORS verificado em 18/11/2026).
- [Bandeirantes Campinas](https://radiobandeirantescampinas.com.br/): o player público consulta `/api/stream-config.php` com `X-Requested-With: XMLHttpRequest`; em 18/11/2026, a configuração apontou para `https://stm23.xcast.com.br:11284/stream`, com CORS habilitado. Frequência 85,7 FM consta nos metadados oficiais.
- [Jovem Pan News Campinas](https://jovempannewscampinas.com.br/): o elemento de áudio oficial referencia `https://stm11.srvstm.com:6808/stream`, com CORS habilitado. O site identifica a frequência 100,3 FM.
- [Difusora Jundiaí](https://radiodifusorajundiai.com.br/): a configuração pública do player referencia `https://shout35.crossradio.com.br:18112/1.mp3`, com CORS habilitado. Apesar da extensão `.mp3`, o servidor informou AAC. Não foi atribuída frequência FM à emissora.
- Rádio Brasil Campinas foi pesquisada: o player oficial usa `https://centova2.svdns.com.br:20030/stream`. O GET retornou áudio, mas sem cabeçalho CORS no teste de 18/11/2026; por isso, não foi incluída no reconhecimento direto no navegador. HEAD retornou 400, portanto HEAD sozinho não serve como teste de disponibilidade dessa fonte.
- [Transformers.js](https://huggingface.co/docs/transformers.js/v3.8.1/en/index)
- [Whisper base ONNX](https://huggingface.co/onnx-community/whisper-base)
- [Whisper tiny ONNX](https://huggingface.co/onnx-community/whisper-tiny)
- [Whisper original e licença MIT](https://github.com/openai/whisper)

## Verificar

```sh
npm test
npm run check
```

Os testes verificam tratamento de áudio e regressões de sessão. Eles não medem a precisão linguística. Para avaliar essa precisão, é necessário comparar gravações de teste com transcrições humanas de referência.

Interface e desenvolvimento: Marcos Arruda, com apoio do Codex.

## Precisão ampliada

A opção utiliza o Whisper small multilíngue quantizado, com a mesma tarefa de transcrição em português e janelas de 10 segundos, enquanto os modos mais leves usam 6 segundos. O modelo maior pode aumentar bastante o atraso; a opção Equilibrado permanece padrão. A fila continua limitada e informa lacunas se o aparelho não acompanhar. Não há substituições automáticas por dicionário de cidades, nomes ou números.

Os testes iniciais usam áudios sintéticos com texto previamente definido. Eles permitem comparar os mesmos sinais de áudio entre configurações, mas não estabelecem precisão em rádio real. A próxima validação deve incluir trechos reais com referência humana independente.

## Menor espera

TextStreamer publica palavras provisórias durante a decodificação, antes do resultado final. As palavras aparecem diretamente sem o rótulo de prévia. O texto em reconhecimento só entra na exportação/histórico ao concluir o trecho e é descartado ao parar/trocar de sessão. Os modos base/tiny iniciam após 6 s de captura e avançam 5 s por janela; small mantém 10/9 s para não multiplicar seu custo de inferência. O atraso mostrado é medido a partir do início do bloco de áudio recebido pelo site, sem incluir o atraso anterior do streaming da emissora. A prévia não garante correção e o menor contexto pode alterar o reconhecimento.

## Modo de leitura

O botão Modo de leitura expande o painel para a área disponível e destaca somente o trecho atual, inclusive as palavras recebidas durante o reconhecimento. Os controles de fonte e contraste permanecem disponíveis. Histórico exibe os trechos guardados e pausa a rolagem, mantendo áudio e transcrição ativos; Legenda atual retoma o acompanhamento. Sair do modo de leitura (ou Escape) volta à página e restaura a preferência anterior de rolagem. O modo reutiliza a mesma sessão e não solicita outro download do modelo.

## Áudios sintéticos da avaliação

Os arquivos de áudio não são incluídos neste repositório. No macOS, com a voz Luciana em português brasileiro disponível, execute `node scripts/generate-precision-fixtures.mjs` para gerar os três WAVs de teste localmente, sem reprodução sonora. Em outros sistemas, é possível fornecer WAVs mono de 16 kHz com os textos documentados em `tests/precision/results.md`. A avaliação manual usa esses áudios; `npm test` não depende deles.
