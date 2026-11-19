const express = require("express");
const router = express.Router();
const db = require("../database/connection");
const { ehArray, ehObjeto, lerJson } = require("../services/jsonSeguro");
const { textoValido } = require("../services/regrasOcorrencias");

// Perguntas disponíveis
const perguntas = {
  frequencia: {
    texto:
      "O problema acontece em todas as tentativas ou apenas algumas vezes?",
  },

  condicoes: {
    texto: "Em quais condições o problema costuma acontecer?",
  },

  ambiente: {
    texto: "O problema acontece no computador, celular ou em ambos?",
  },

  dispositivo: {
    texto: "Qual navegador ou aplicativo você utiliza?",
  },

  mensagem_erro: {
    texto: "Aparece alguma mensagem de erro? Se sim, qual é?",
  },

  passos: {
    texto: "Quais passos você realiza até o problema acontecer?",
  },

  frontend_tela: {
    texto: "Em qual página, tela ou componente visual o problema acontece?",
  },

  backend_api: {
    texto: "Qual operação ou funcionalidade do sistema apresenta a falha?",
  },

  banco_consulta: {
    texto: "O problema envolve salvar, consultar, atualizar ou excluir dados?",
  },

  integracao_servico: {
    texto:
      "Qual serviço, sistema ou API externa está envolvida nessa integração?",
  },
};

// Verificar ocorrência
async function buscarOcorrencia(id) {
  return db.prepare("SELECT * FROM ocorrencias WHERE id = ?").get(id);
}

// Selecionar próxima pergunta
router.get("/:id/proxima-pergunta", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID inválido.",
    });
  }

  const ocorrencia = await buscarOcorrencia(id);

  if (!ocorrencia) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  const respostas = await db
    .prepare(
      `
          SELECT pergunta, resposta
          FROM respostas_investigacao
          WHERE ocorrencia_id = ?
      `,
    )
    .all(id);

  const respostasMap = {};

  respostas.forEach((item) => {
    respostasMap[item.pergunta] = item.resposta;
  });

  let proxima = null;

  // Investigação inicial
  if (!respostasMap.frequencia) {
    proxima = "frequencia";
  } else if (
    !respostasMap.condicoes &&
    /algumas|às vezes|as vezes|ocasionalmente/i.test(respostasMap.frequencia)
  ) {
    proxima = "condicoes";
  } else if (!respostasMap.ambiente) {
    proxima = "ambiente";
  } else if (!respostasMap.dispositivo) {
    proxima = "dispositivo";
  } else if (!respostasMap.mensagem_erro) {
    proxima = "mensagem_erro";
  } else if (!respostasMap.passos) {
    proxima = "passos";
  }

  // Pergunta específica conforme a categoria
  else if (ocorrencia.categoria === "Frontend" && !respostasMap.frontend_tela) {
    proxima = "frontend_tela";
  } else if (ocorrencia.categoria === "Backend" && !respostasMap.backend_api) {
    proxima = "backend_api";
  } else if (
    ocorrencia.categoria === "Banco de dados" &&
    !respostasMap.banco_consulta
  ) {
    proxima = "banco_consulta";
  } else if (
    ocorrencia.categoria === "Integração" &&
    !respostasMap.integracao_servico
  ) {
    proxima = "integracao_servico";
  }

  if (!proxima) {
    return res.json({
      concluida: true,
      mensagem:
        "Investigação concluída! Todas as perguntas necessárias foram respondidas.",
    });
  }

  res.json({
    concluida: false,
    pergunta: proxima,
    texto: perguntas[proxima].texto,
  });
});

// Registrar resposta
router.get("/:id/respostas", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erro: "ID inválido." });
  }
  if (!await buscarOcorrencia(id)) {
    return res.status(404).json({ erro: "Ocorrência não encontrada." });
  }

  const respostas = await db.prepare(`
    SELECT pergunta, resposta, ordem
    FROM respostas_investigacao
    WHERE ocorrencia_id = ?
    ORDER BY ordem ASC
  `).all(id);

  res.json({
    respostas: respostas.map((item) => ({
      ...item,
      texto: perguntas[item.pergunta]?.texto || item.pergunta,
    })),
  });
});

