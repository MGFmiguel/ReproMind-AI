const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-ia-integracao-"));
process.env.DATABASE_PATH = path.join(diretorioTemporario, "integracao.db");
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";

const db = require("../database/database");
const rotasIA = require("../routes/ia");
const { criarControleUsoIA, calcularFingerprintEntrada } = require("../services/controleUsoIA");
const inteligenciaArtificial = require("../services/inteligenciaArtificial");
const servidores = new Set();
let contador = 0;

after(async () => {
  for (const servidor of servidores) {
    if (servidor.listening) {
      await new Promise((resolver) => servidor.close(resolver));
    }
  }
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

function criarUsuario() {
  contador += 1;
  const resultado = db.prepare(
    "INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, ativo) VALUES (?, 'hash', 'salt', 'membro', 1)",
  ).run("integracao-" + contador);
  return Number(resultado.lastInsertRowid);
}

function criarOcorrencia(descricao = "Falha inicial") {
  const resultado = db.prepare(
    "INSERT INTO ocorrencias (titulo, descricao, categoria, prioridade) VALUES (?, ?, 'Aplicação', 'Alta')",
  ).run("Falha " + (contador + 1), descricao);
  const id = Number(resultado.lastInsertRowid);
  db.prepare(
    "INSERT INTO respostas_investigacao (ocorrencia_id, pergunta, resposta, ordem) VALUES (?, 'passos', 'Reproduzir a falha', 1)",
  ).run(id);
  return id;
}

function criarControle(opcoes = {}) {
  return criarControleUsoIA({
    db,
    configuracao: {
      limiteUsuarioHora: 20,
      limiteUsuarioDia: 40,
      limiteGlobalDia: 100,
      maxConcorrenciaUsuario: 2,
      maxConcorrenciaGlobal: 5,
      ttlReservaMs: 300,
      ...opcoes,
    },
  });
}

function resultadoIA(modo, metadados = {}) {
  return {
    analise: "Relatório de teste",
    relatorio: {
      modo,
      resumo: "Resumo de teste",
      hipoteses: ["Hipótese inicial"],
      evidencias: [],
      testes: ["Reproduzir a falha"],
      informacoes: {},
      confianca: "Baixa",
      status: "Aguardando validação",
      testes_priorizados: [],
    },
    metadadosIA: {
      chamadaRealIniciada: modo === "REAL",
      respostaRecebida: modo === "REAL",
      modelo: modo === "REAL" ? "modelo-teste" : null,
      tokensEntrada: modo === "REAL" ? 31 : null,
      tokensSaida: modo === "REAL" ? 12 : null,
      ...metadados,
    },
  };
}

async function iniciarAplicacao({ usuarioId, controle, analisar, disponivel = true }) {
  const app = express();
  app.use((req, res, next) => {
    req.usuario = { id: usuarioId, papel: "membro" };
    next();
  });
  app.use("/api/ia", rotasIA.criarRouterIA({
    db,
    controleUsoIA: controle,
    analisarOcorrencia: analisar,
    estaOpenAIConfigurada: () => disponivel,
    obterModeloOpenAI: () => "modelo-teste",
    obterContextoAnalise: () => "contexto-integracao-v1",
  }));

  const servidor = app.listen(0, "127.0.0.1");
  servidores.add(servidor);
  await new Promise((resolver, rejeitar) => {
    servidor.once("listening", resolver);
    servidor.once("error", rejeitar);
  });

  return {
    servidor,
    requisitar: (ocorrenciaId) => fetch(
      "http://127.0.0.1:" + servidor.address().port + "/api/ia/analisar/" + ocorrenciaId,
      { method: "POST" },
    ),
    buscarHistorico: (ocorrenciaId) => fetch(
      "http://127.0.0.1:" + servidor.address().port + "/api/ia/historico/" + ocorrenciaId,
    ),
  };
}

test("a rota registra usuario, modelo e tokens em uma analise real", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  let chamadasReais = 0;
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      assert.equal(opcoes.modelo, "modelo-teste");
      opcoes.onChamadaRealIniciada();
      chamadasReais += 1;
      return resultadoIA("REAL");
    },
  });

  const resposta = await app.requisitar(ocorrenciaId);
  const corpo = await resposta.json();
  const uso = db.prepare("SELECT * FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaId);

  assert.equal(resposta.status, 200);
  assert.deepEqual(Object.keys(corpo).sort(), ["analise", "mensagem", "relatorio"]);
  assert.equal(corpo.relatorio.modo, "REAL");
  assert.equal(chamadasReais, 1);
  assert.equal(uso.usuario_id, usuarioId);
  assert.equal(uso.status, "concluida");
  assert.equal(uso.modelo, "modelo-teste");
  assert.equal(uso.tokens_entrada, 31);
  assert.equal(uso.tokens_saida, 12);
  const historico = await app.buscarHistorico(ocorrenciaId);
  assert.equal(historico.status, 200);
  assert.equal((await historico.json()).total, 1);

  const ocorrencia = db.prepare("SELECT * FROM ocorrencias WHERE id = ?").get(ocorrenciaId);
  const respostas = db.prepare(
    "SELECT pergunta, resposta FROM respostas_investigacao WHERE ocorrencia_id = ? ORDER BY ordem ASC",
  ).all(ocorrenciaId);
  assert.equal(uso.fingerprint_entrada, calcularFingerprintEntrada({
    ocorrencia,
    respostas,
    modelo: "modelo-teste",
    contexto: "contexto-integracao-v1",
  }));
  assert.notEqual(uso.fingerprint_entrada, calcularFingerprintEntrada({
    ocorrencia,
    respostas,
    modelo: "modelo-teste",
    contexto: "contexto-integracao-v2",
  }));
});

