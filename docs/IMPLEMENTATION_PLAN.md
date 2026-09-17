# Plano de implementação — Voice Prompt

## Atualização 0.2

Interface compacta e perfis de prompt editáveis implementados. As regras, prioridades e exemplos de gerações reais do Luna estão em [PROMPT_PROFILES.md](PROMPT_PROFILES.md). Código usa inglês assertivo por padrão; o modo Automático classifica na mesma chamada de geração. O restante deste documento registra a arquitetura original.

## Objetivo

Uma aplicação compacta para Windows que transforma fala espontânea em prompts claros, mantendo a transcrição local e usando o GPT-5.6 Luna pelo OpenRouter somente para editar o texto. Conversas agrupam uma intenção e suas revisões; o aplicativo não responde à tarefa ditada.

## Decisões

1. **Tauri 2, React/TypeScript e Rust.** WebView2 oferece uma interface leve; Rust controla os processos, credenciais, persistência e requisições sem expor a chave ao frontend.
2. **Whisper.cpp separado da compilação do app.** Baixar binários Windows x64 oficiais e verificar SHA256 elimina a compilação do motor e dependências de SDK NVIDIA.
3. **CPU primeiro, decisão medida.** Whisper small reconheceu uma amostra de português de 14,8 s em aproximadamente 3,2 s neste computador. O modelo large-v3-turbo Q5 fica disponível para escolher maior precisão, com custo de latência. Não há promessa de precisão baseada em um único exemplo.
4. **Modelo residente.** Carregar antecipadamente, reutilizar entre ditados e recarregar quando o usuário trocar o modelo. Apenas um modelo permanece residente por vez.
5. **API Chat Completions e SSE.** URL e identificador configuráveis; OpenRouter e `openai/gpt-5.6-luna` são os padrões. A interface mostra texto assim que o provedor o entrega.
6. **Prompt proporcional à tarefa.** Intenção, contexto, restrições e formato de entrega só quando justificáveis pelo ditado. Não inventar requisitos, não executar a tarefa e não acrescentar uma persona automaticamente.
7. **Persistência local.** Histórico JSON em AppData, versões concluídas e texto atual editável. Credenciais no Windows Credential Manager e vinculadas à URL normalizada do provedor.

## Pipeline implementado

```mermaid
flowchart LR
  A[Microfone selecionado] --> B[AudioWorklet: PCM]
  B --> C[WAV mono 16 kHz]
  C --> D[Whisper.cpp local / CPU]
  D --> E[Transcrição editável]
  E --> F[OpenRouter: apenas texto]
  F --> G[Prompt por streaming]
  G --> H[Copiar / exportar / versão]
```

Captura limitada a cinco minutos. O processo local usa loopback, porta dinâmica e prefixo aleatório; não é exposto à rede. A requisição externa usa HTTPS, exceto APIs em localhost, e não segue redirecionamentos com credenciais. O áudio não participa do payload do LLM.

## Etapas e critérios

| Etapa             | Entrega                                                                   | Estado                                          |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Pesquisa       | Tauri, Whisper.cpp, OpenRouter, práticas de prompting e modelo solicitado | Concluída                                       |
| 2. Base desktop   | Projeto Tauri/React, layout compacto, atalhos em foco                     | Implementada                                    |
| 3. Voz            | Microfone selecionável, nível, duração, WAV, cancelamento, modelos locais | Implementada; inferência real testada           |
| 4. Editor LLM     | Configuração de URL/modelo, cofre, streaming, tratamento de falhas        | Implementada; testes do parser passaram         |
| 5. Conversas      | Criação, busca, exclusão, versões, revisão, refinamento e exportação      | Implementada                                    |
| 6. Distribuição   | Downloads verificados, licenças, executável e NSIS                        | Concluída: executável e instalador NSIS gerados |
| 7. Aceitação real | Fala do usuário em seu microfone e geração com sua chave OpenRouter       | Depende da experiência do usuário no app        |

## Critérios de aceitação manual

- Selecionar o microfone físico, gravar uma frase em português e receber texto legível, sem serviço externo de reconhecimento.
- Ao finalizar, acompanhar a transcrição e o prompt por streaming; copiar deve preservar o Markdown exibido.
- Com a estruturação automática desligada, finalizar a gravação deve produzir apenas transcrição, sem fazer chamada de LLM.
- Alterar o ditado e refazer deve gerar uma nova versão; ativar o refinamento deve incluir o prompt anterior como contexto.
- Sem chave ou sem rede, preservar a transcrição e permitir tentar novamente.
- Cancelar captura deve liberar o microfone; cancelar transcrição deve interromper o processo de inferência; cancelar geração deve preservar texto parcial.
- Fechar e abrir deve restaurar conversas e preferências; a chave deve continuar no cofre do Windows.
- O instalador deve incluir os recursos locais e funcionar sem Node, Rust, CUDA Toolkit ou Python.

## Testes e limites

O teste de inferência usa fala sintética e não mede diversidade de sotaques ou ambientes ruidosos. A latência observada considera somente transcrição, não rede e geração. O teste de streaming cobre fragmentação UTF-8, keep-alive, resposta vazia, interrupção e término por limite. A disponibilidade pública do identificador do modelo foi conferida no catálogo do OpenRouter; autenticação e saldo específicos dependem da conta do usuário.

O motor local instalado é **CPU**. Não foram implementados DirectML/GPU, transcrição incremental durante a fala, atalho global em outras aplicações, pesquisa web por prompt ou sincronização em nuvem. A pesquisa solicitada foi usada para desenhar o editor e suas instruções, evitando acrescentar latência de busca a cada ditado.

## Evoluções orientadas pelo uso

1. Avaliar um conjunto de ditados reais em português: palavras omitidas, números, nomes próprios e latência p50/p95.
2. Se CPU for insuficiente, prototipar **ONNX Runtime/DirectML** com modelo Whisper compatível, confirmar suporte de operadores e decodificação e comparar no hardware NVIDIA. Só substituir o motor após medir qualidade, latência, memória e tamanho de distribuição. Não adicionar requisito de compilação CUDA.
3. Considerar VAD e transcrição incremental para reduzir a espera após ditados longos.
4. Adicionar atalho global e janela flutuante se o fluxo real exigir uso sem focar o aplicativo.
5. Separar modelos do instalador e oferecer download verificado pela interface para reduzir o tamanho da distribuição.

## Fontes primárias

- [Pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/).
- [Whisper.cpp](https://github.com/ggml-org/whisper.cpp) e [servidor de inferência](https://github.com/ggml-org/whisper.cpp/tree/v1.9.2/examples/server).
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart).
- [OpenAI Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering): clareza de instruções e separação entre instrução e contexto.
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
- [ONNX Runtime GenAI](https://github.com/microsoft/onnxruntime-genai), referência para investigação posterior de GPU.
