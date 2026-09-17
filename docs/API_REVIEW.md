> Version 0.7.0: questions now use a separate topmost window; the main window is permanently topmost and has direct Copy. Interface and built-in system instructions are English, while Portuguese input is preserved. The tool-calling protocol and provider/model below remain unchanged. See the README for current behavior and validation.

# Revisão de APIs e esclarecimentos — 0.6.0

Revisão realizada em 17/09/2026. Escopo: todas as chamadas de inferência em `src-tauri/src/main.rs`, o coletor SSE em `streaming.rs`, o construtor de mensagens em `prompts.rs`, a transcrição local e os testes de integração existentes. O frontend usa IPC; não chama o provedor diretamente. Os downloads de instalação continuam sendo downloads de artefatos, não chamadas de inferência.

## Integração existente preservada

| Item | Implementação e verificação |
| --- | --- |
| Provedor/modelo | OpenRouter, `https://openrouter.ai/api/v1/chat/completions`, `openai/gpt-5.6-luna`. Nenhuma troca de provedor, modelo ou migração para Responses. URL e modelo continuam configuráveis. |
| Autenticação | Chave recuperada do Credential Manager por URL normalizada, `Authorization: Bearer`. Não é enviada ao frontend nem salva no histórico. O cabeçalho opcional de atribuição existente foi preservado. |
| Corpo padrão | `model`, `messages`, `stream: true`. Não havia temperatura, orçamento de tokens ou esforço de raciocínio explícitos; esses parâmetros permanecem ausentes. |
| Resposta padrão | `choices[0].delta.content`, término `stop`/`[DONE]`, comentários SSE e chunks de uso. JSON inválido, resposta vazia, cortes e erros em eventos não viram um prompt concluído. |
| Erros HTTP | Tratamento de chave/acesso, saldo, modelo/endpoint, limite e falhas gerais preservado. Acrescentada orientação para 400/422, sem afirmar que todo erro é incompatibilidade de ferramentas. Corpos de erro e metadados do provedor não são despejados na interface. |
| Assíncrono | `reqwest`, timeout de conexão de 15 s e total de 180 s, redirects desativados, `CancellationToken`. Não há repetição automática de chamadas pagas. |
| Voz local | Whisper.cpp v1.9.2, `POST /<rota>/inference`, multipart `file`, `response_format=json`, `language`, `temperature=0.0`; resposta `text`. Loopback sem proxy, áudio PCM mono/16 kHz, timeout 300 s, máximo 5 min. Não usa API de áudio remota. |