test("sem chave de API, a rota salva simulacao sem reservar nem contar uso real", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  let modoSimuladoForcado = false;
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    disponivel: false,
    analisar: async (ocorrencia, respostas, opcoes) => {
      modoSimuladoForcado = opcoes.forcarSimulado === true;
      return resultadoIA("SIMULADO", {
        chamadaRealIniciada: false,
        respostaRecebida: false,
        modelo: null,
        tokensEntrada: null,
        tokensSaida: null,
      });
    },
  });

  const resposta = await app.requisitar(ocorrenciaId);
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200);
  assert.equal(corpo.relatorio.modo, "SIMULADO");
  assert.equal(modoSimuladoForcado, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ia_usos_reais WHERE usuario_id = ?").get(usuarioId).total, 0);
});

test("atingir a cota mantém a análise simulada disponível sem criar uso real", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaComUso = criarOcorrencia("Uso anterior");
  const ocorrenciaAtual = criarOcorrencia("Nova análise");
  const controle = criarControle({ limiteUsuarioHora: 1 });
  const reserva = controle.reservarUsoReal({
    usuarioId,
    ocorrenciaId: ocorrenciaComUso,
    fingerprintEntrada: crypto.createHash("sha256").update("uso-anterior").digest("hex"),
    modelo: "modelo-teste",
  });
  controle.concluirUsoReal(reserva.usoId);

  let chamadaSimulada = false;
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      chamadaSimulada = opcoes.forcarSimulado === true;
      return resultadoIA("SIMULADO", {
        chamadaRealIniciada: false,
        respostaRecebida: false,
      });
    },
  });

  const resposta = await app.requisitar(ocorrenciaAtual);
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200);
  assert.equal(corpo.relatorio.modo, "SIMULADO");
  assert.equal(chamadaSimulada, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ia_usos_reais WHERE usuario_id = ?").get(usuarioId).total, 1);
});

