# ReproMind AI

Aplicação web para apoiar equipes de tecnologia na investigação de bugs e ocorrências técnicas. O ReproMind AI organiza relatos, respostas, hipóteses, evidências e testes recomendados em um fluxo de investigação.

> As hipóteses produzidas pela IA são sugestões. Uma causa só deve ser considerada confirmada depois de validada com testes e evidências.

## Funcionalidades

- Cadastro, edição e acompanhamento de ocorrências técnicas.
- Priorização automática com base nos critérios da ocorrência.
- Coleta adaptativa de informações para completar o relato.
- Análise com OpenAI API ou modo simulado.
- Geração de hipóteses, organização de evidências e recomendação de testes.
- Priorização dos testes recomendados.
- Busca de ocorrências semelhantes.
- Histórico, timeline e comparação de análises.
- Relatórios para consulta e impressão.
- Login por nome de usuário e senha, com sessões armazenadas no SQLite.
- Gerenciamento de usuários autorizado pelo administrador, sem cadastro público.
- Limites de uso real da IA por usuário e globais, controle de concorrência e prevenção de análises duplicadas simultâneas.

## Tecnologias

- Node.js
- Express
- JavaScript
- HTML e CSS
- SQLite com better-sqlite3
- OpenAI API
- Nodemon para desenvolvimento

## Estrutura do projeto

~~~text
.
├── database/       # Banco SQLite e inicialização do esquema
├── middleware/     # Autenticação, autorização e proteção CSRF
├── public/         # Páginas, estilos e scripts do frontend
├── routes/         # Rotas da aplicação e APIs
├── scripts/        # Comandos locais de administração
├── services/       # Autenticação, análise, regras e controle de uso da IA
├── test/           # Testes automatizados
├── server.js       # Inicialização do servidor Express
├── package.json
└── .env.example    # Modelo das variáveis de ambiente
~~~

## Requisitos

- Node.js e npm instalados.
- Uma chave da OpenAI é opcional. Sem ela, o sistema utiliza o modo simulado.

## Instalação

Clone o repositório pelo GitHub e abra a pasta do projeto no terminal. Depois instale as dependências:

~~~bash
npm install
~~~

Crie o arquivo local de configuração copiando o modelo:

~~~bash
# Linux ou macOS
cp .env.example .env
~~~

~~~powershell
# Windows PowerShell
Copy-Item .env.example .env
~~~

Para usar a análise real, adicione sua chave da OpenAI em OPENAI_API_KEY no arquivo .env. Não publique esse arquivo nem coloque a chave no código-fonte. Sem uma chave, o sistema continua funcionando em modo simulado.

Inicie o servidor em desenvolvimento:

~~~bash
npm run dev
~~~

A aplicação ficará disponível em http://127.0.0.1:3000. Para iniciar sem Nodemon, use:

~~~bash
npm start
~~~

O banco SQLite é criado automaticamente no primeiro início, por padrão em database/database.db. O arquivo local do banco e o arquivo .env estão no .gitignore.

## Primeiro acesso e usuários

Não existe cadastro público. Em uma instalação com banco sem usuários, o sistema cria a conta inicial:

- Usuário: admin
- Senha temporária: admin

A troca da senha é obrigatória no primeiro acesso. Altere essa senha imediatamente. Depois, o administrador pode criar, desativar e redefinir as senhas temporárias dos membros pela área de usuários. As senhas temporárias precisam ter de 6 a 128 caracteres e devem ser trocadas no primeiro login.

As senhas são armazenadas com scrypt e salt individual. As sessões ficam no SQLite e expiram após oito horas. Os usuários autenticados compartilham as ocorrências da equipe.

## Configuração

O arquivo .env.example contém os limites padrão para uso da IA. Estas variáveis podem ser ajustadas no .env:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| OPENAI_API_KEY | vazio | Chave da OpenAI; sem ela, o sistema usa simulação |
| OPENAI_MODEL | gpt-5.5 | Modelo usado nas análises reais |
| PORT | 3000 | Porta HTTP do servidor |
| HOST | 127.0.0.1 | Endereço de escuta; por padrão, somente local |
| DATABASE_PATH | database/database.db | Caminho do banco SQLite |
| IA_LIMITE_USUARIO_HORA | 10 | Chamadas reais por usuário em uma hora |
| IA_LIMITE_USUARIO_DIA | 30 | Chamadas reais por usuário em 24 horas |
| IA_LIMITE_GLOBAL_DIA | 100 | Chamadas reais no total em 24 horas |
| IA_MAX_CONCORRENCIA_USUARIO | 1 | Chamadas reais simultâneas por usuário |
| IA_MAX_CONCORRENCIA_GLOBAL | 2 | Chamadas reais simultâneas no sistema |
| IA_RESERVA_TTL_MINUTOS | 15 | Prazo da reserva, renovada durante chamadas demoradas |

As janelas de cotas usam timestamps UTC. As reservas e usos reais ficam na tabela ia_usos_reais. Análises simuladas não consomem essas cotas. Ao atingir uma cota ou limite de concorrência, o sistema continua a investigação em modo simulado. Uma análise idêntica já em andamento retorna HTTP 409 para evitar uma chamada duplicada.

Falhas depois do início da chamada são registradas de forma segura. Uma reserva só é cancelada quando a chamada ao provedor ainda não começou. Se a API respondeu, o uso é contabilizado mesmo quando uma resposta inválida exige gerar um relatório simulado. Erros de configuração, como uma chave inválida, continuam visíveis para facilitar a correção.

## APIs principais

| Prefixo | Uso |
| --- | --- |
| /api/auth | Login, sessão, logout e alteração de senha |
| /api/ocorrencias | Cadastro, consulta, edição e acompanhamento de ocorrências |
| /api/investigacao | Coleta de respostas e dados da investigação |
| /api/ia | Análise e histórico de análises |
| /api/usuarios | Administração de usuários |

As APIs privadas exigem autenticação. Operações que alteram dados também usam proteção CSRF.

## Recuperação da conta administrativa

Se a senha de uma conta administrativa for perdida, pare o servidor e execute localmente:

~~~bash
npm run recuperar-admin
~~~

O comando usa o mesmo banco configurado para o servidor, lista somente contas administrativas ativas e solicita a nova senha temporária pelo terminal sem exibi-la. A confirmação é solicitada antes da alteração. A conta recuperada deverá trocar a senha no próximo login; somente as sessões dessa conta são revogadas.

Não informe a senha como argumento do comando. A recuperação não cria usuários, não altera papéis, não reativa contas desativadas e não está disponível por uma rota web.

## Testes

Execute a suíte automatizada:

~~~bash
npm test
~~~

Os testes de autenticação, recuperação e controle de uso usam bancos temporários. Os testes da integração com IA utilizam um cliente simulado e não precisam de uma chamada real à OpenAI.

## Segurança

- Troque a senha inicial do administrador antes de usar o sistema.
- Mantenha .env fora do Git; nunca publique OPENAI_API_KEY.
- O servidor escuta em 127.0.0.1 por padrão.
- Para disponibilizar o sistema em uma rede, configure HTTPS e revise as configurações de acesso antes da implantação.

