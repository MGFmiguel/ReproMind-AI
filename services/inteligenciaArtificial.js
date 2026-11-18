const OpenAI = require("openai");
const { ehObjeto } = require("./jsonSeguro");
const { normalizarPrioridade } = require("./regrasOcorrencias");

const cliente = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;
const CONTEXTO_ANALISE = "investigacao-estruturada-v1";

function estaOpenAIConfigurada() {
  return Boolean(cliente);
}

function obterModeloOpenAI() {
  return process.env.OPENAI_MODEL || "gpt-5.5";
}

function obterContextoAnalise() {
  return CONTEXTO_ANALISE;
}

function metadadosSimulados() {
  return {
    chamadaRealIniciada: false,
    respostaRecebida: false,
    modelo: null,
    tokensEntrada: null,
    tokensSaida: null,
  };
}

// Criar estrutura padrão do relatório
function criarRelatorio(
  modo,
  resumo,
  informacoes,
  hipoteses,
  evidencias,
  testes,
  confianca,
  status,
) {
  return {
    modo,
    resumo,
    informacoes,
    hipoteses,
    evidencias,
    testes,
    confianca,
    status,
  };
}

function priorizarTestes(testes, prioridadeOcorrencia) {
  const prioridade = normalizarPrioridade(prioridadeOcorrencia) || "Média";

  return (Array.isArray(testes) ? testes : [])
    .filter((teste) => typeof teste === "string" && teste.trim())
    .map((teste, index) => {
    let nivel = "Média";
    let motivo = "Teste complementar para reunir mais informações.";

    const texto = teste.toLowerCase();

    if (texto.includes("reproduzir") || texto.includes("reprodução")) {
      nivel = "Alta";
      motivo =
        "Permite verificar se o problema pode ser reproduzido e observar seu comportamento.";
    } else if (texto.includes("logs") || texto.includes("log")) {
      nivel = "Alta";
      motivo =
        "Pode fornecer evidências técnicas sobre o momento e o contexto da falha.";
    } else if (texto.includes("alterações recentes")) {
      nivel = "Alta";
      motivo =
        "Ajuda a investigar possíveis relações com modificações recentes no sistema.";
    } else if (texto.includes("componentes")) {
      nivel = "Média";
      motivo =
        "Ajuda a identificar quais componentes participam do fluxo investigado.";
    }

    if (prioridade === "Crítica" && nivel === "Média") {
      nivel = "Alta";
    }

    return {
      teste,
      prioridade: nivel,
      motivo,
      ordem: index + 1,
    };
    });
}