test("atingir a concorrência mantém análises diferentes disponíveis em modo simulado", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaEmAndamento = criarOcorrencia("Análise em andamento");
  const outraOcorrencia = criarOcorrencia("Outra análise");
  const controle = criarControle({ maxConcorrenciaUsuario: 1 });
  let liberarAnalise;
  let sinalizarInicio;
  const inicio = new Promise((resolver) => { sinalizarInicio = resolver; });
  const analisePendente = new Promise((resolver) => { liberarAnalise = resolver; });
  let chamadasReais = 0;
  const appReal = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      chamadasReais += 1;
      opcoes.onChamadaRealIniciada();
      sinalizarInicio();
      return analisePendente;
    },
  });
  const appSimulado = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      if (opcoes.forcarSimulado) return resultadoIA("SIMULADO", { chamadaRealIniciada: false });
      chamadasReais += 1;
      opcoes.onChamadaRealIniciada();
      return resultadoIA("REAL");
    },
  });

  const primeiraRequisicao = appReal.requisitar(ocorrenciaEmAndamento);
  await inicio;
  const segundaResposta = await appSimulado.requisitar(outraOcorrencia);
  const segundoCorpo = await segundaResposta.json();

  assert.equal(segundaResposta.status, 200);
  assert.equal(segundoCorpo.relatorio.modo, "SIMULADO");
  assert.equal(chamadasReais, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ia_usos_reais WHERE usuario_id = ?").get(usuarioId).total, 1);

  liberarAnalise(resultadoIA("REAL"));
  assert.equal((await primeiraRequisicao).status, 200);
});

test("chamadas idênticas simultâneas, inclusive de outro usuário, não duplicam a chamada real", async () => {
  const usuarioA = criarUsuario();
  const usuarioB = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  let liberarAnalise;
  let sinalizarInicio;
  const inicio = new Promise((resolver) => { sinalizarInicio = resolver; });
  const analisePendente = new Promise((resolver) => { liberarAnalise = resolver; });
  let chamadasReais = 0;

  const appA = await iniciarAplicacao({
    usuarioId: usuarioA,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      chamadasReais += 1;
      opcoes.onChamadaRealIniciada();
      sinalizarInicio();
      return analisePendente;
    },
  });
  const appB = await iniciarAplicacao({
    usuarioId: usuarioB,
    controle,
    analisar: async () => {
      chamadasReais += 1;
      return resultadoIA("REAL");
    },
  });

  const requisicaoA = appA.requisitar(ocorrenciaId);
  await inicio;
  const respostaB = await appB.requisitar(ocorrenciaId);
  const corpoB = await respostaB.json();

  assert.equal(respostaB.status, 409);
  assert.equal(corpoB.codigo, "ANALISE_DUPLICADA_EM_ANDAMENTO");
  assert.equal(chamadasReais, 1);

  liberarAnalise(resultadoIA("REAL"));
  assert.equal((await requisicaoA).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaId).total, 1);
});

test("mudanças na ocorrência permitem nova análise legítima", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  let chamadasReais = 0;
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      chamadasReais += 1;
      opcoes.onChamadaRealIniciada();
      return resultadoIA("REAL");
    },
  });

  assert.equal((await app.requisitar(ocorrenciaId)).status, 200);
  db.prepare("UPDATE ocorrencias SET descricao = ? WHERE id = ?").run("Descrição atualizada", ocorrenciaId);
  assert.equal((await app.requisitar(ocorrenciaId)).status, 200);

  assert.equal(chamadasReais, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ia_usos_reais WHERE usuario_id = ? AND ocorrencia_id = ?").get(usuarioId, ocorrenciaId).total, 2);
});

test("a rota renova a reserva durante uma chamada real demorada", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controleReal = criarControle({ ttlReservaMs: 300 });
  let renovacoes = 0;
  const controle = {
    ...controleReal,
    renovarReservaUsoReal(usoId) {
      const resultado = controleReal.renovarReservaUsoReal(usoId);
      if (resultado.renovada) renovacoes += 1;
      return resultado;
    },
  };
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      opcoes.onChamadaRealIniciada();
      await new Promise((resolver) => setTimeout(resolver, 650));
      return resultadoIA("REAL");
    },
  });

  const resposta = await app.requisitar(ocorrenciaId);

  assert.equal(resposta.status, 200);
  assert.ok(renovacoes >= 1);
  assert.equal(db.prepare("SELECT status FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaId).status, "concluida");
});