router.post("/:id/respostas", async (req, res) => {
  const id = Number(req.params.id);
  const pergunta = req.body?.pergunta;
  const resposta = req.body?.resposta;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID inválido.",
    });
  }

  if (!await buscarOcorrencia(id)) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  if (
    typeof pergunta !== "string" ||
    !perguntas[pergunta] ||
    !textoValido(resposta, 5000, true)
  ) {
    return res.status(400).json({
      erro: "Pergunta ou resposta inválida.",
    });
  }

  const existente = await db
    .prepare(
      `
          SELECT id FROM respostas_investigacao
          WHERE ocorrencia_id = ? AND pergunta = ?
      `,
    )
    .get(id, pergunta);

  if (existente) {
    await db.prepare(
      `
              UPDATE respostas_investigacao
              SET resposta = ?
              WHERE id = ?
          `,
    ).run(resposta.trim(), existente.id);
  } else {
    const quantidade = (await db
      .prepare(
        `
              SELECT COUNT(*) AS total
              FROM respostas_investigacao
              WHERE ocorrencia_id = ?
          `,
      )
      .get(id)).total;

    await db.prepare(
      `
              INSERT INTO respostas_investigacao
              (ocorrencia_id, pergunta, resposta, ordem)
              VALUES (?, ?, ?, ?)
          `,
    ).run(id, pergunta, resposta.trim(), quantidade + 1);
  }

  await db.prepare("UPDATE ocorrencias SET status = ? WHERE id = ? AND status = ?")
    .run("Em investigação", id, "Aberta");

  res.json({
    mensagem: "Resposta registrada com sucesso!",
  });
});

