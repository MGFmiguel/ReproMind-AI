# ReproMind AI

Aplicação local para registrar ocorrências técnicas, conduzir uma coleta inicial de informações e organizar hipóteses e testes para validação.

## Requisitos

- Node.js compatível com as dependências do projeto
- npm

## Instalação e execução

```bash
npm install
npm run dev
```

Abra `http://127.0.0.1:3000`. O banco SQLite é criado em `database/database.db` na primeira inicialização. Esse arquivo local não é versionado.

Para usar a análise real, configure `OPENAI_API_KEY` no arquivo `.env`. `OPENAI_MODEL` é opcional. Sem chave, o sistema usa a análise simulada. Falhas temporárias de rede, limite de uso e erros de servidor também usam o modo simulado; erros de configuração são exibidos.

## Acesso de usuários

Não há cadastro público. Em uma base sem usuários, a inicialização cria a conta inicial `admin` com senha temporária `admin`; a troca da senha é obrigatória no primeiro acesso. O administrador cadastra os membros autorizados pela página **Usuários**, usando uma senha temporária de pelo menos 6 caracteres, que o membro deverá trocar ao entrar. O administrador também pode desativar contas. Os usuários autenticados compartilham as ocorrências da equipe.

As senhas são armazenadas com hash scrypt e salt individual. As sessões ficam no SQLite e expiram após oito horas. A conta inicial com credenciais conhecidas é adequada apenas para a primeira configuração local; troque-a imediatamente e não exponha o sistema à rede enquanto a senha padrão estiver ativa.

As variáveis `PORT`, `HOST` e `DATABASE_PATH` podem configurar a porta, o endereço de escuta e o arquivo SQLite. O padrão do host é `127.0.0.1`. Para acessar de outros dispositivos, configure `HOST=0.0.0.0`, troque a senha inicial e coloque o servidor atrás de HTTPS.

## Recuperação da conta administrativa

Se a senha da conta administrativa for perdida, execute este procedimento localmente, a partir da pasta do projeto. Pare o servidor antes de iniciar a recuperação para evitar operações simultâneas no SQLite:

```bash
npm run recuperar-admin
```

O comando carrega o `.env` do projeto e usa o `DATABASE_PATH` configurado; sem essa variável, usa o banco padrão da aplicação. Ele lista apenas contas `admin` ativas, solicita o nome da conta e pede uma nova senha temporária duas vezes, sem exibi-la no terminal. A senha não deve ser informada como argumento.

A senha temporária precisa ter de 6 a 128 caracteres. A recuperação atualiza somente a senha da conta administrativa selecionada, exige a troca no próximo login e revoga somente as sessões dessa conta. Usuários, papéis, contas desativadas e sessões dos demais usuários não são alterados. O comando não cria usuários, não reativa contas e não oferece recuperação por uma rota web.

Depois da recuperação, inicie o servidor normalmente e entre com a senha temporária. O sistema solicitará a troca por uma senha permanente.

## Controle de uso da IA

Use o arquivo .env.example para configurar cotas e concorrência. Os padrões são 10 análises reais por usuário por hora, 30 por usuário em 24 horas, 100 globalmente em 24 horas, uma reserva simultânea por usuário, duas globalmente e reserva renovada durante chamadas demoradas.

A rota de análise reserva uso somente quando a chave da OpenAI está configurada. O uso real registra usuário autenticado, ocorrência, fingerprint dos dados enviados, modelo, tokens disponíveis e status. O fingerprint inclui ocorrência, respostas, modelo e versão do contexto do prompt; alterações nesses dados permitem uma nova análise.

Sem chave, ao atingir cota ou concorrência, a aplicação salva uma análise simulada sem registrar uso real. Uma análise idêntica já em andamento retorna HTTP 409 e não inicia outra chamada. Falhas após o início da chamada são registradas como falha; a reserva só é cancelada quando o provedor ainda não foi chamado. Respostas recebidas são contabilizadas mesmo se o conteúdo inválido resultar em relatório simulado.

## Testes

```bash
npm test
```