test("falhas após enviar marcam uso como falho e falhas antes do envio cancelam a reserva", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaFalhaReal = criarOcorrencia("Falha após envio");
  const ocorrenciaFalhaLocal = criarOcorrencia("Falha antes do envio");
  const controle = criarControle();
  const appFalhaReal = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async (ocorrencia, respostas, opcoes) => {
      opcoes.onChamadaRealIniciada();
      const erro = new Error("detalhes privados não devem ser registrados");
      erro.code = "invalid_api_key";
      throw erro;
    },
  });
  const respostaFalhaReal = await appFalhaReal.requisitar(ocorrenciaFalhaReal);

  const appFalhaLocal = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: async () => {
      const erro = new Error("erro antes de chamar o provedor");
      erro.code = "falha_local";
      throw erro;
    },
  });
  const respostaFalhaLocal = await appFalhaLocal.requisitar(ocorrenciaFalhaLocal);

  assert.equal(respostaFalhaReal.status, 500);
  assert.equal(respostaFalhaLocal.status, 500);
  assert.deepEqual(
    db.prepare("SELECT status, codigo_erro FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaFalhaReal),
    { status: "falhou", codigo_erro: "invalid_api_key" },
  );
  assert.equal(
    db.prepare("SELECT status FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaFalhaLocal).status,
    "cancelada",
  );
});

test("falha temporária da OpenAI mantém o fallback simulado e registra tentativa real", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: (ocorrencia, respostas, opcoes) => inteligenciaArtificial.analisarOcorrencia(
      ocorrencia,
      respostas,
      {
        ...opcoes,
        clienteOpenAI: {
          responses: {
            create: async () => {
              const erro = new Error("erro temporário");
              erro.status = 503;
              throw erro;
            },
          },
        },
      },
    ),
  });

  const resposta = await app.requisitar(ocorrenciaId);
  const corpo = await resposta.json();
  const uso = db.prepare("SELECT status, tokens_entrada, tokens_saida FROM ia_usos_reais WHERE ocorrencia_id = ?").get(ocorrenciaId);

  assert.equal(resposta.status, 200);
  assert.equal(corpo.relatorio.modo, "SIMULADO");
  assert.deepEqual(uso, { status: "falhou", tokens_entrada: null, tokens_saida: null });
});

test("resposta inválida contabiliza chamada concluída mesmo quando o relatório fica simulado", async () => {
  const usuarioId = criarUsuario();
  const ocorrenciaId = criarOcorrencia();
  const controle = criarControle();
  const app = await iniciarAplicacao({
    usuarioId,
    controle,
    analisar: (ocorrencia, respostas, opcoes) => inteligenciaArtificial.analisarOcorrencia(
      ocorrencia,
      respostas,
      {
        ...opcoes,
        clienteOpenAI: {
          responses: {
            create: async () => ({
              output_text: "resposta que não é JSON",
              model: "modelo-mock-real",
              usage: { input_tokens: 8, output_tokens: 4 },
            }),
          },
        },
      },
    ),
  });

  const resposta = await app.requisitar(ocorrenciaId);
  const corpo = await resposta.json();
  const uso = db.prepare(
    "SELECT usuario_id, status, modelo, tokens_entrada, tokens_saida FROM ia_usos_reais WHERE ocorrencia_id = ?",
  ).get(ocorrenciaId);

  assert.equal(resposta.status, 200);
  assert.equal(corpo.relatorio.modo, "SIMULADO");
  assert.deepEqual(uso, {
    usuario_id: usuarioId,
    status: "concluida",
    modelo: "modelo-mock-real",
    tokens_entrada: 8,
    tokens_saida: 4,
  });
});