// Gerar relatório da investigação
router.post("/:id/relatorio", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID da ocorrência inválido.",
    });
  }

  const ocorrencia = await buscarOcorrencia(id);

  if (!ocorrencia) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  const respostas = await db
    .prepare(
      `
          SELECT pergunta, resposta
          FROM respostas_investigacao
          WHERE ocorrencia_id = ?
          ORDER BY ordem ASC
      `,
    )
    .all(id);

  if (respostas.length === 0) {
    return res.status(400).json({
      erro: "A investigação ainda não possui respostas.",
    });
  }

  const perguntasRespondidas = new Set(respostas.map((item) => item.pergunta));
  const frequencia = respostas.find((item) => item.pergunta === "frequencia")?.resposta || "";
  const requerCondicoes = /algumas|às vezes|as vezes|ocasionalmente/i.test(frequencia);
  const perguntaCategoria = {
    Frontend: "frontend_tela",
    Backend: "backend_api",
    "Banco de dados": "banco_consulta",
    Integração: "integracao_servico",
  }[ocorrencia.categoria];
  const obrigatorias = ["frequencia", ...(requerCondicoes ? ["condicoes"] : []), "ambiente", "dispositivo", "mensagem_erro", "passos"];
  if (perguntaCategoria) obrigatorias.push(perguntaCategoria);
  if (obrigatorias.some((pergunta) => !perguntasRespondidas.has(pergunta))) {
    return res.status(400).json({ erro: "Conclua as perguntas necessárias antes de gerar o relatório." });
  }

  const respostasMap = {};

  respostas.forEach((item) => {
    respostasMap[item.pergunta] = item.resposta;
  });

  // Informações coletadas
  const informacoes = {
    descricaoInicial: ocorrencia.descricao,
    respostas: Object.fromEntries(respostas.map((item) => [item.pergunta, item.resposta])),
  };
  const evidencias = [];

  // Hipóteses iniciais, não conclusões
  const hipotese = respostasMap.mensagem_erro
    ? `A mensagem informada pelo usuário pode ajudar a identificar a origem do problema: "${respostasMap.mensagem_erro}". É necessário analisar os registros e reproduzir o comportamento para validar essa hipótese.`
    : "Ainda não foi informada uma mensagem de erro. É necessário investigar os registros da aplicação e tentar reproduzir o problema.";

  // Testes recomendados conforme a categoria
  let testes = [];

  switch (ocorrencia.categoria) {
    case "Frontend":
      testes = [
        "Verificar erros no console do navegador.",
        "Testar a página em diferentes navegadores.",
        "Verificar se o problema ocorre em diferentes tamanhos de tela.",
        "Conferir os componentes visuais envolvidos.",
        "Tentar reproduzir o problema seguindo os passos informados.",
      ];
      break;

    case "Backend":
      testes = [
        "Verificar os logs do servidor no momento da ocorrência.",
        "Testar a rota ou endpoint envolvido.",
        "Conferir os dados enviados na requisição.",
        "Verificar validações e tratamento de erros.",
        "Tentar reproduzir o problema seguindo os passos informados.",
      ];
      break;

    case "Banco de dados":
      testes = [
        "Verificar se os dados estão sendo persistidos corretamente.",
        "Conferir a consulta SQL relacionada ao problema.",
        "Verificar possíveis inconsistências nos dados.",
        "Testar operações de inserção, consulta, atualização ou exclusão.",
        "Conferir os logs relacionados ao banco de dados.",
      ];
      break;

    case "Integração":
      testes = [
        "Verificar a disponibilidade do serviço externo.",
        "Conferir os dados enviados e recebidos pela integração.",
        "Verificar códigos de resposta da API.",
        "Conferir autenticação e configurações da integração.",
        "Testar novamente a comunicação com o serviço.",
      ];
      break;

    default:
      testes = [
        "Tentar reproduzir o problema seguindo os passos informados.",
        "Verificar os logs da aplicação.",
        "Comparar o comportamento em diferentes ambientes.",
        "Verificar se houve alterações recentes no sistema.",
        "Documentar os resultados para validar as hipóteses.",
      ];
  }

  const resumo = `A ocorrência "${ocorrencia.titulo}" foi registrada com prioridade ${ocorrencia.prioridade}. Categoria: ${ocorrencia.categoria || "Não definida"}. Foram coletadas ${respostas.length} respostas durante a investigação inicial.`;

  // Salvar relatório no banco
  const resultado = await db
    .prepare(
      `
          INSERT INTO relatorios
          (ocorrencia_id, resumo, hipotese, evidencias, testes_sugeridos, informacoes)
          VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      resumo,
      hipotese,
      JSON.stringify(evidencias),
      JSON.stringify(testes),
      JSON.stringify(informacoes),
    );

  res.status(201).json({
    mensagem: "Relatório gerado com sucesso!",
    relatorioId: resultado.lastInsertRowid,
    resumo,
    hipotese,
    evidencias,
    informacoes,
    testes,
  });
});

// Consultar relatório
router.get("/:id/relatorio", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID da ocorrência inválido.",
    });
  }

  const relatorio = await db
    .prepare(
      `
          SELECT *
          FROM relatorios
          WHERE ocorrencia_id = ?
          ORDER BY id DESC
          LIMIT 1
      `,
    )
    .get(id);

  if (!relatorio) {
    return res.status(404).json({
      erro: "Nenhum relatório encontrado para esta ocorrência.",
    });
  }

  const evidencias = lerJson(relatorio.evidencias, [], ehArray);
  const informacoes = lerJson(relatorio.informacoes, {}, ehObjeto);
  // Relatórios tradicionais antigos guardavam relatos do usuário no campo evidencias.
  if (
    evidencias.length &&
    ((relatorio.modo === "SIMULADO") || (!relatorio.modo && Object.keys(informacoes).length === 0))
  ) {
    const relatosAnteriores = Array.isArray(informacoes.relatoLegado)
      ? informacoes.relatoLegado
      : [];
    informacoes.relatoLegado = [...relatosAnteriores, ...evidencias];
    evidencias.splice(0, evidencias.length);
  }

  res.json({
    ...relatorio,

    evidencias,

    testes_sugeridos: relatorio.testes_sugeridos
      ? lerJson(relatorio.testes_sugeridos, [], ehArray)
      : [],

    informacoes,

    hipoteses: lerJson(relatorio.hipoteses, [], ehArray),

    testes_priorizados: lerJson(relatorio.testes_priorizados, [], ehArray),

    modo: relatorio.modo,
    confianca: relatorio.confianca,
    status_investigacao: relatorio.status_investigacao,
  });
});

module.exports = router;
