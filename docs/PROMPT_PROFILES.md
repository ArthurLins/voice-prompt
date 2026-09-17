> Atualização 0.5: não existe seletor de novo/refinar. O botão grande inicia a gravação de um novo prompt; o botão menor com lápis grava um refinamento do prompt atual. A operação continua determinada pelo aplicativo. Prompt e Configurações usam janelas independentes. Referências às telas anteriores abaixo são históricas; consulte o README para o fluxo atual.

# Prompts e interface — versão 0.2.0

A janela padrão passou de 1080 × 780 para **560 × 600**, com mínimo de **420 × 440**. A tela principal contém seletor de tipo, abas Entrada/Prompt e ações Gravar, Gerar prompt e Copiar. Histórico, áudio e conexão ficam acessíveis pelos botões no topo, sem painel lateral permanente, slogans ou cartões de dashboard.

## Tipos por finalidade

| Tipo         | Finalidade                                                                 | Idioma padrão     | Tom padrão |
| ------------ | -------------------------------------------------------------------------- | ----------------- | ---------- |
| Código       | Implementação, correção, refatoração, testes, revisão e planos de software | Inglês            | Assertivo  |
| Escrita      | E-mails, mensagens, documentos e revisão de texto                          | Conforme o pedido | Assertivo  |
| Pesquisa     | Investigação, comparações e análise de evidências                          | Conforme o pedido | Assertivo  |
| Planejamento | Projetos, rotinas e planos de ação fora de software                        | Conforme o pedido | Assertivo  |
| Geral        | Demais solicitações                                                        | Conforme o pedido | Assertivo  |

**Automático** determina a finalidade antes de redigir, na mesma chamada ao Luna. O modelo recebe o catálogo de perfis e usa o ditado e, no refinamento, o prompt anterior. Uma solicitação de e-mail sobre um pull request é Escrita; mencionar software não basta para classificar como Código. A classificação não aparece no prompt copiado.

Selecionar um tipo explicitamente envia somente esse perfil ao modelo, dispensando classificação. A seleção fica salva para as próximas gerações.

## Editar os comportamentos

Em **Configurações → Prompts**:

1. Escolha um tipo em **Editar tipo**.
2. Altere nome, finalidade, idioma, tom e instruções.
3. Para criar uma finalidade própria, clique em **+ Tipo** e preencha os campos.
4. Abra **Instruções gerais** para editar as regras compartilhadas por todos os tipos.
5. Clique em **Salvar**. Cancelar ou fechar descarta as alterações desse formulário.

**Restaurar este tipo** recupera apenas o perfil selecionado. **Restaurar gerais** recupera apenas as instruções compartilhadas. Os perfis personalizados podem ser removidos no formulário; a remoção só persiste ao salvar. O limite é de 16 tipos.

Idioma e tom selecionados prevalecem sobre instruções livres conflitantes. O perfil específico prevalece sobre as instruções gerais. Isso permite, por exemplo, mudar o idioma do tipo Código sem editar todas as frases das suas instruções. O contrato fixo do aplicativo continua sendo gerar um prompt, sem executar a tarefa ou acrescentar comentários externos.

Os padrões são compartilhados por React e Rust em `src/prompt-defaults.json`. As escolhas e edições ficam no `workspace.json` junto das preferências existentes. A migração acrescenta os padrões aos históricos antigos, sem substituir transcrições, conversas ou credenciais. As instruções alteradas chegam à mensagem de sistema; o ditado e o prompt anterior ficam na mensagem de usuário como dados separados.

## Código em inglês

O perfil padrão pede verbos diretos, como **Implement**, **Fix**, **Refactor**, **Review** e **Test**. Evita sugestões vagas, preserva incertezas factuais e mantém o escopo: um pedido de planejamento continua sendo um pedido de planejamento. Código, nomes, caminhos, URLs e textos literais de interface devem ser preservados, mesmo quando estiverem em português.

## Validação realizada

- 6 testes TypeScript e 8 testes Rust: migração, preservação de configurações editadas, validação, separação entre instruções e ditado, seleção do perfil e os testes anteriores de áudio/streaming.
- Interface inspecionada em 560 × 600 e 420 × 440, com todos os controles principais visíveis.
- Edição, salvamento, recarregamento e restauração de um perfil verificados pela interface.
- Três gerações reais com `openai/gpt-5.6-luna` pelo OpenRouter, usando a chave já salva no aplicativo. A chave não foi exibida nem alterada.

| Modo       | Entrada de teste                                                                         | Saída observada                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Código     | Crie um formulário de cadastro com botão 'Salvar', sem adicionar bibliotecas.            | Implement a registration form with a “Salvar” button without adding libraries.                     |
| Automático | Corrija o erro no login e preserve os textos em português da interface.                  | Fix the login error. Preserve all Portuguese UI text exactly.                                      |
| Automático | Escreva um e-mail curto em português pedindo ao time uma revisão do pull request amanhã. | Redija um e-mail curto, em português, para o time, solicitando uma revisão do pull request amanhã. |

Esses casos verificam os comportamentos pedidos, mas não garantem que a classificação automática acerte todas as solicitações ambíguas. Nesses casos, o seletor manual determina o perfil.

O teste real é opt-in, pois usa créditos do provedor:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml live_prompt_profiles -- --ignored --nocapture
```

Sem chave salva, esse teste informa explicitamente que a avaliação real foi pulada. Os testes comuns não fazem chamadas externas.

## Referência

A separação entre instruções, contexto e dados segue o [guia oficial de prompt engineering da OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering). O modelo continua sendo [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna); não houve substituição de modelo.