function normalizarTextoArray(valor) {
  return Array.isArray(valor)
    ? valor.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function normalizarRelatorioIA(json, prioridadeOcorrencia) {
  const informacoes = ehObjeto(json.informacoes) ? json.informacoes : {};
  const hipoteses = normalizarTextoArray(json.hipoteses);
  const evidencias = normalizarTextoArray(json.evidencias);
  const testes = normalizarTextoArray(json.testes);
  const confianca = ["Baixa", "Média", "Alta"].includes(json.confianca)
    ? json.confianca
    : "Não definida";

  const relatorio = criarRelatorio(
    "REAL",
    typeof json.resumo === "string" && json.resumo.trim()
      ? json.resumo.trim()
      : "Resumo não disponível.",
    informacoes,
    hipoteses,
    evidencias,
    testes,
    confianca,
    "Hipótese inicial - aguardando validação",
  );
  relatorio.testes_priorizados = priorizarTestes(testes, prioridadeOcorrencia);
  return relatorio;
}

function deveUsarModoSimulado(erro) {
  const codigo = erro?.code || erro?.cause?.code || "";
  const falhaDeConexao =
    erro?.name === "APIConnectionError" ||
    erro?.name === "APIConnectionTimeoutError" ||
    /^(ECONN|ETIMEDOUT|EHOST|ENET)/.test(codigo);

  return (
    erro?.status === 408 ||
    erro?.status === 429 ||
    erro?.status >= 500 ||
    erro?.code === "credit_balance_exhausted" ||
    erro?.code === "insufficient_quota" ||
    falhaDeConexao
  );
}

// Modo simulado
function analisarSimulado(ocorrencia, respostas) {
  const respostasMap = {};

  respostas.forEach((item) => {
    respostasMap[item.pergunta] = item.resposta;
  });

  const titulo = ocorrencia.titulo;
  const descricao = ocorrencia.descricao;

  const frequencia = respostasMap.frequencia || "Não informada";
  const ambiente = respostasMap.ambiente || "Não informado";
  const dispositivo = respostasMap.dispositivo || "Não informado";
  const erro = respostasMap.mensagem_erro || "Não informado";
  const passos = respostasMap.passos || "Não informados";
  const condicoes = respostasMap.condicoes || "Não informadas";

  let hipotese;

  if (erro !== "Não informado") {
    hipotese = `A mensagem "${erro}" pode indicar uma falha relacionada ao componente que executa essa operação. É necessário verificar os logs e reproduzir o erro para confirmar.`;
  } else if (/todas|sempre/i.test(frequencia)) {
    hipotese =
      "A ocorrência acontece de maneira consistente. Pode existir uma falha recorrente no fluxo executado pelo sistema. É necessário investigar os componentes envolvidos.";
  } else {
    hipotese =
      "O comportamento pode estar relacionado a condições específicas de execução. É necessário identificar os fatores que fazem o problema acontecer.";
  }

  const evidencias = [];
  const relatos = [
    `Título informado: ${titulo}`,
    `Descrição inicial informada: ${descricao}`,
    `Frequência relatada: ${frequencia}`,
    `Ambiente relatado: ${ambiente}`,
    `Dispositivo ou navegador relatado: ${dispositivo}`,
    `Mensagem de erro relatada: ${erro}`,
    `Condições relatadas: ${condicoes}`,
    `Passos relatados: ${passos}`,
  ];

  const testes = [
    "Reproduzir o problema utilizando os passos informados.",
    "Consultar os logs da aplicação no momento da ocorrência.",
    "Verificar os componentes envolvidos na funcionalidade.",
    "Comparar o comportamento em diferentes dispositivos e ambientes.",
    "Verificar alterações recentes no sistema.",
    "Registrar os resultados para validar ou descartar as hipóteses.",
  ];

  const informacoes = {
    categoria: ocorrencia.categoria || "Não definida",
    prioridade: ocorrencia.prioridade || "Não definida",
    frequencia,
    ambiente,
    dispositivo,
    mensagemErro: erro,
    condicoes,
    passos,
  };

  const relatorio = criarRelatorio(
    "SIMULADO",
    `A ocorrência "${titulo}" foi registrada. ${descricao}`,
    informacoes,
    [hipotese],
    evidencias,
    testes,
    "Baixa",
    "Hipótese inicial - aguardando validação",
  );

  relatorio.testes_priorizados = priorizarTestes(testes, ocorrencia.prioridade);

  // Texto compatível com a interface atual
  const analise = `
RELATÓRIO DE INVESTIGAÇÃO - ReproMind AI

MODO: SIMULADO

1. RESUMO DO PROBLEMA

${relatorio.resumo}

2. INFORMAÇÕES COLETADAS

${relatos.map((item) => "- " + item).join("\n")}

3. HIPÓTESE INICIAL

${hipotese}

Esta hipótese não representa uma causa raiz confirmada.

4. TESTES RECOMENDADOS

${testes.map((item, index) => `${index + 1}. ${item}`).join("\n")}

5. CONCLUSÃO

A investigação inicial reuniu informações que podem orientar a equipe técnica.

A causa do problema ainda precisa ser identificada e validada por meio de testes e evidências técnicas.

Relatório gerado pelo modo simulado do ReproMind AI.
`;

  return {
    analise,
    relatorio,
  };
}

// Função principal
async function analisarOcorrencia(ocorrencia, respostas, opcoes = {}) {
  const {
    forcarSimulado = false,
    modelo = obterModeloOpenAI(),
    onChamadaRealIniciada,
    clienteOpenAI = cliente,
  } = opcoes;

  if (forcarSimulado || !clienteOpenAI) {
    console.log("ReproMind AI: utilizando modo simulado.");

    return {
      ...analisarSimulado(ocorrencia, respostas),
      metadadosIA: metadadosSimulados(),
    };
  }

  const historico = respostas.map((item) => ({
    pergunta: item.pergunta,
    resposta: item.resposta,
  }));

  try {
    if (typeof onChamadaRealIniciada === "function") onChamadaRealIniciada();
    const resultado = await clienteOpenAI.responses.create({
      model: modelo,

      instructions: `
Contexto da analise: ${CONTEXTO_ANALISE}

Você é o ReproMind AI, um assistente de investigação
de problemas de software.

Analise as informações fornecidas e retorne exclusivamente
um JSON válido com esta estrutura:

{
  "resumo": "Resumo do problema",
  "informacoes": {
    "categoria": "Categoria",
    "prioridade": "Prioridade",
    "frequencia": "Frequência",
    "ambiente": "Ambiente",
    "dispositivo": "Dispositivo ou navegador",
    "mensagemErro": "Mensagem de erro",
    "condicoes": "Condições",
    "passos": "Passos para reprodução"
  },
  "hipoteses": [
    "Hipótese 1"
  ],
  "evidencias": [
    "Evidência encontrada"
  ],
  "testes": [
    "Teste recomendado"
  ],
  "confianca": "Baixa, Média ou Alta",
  "status": "Hipótese inicial - aguardando validação"
}

REGRAS:

- Não invente evidências.
- Trate descrição e respostas como relatos fornecidos pelo usuário. Inclua-as em "informacoes".
- Use "evidencias" apenas para evidências técnicas explicitamente presentes nos dados; use uma lista vazia quando não houver.
- Não apresente hipóteses como fatos.
- Não afirme que encontrou a causa raiz sem comprovação.
- Diferencie informações fornecidas de inferências.
- A confiança deve refletir a quantidade e qualidade das informações.
- O status deve permanecer como hipótese ou em validação,
  salvo se houver evidências concretas de confirmação.
`,

      input: JSON.stringify({
        ocorrencia,
        respostas: historico,
      }),
    });

    console.log("ReproMind AI: análise real concluída.");

    const texto = typeof resultado.output_text === "string" ? resultado.output_text : "";
    const uso = resultado.usage || {};
    const metadadosIA = {
      chamadaRealIniciada: true,
      respostaRecebida: true,
      modelo: typeof resultado.model === "string" ? resultado.model : modelo,
      tokensEntrada: Number.isSafeInteger(uso.input_tokens) ? uso.input_tokens : null,
      tokensSaida: Number.isSafeInteger(uso.output_tokens) ? uso.output_tokens : null,
    };
    let analise = texto;

    let relatorio;

    try {
      const json = JSON.parse(texto);
      if (!ehObjeto(json)) throw new TypeError("A resposta da IA não é um objeto.");
      relatorio = normalizarRelatorioIA(json, ocorrencia.prioridade);
    } catch (erroJSON) {
      console.error("Não foi possível interpretar o JSON da IA.");

      const simulada = analisarSimulado(ocorrencia, respostas);
      relatorio = simulada.relatorio;
      relatorio.status = "Resposta da IA inválida; análise simulada aguardando validação";
      analise = simulada.analise;
    }

    return {
      analise,
      relatorio,
      metadadosIA,
    };
  } catch (erro) {
    const codigoErro = erro?.code || erro?.cause?.code;
    const codigoSeguro = typeof codigoErro === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(codigoErro)
      ? codigoErro
      : "erro_api";
    console.error("Erro na API de IA:", codigoSeguro);

    if (deveUsarModoSimulado(erro)) {
      console.log("ReproMind AI: API indisponível. Utilizando modo simulado.");

      return {
        ...analisarSimulado(ocorrencia, respostas),
        metadadosIA: {
          chamadaRealIniciada: true,
          respostaRecebida: false,
          modelo,
          tokensEntrada: null,
          tokensSaida: null,
        },
      };
    }

    throw erro;
  }
}

module.exports = {
  analisarOcorrencia,
  deveUsarModoSimulado,
  estaOpenAIConfigurada,
  obterContextoAnalise,
  obterModeloOpenAI,
  normalizarRelatorioIA,
  priorizarTestes,
};