Referências oficiais: [Chat Completions e autenticação](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [streaming, uso e cancelamento](https://openrouter.ai/docs/api_reference/streaming), [erros HTTP e erros dentro de respostas HTTP 200](https://openrouter.ai/docs/api_reference/errors-and-debugging), [código oficial do servidor Whisper na versão instalada](https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/examples/server/server.cpp).

Correções sustentadas pelo código: a prontidão do Whisper agora exige sucesso de `/health`, em vez de aceitar qualquer resposta da página inicial; mensagens de falha de streaming deixam de afirmar que o texto parcial foi salvo, pois o frontend conserva a transcrição e o último resultado concluído. O cancelamento, os limites e as credenciais existentes foram preservados.

## Modo opcional de perguntas

Ative **Configurações → Prompts → Esclarecer dúvidas antes de gerar** e salve. Desativado por padrão, inclusive para configurações antigas. Não altera a gravação de novo prompt nem o refinamento.

O aplicativo usa o padrão de **client tool calling**, com execução humana da ferramenta `ask_clarifying_questions`. Não extrai perguntas de Markdown nem depende de delimitadores textuais. A definição da função usa JSON Schema; o transporte usa `tools`, `tool_choice: auto`, `parallel_tool_calls: false`, resposta `assistant.tool_calls` e retorno `role: tool` com o `tool_call_id` original. A ferramenta permanece presente nos pedidos seguintes. O objeto original de resposta do assistente é preservado, incluindo metadados de raciocínio do provedor quando presentes.

O modelo pode gerar diretamente quando a solicitação está clara. Quando solicita esclarecimentos, a interface apresenta um grupo de perguntas em texto, com resposta livre e alternativas quando úteis. Nenhuma alternativa é escolhida automaticamente. O usuário pode escrever uma alternativa própria ou deixar um campo em branco. **Continuar** envia todas as respostas disponíveis juntas. Só uma resposta final concluída substitui o prompt anterior. Novas rodadas são permitidas quando ainda houver incerteza relevante; perguntas já respondidas ou declaradas indisponíveis não devem ser repetidas.

As instruções específicas do modo são anexadas às regras existentes, sem alterar perfis de idioma/tom. Elas exigem preservar intenção, escopo, restrições e incerteza; o modelo não deve executar a tarefa. A exceção à saída exclusivamente final permite perguntas apenas via ferramenta. O perfil Código continua em inglês e assertivo; as perguntas acompanham o idioma do ditado.

Perguntas pendentes, respostas digitadas, rodadas anteriores, texto original, prompt anterior e uma cópia das configurações usadas são salvos no mesmo histórico local. Isso permite reabrir o aplicativo e continuar, sem misturar um novo prompt ou mudanças posteriores de configuração com a solicitação pendente. Em caso de erro, as respostas continuam editáveis. **Descartar perguntas** encerra essa etapa e preserva o último prompt concluído. Para mudar a configuração durante essa etapa, descarte as perguntas primeiro.

Referências: [client tool calling do OpenRouter](https://openrouter.ai/docs/guides/features/tool-calling), [function calling na documentação oficial OpenAI](https://developers.openai.com/api/docs/guides/function-calling). O protocolo de transporte segue o provedor efetivamente usado, OpenRouter.

## Validação e limites

- Catálogo oficial `/api/v1/models` consultado: o identificador existente anuncia `tools` e `tool_choice`. [Catálogo](https://openrouter.ai/api/v1/models).
- Teste real com a chave já configurada e dados sintéticos: Luna enviou duas perguntas em uma chamada, recebeu os resultados humanos e gerou um plano em inglês preservando Windows, ausência de implementação e restrição de bibliotecas. Nenhuma chave ou ditado real foi registrado no teste.
- 23 testes frontend e 12 testes Rust automatizados: pin ao lado de minimizar, persistência, modo desativado/ativado, texto e alternativas, múltiplas perguntas/rodadas, campos indisponíveis, geração após respostas, falha com recuperação, retomada do histórico, formatos de request/response, erros HTTP 200 no corpo, SSE fragmentado, chunks de uso e resposta incompleta. O teste real é separado e ignorado no comando padrão.
- Prévia visual em 360 × 400 com respostas fictícias; nenhum erro de console observado. O estado nativo de sobreposição/minimização é coberto por comandos simulados e permissões existentes, não por inspeção visual da janela nativa nesta rodada.
- Whisper local: amostra sintética em português transcrita corretamente duas vezes (~2,8 s por inferência). Outra amostra em inglês sintetizada pela voz padrão produziu erros; essas amostras não demonstram precisão geral. O microfone físico não foi utilizado.
- Ferramentas dependem do modelo e do endpoint configurado. Outros provedores compatíveis não foram testados; não há fallback silencioso ou troca automática de modelo. Respostas de ferramenta desconhecida, malformada ou incompleta são recusadas, com opção de tentar novamente.
- O modo opcional usa `stream: false` para receber e validar a chamada de ferramenta completa antes de mostrar perguntas. A interface continua assíncrona e indica processamento. Cancelar interrompe a espera local, mas, conforme a documentação do OpenRouter, chamadas sem streaming podem continuar sendo processadas e cobradas pelo provedor. O fluxo padrão mantém streaming.
- Limites de aplicação: até 8 perguntas por rodada, até 5 alternativas por pergunta, respostas validadas no Rust, 200 KB de histórico de esclarecimentos por requisição. Não é uma promessa de que o modelo sempre formulará as perguntas ideais; a qualidade depende de inferência e das regras editadas pelo usuário.
- As respostas textuais também são enviadas ao provedor; áudio permanece local. O histórico, inclusive esclarecimentos, continua sem criptografia, como antes. A chave permanece separada no cofre.

Teste real opcional: `cargo test --manifest-path src-tauri/Cargo.toml live_clarification -- --ignored --nocapture`. Exige chave local e pode consumir saldo.


## 0.7.2: optional thinking effort

Checked [OpenRouter reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). `thinkingEffort` defaults to `default`, which omits the API parameter. Explicit choices are serialized as `reasoning.effort` for the exact OpenRouter host and `reasoning_effort` for configured OpenAI-compatible endpoints. The same option applies to streaming generation and non-streaming clarification rounds; saved pending rounds retain their request settings. No models or providers were changed. Supported levels vary by model/provider, and unsupported choices retain the existing recoverable API error behavior. No live, billable request was made for this change.
