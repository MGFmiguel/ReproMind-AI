const express = require("express");

const bancoPadrao = require("../database/database");
const inteligenciaArtificial = require("../services/inteligenciaArtificial");
const controleUsoPadrao = require("../services/controleUsoIA");
const { calcularFingerprintEntrada } = require("../services/controleUsoIA");
const { ehArray, ehObjeto, lerJson } = require("../services/jsonSeguro");

function codigoErroSeguro(erro) {
  const codigo = erro?.code || erro?.cause?.code;
  return typeof codigo === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(codigo)
    ? codigo
    : null;
}

function criarRouterIA(dependencias = {}) {
  const db = dependencias.db || bancoPadrao;
  const analisarOcorrencia = dependencias.analisarOcorrencia || inteligenciaArtificial.analisarOcorrencia;
  const controleUsoIA = dependencias.controleUsoIA || controleUsoPadrao;
  const estaOpenAIConfigurada = dependencias.estaOpenAIConfigurada || inteligenciaArtificial.estaOpenAIConfigurada;
  const obterModeloOpenAI = dependencias.obterModeloOpenAI || inteligenciaArtificial.obterModeloOpenAI;
  const obterContextoAnalise = dependencias.obterContextoAnalise || inteligenciaArtificial.obterContextoAnalise;
  const iniciarIntervalo = dependencias.setInterval || setInterval;
  const pararIntervalo = dependencias.clearInterval || clearInterval;
  const router = express.Router();

  router.post("/analisar/:id", async (req, res) => {
    let usoId = null;
    let chamadaRealIniciada = false;
    let usoEncerrado = false;
    let intervaloRenovacao = null;

    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ erro: "ID inválido." });
      }

      if (!req.usuario || !Number.isSafeInteger(req.usuario.id) || req.usuario.id <= 0) {
        return res.status(401).json({ erro: "Autenticação necessária." });
      }

      const ocorrencia = db
        .prepare("SELECT * FROM ocorrencias WHERE id = ?")
        .get(id);

      if (!ocorrencia) {
        return res.status(404).json({ erro: "Ocorrência não encontrada." });
      }

      const respostas = db
        .prepare(
          "SELECT pergunta, resposta FROM respostas_investigacao WHERE ocorrencia_id = ? ORDER BY ordem ASC",
        )
        .all(id);

      if (respostas.length === 0) {
        return res.status(400).json({ erro: "Não existem respostas para analisar." });
      }

      const modelo = obterModeloOpenAI();
      const contexto = obterContextoAnalise();
      let resultado;

      if (!estaOpenAIConfigurada()) {
        resultado = await analisarOcorrencia(ocorrencia, respostas, {
          forcarSimulado: true,
          modelo,
        });
      } else {
        const fingerprintEntrada = calcularFingerprintEntrada({
          ocorrencia,
          respostas,
          modelo,
          contexto,
        });
        const reserva = controleUsoIA.reservarUsoReal({
          usuarioId: req.usuario.id,
          ocorrenciaId: id,
          fingerprintEntrada,
          modelo,
        });

        if (!reserva.permitida) {
          if (reserva.motivo === "duplicada") {
            return res.status(409).json({
              erro: "Uma análise idêntica já está em andamento.",
              codigo: "ANALISE_DUPLICADA_EM_ANDAMENTO",
            });
          }

          const motivosSemCapacidade = new Set([
            "limite_usuario_hora",
            "limite_usuario_dia",
            "limite_global_dia",
            "concorrencia_usuario",
            "concorrencia_global",
          ]);

          if (reserva.motivo === "usuario_inativo_ou_inexistente") {
            return res.status(401).json({ erro: "Autenticação necessária." });
          }
          if (!motivosSemCapacidade.has(reserva.motivo)) {
            throw new Error("Não foi possível reservar o uso da IA.");
          }

          resultado = await analisarOcorrencia(ocorrencia, respostas, {
            forcarSimulado: true,
            modelo,
          });
        } else {
          usoId = reserva.usoId;
          const ttlReservaMs = controleUsoIA.configuracao?.ttlReservaMs || 15 * 60 * 1000;
          const intervaloMs = Math.max(100, Math.floor(ttlReservaMs / 3));

          intervaloRenovacao = iniciarIntervalo(() => {
            try {
              const renovacao = controleUsoIA.renovarReservaUsoReal(usoId);
              if (!renovacao.renovada) {
                console.error("A reserva de uso da IA não pôde ser renovada.");
              }
            } catch (erroRenovacao) {
              console.error("Falha ao renovar reserva de uso da IA:", codigoErroSeguro(erroRenovacao) || "erro_interno");
            }
          }, intervaloMs);
          intervaloRenovacao.unref?.();

          try {
            resultado = await analisarOcorrencia(ocorrencia, respostas, {
              modelo,
              onChamadaRealIniciada: () => {
                chamadaRealIniciada = true;
              },
            });
          } finally {
            if (intervaloRenovacao) pararIntervalo(intervaloRenovacao);
            intervaloRenovacao = null;
          }

          const metadadosIA = resultado?.metadadosIA || {};
          if (chamadaRealIniciada) {
            if (metadadosIA.respostaRecebida === true) {
              controleUsoIA.concluirUsoReal(usoId, {
                modelo: typeof metadadosIA.modelo === "string" ? metadadosIA.modelo : modelo,
                tokensEntrada: metadadosIA.tokensEntrada ?? null,
                tokensSaida: metadadosIA.tokensSaida ?? null,
              });
            } else {
              controleUsoIA.registrarFalhaUsoReal(usoId, "resposta_nao_recebida");
            }
          } else {
            controleUsoIA.cancelarReservaUsoReal(usoId);
          }
          usoEncerrado = true;
        }
      }

      const relatorioIA = resultado.relatorio;

      db.prepare(
        [
          "INSERT INTO relatorios (",
          "ocorrencia_id, resumo, hipotese, evidencias, testes_sugeridos, modo,",
          "informacoes, hipoteses, confianca, status_investigacao, testes_priorizados",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      ).run(
        id,
        relatorioIA.resumo,
        relatorioIA.hipoteses?.[0] || "Nenhuma hipótese gerada.",
        JSON.stringify(relatorioIA.evidencias || []),
        JSON.stringify(relatorioIA.testes || []),
        relatorioIA.modo,
        JSON.stringify(relatorioIA.informacoes || {}),
        JSON.stringify(relatorioIA.hipoteses || []),
        relatorioIA.confianca || "Não definida",
        relatorioIA.status || "Em validação",
        JSON.stringify(relatorioIA.testes_priorizados || []),
      );

      return res.json({
        mensagem: "Análise realizada e salva com sucesso!",
        analise: resultado.analise,
        relatorio: resultado.relatorio,
      });
    } catch (erro) {
      if (intervaloRenovacao) pararIntervalo(intervaloRenovacao);

      if (usoId && !usoEncerrado) {
        try {
          if (chamadaRealIniciada) {
            controleUsoIA.registrarFalhaUsoReal(usoId, codigoErroSeguro(erro));
          } else {
            controleUsoIA.cancelarReservaUsoReal(usoId);
          }
        } catch {
          // A reserva pode já ter sido finalizada; não registrar detalhes da falha.
        }
      }

      console.error("Erro ao processar análise de IA:", codigoErroSeguro(erro) || "erro_interno");
      return res.status(500).json({
        erro: "Falha na comunicação com a inteligência artificial.",
      });
    }
  });

  router.get("/historico/:id", (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          erro: "ID inválido.",
        });
      }

      const ocorrencia = db
        .prepare("SELECT id FROM ocorrencias WHERE id = ?")
        .get(id);

      if (!ocorrencia) {
        return res.status(404).json({
          erro: "Ocorrência não encontrada.",
        });
      }

      const analises = db
        .prepare(
          [
            "SELECT * FROM relatorios",
            "WHERE ocorrencia_id = ? AND modo IS NOT NULL",
            "ORDER BY id DESC",
          ].join(" "),
        )
        .all(id);

      const historico = analises.map((analise) => {
        const evidencias = lerJson(analise.evidencias, [], ehArray);
        const informacoes = lerJson(analise.informacoes, {}, ehObjeto);
        if (analise.modo === "SIMULADO" && evidencias.length) {
          const relatosAnteriores = Array.isArray(informacoes.relatoLegado)
            ? informacoes.relatoLegado
            : [];
          informacoes.relatoLegado = [...relatosAnteriores, ...evidencias];
          evidencias.length = 0;
        }

        return {
          ...analise,
          evidencias,
          testes_sugeridos: lerJson(analise.testes_sugeridos, [], ehArray),
          informacoes,
          hipoteses: lerJson(analise.hipoteses, [], ehArray),
          testes_priorizados: lerJson(analise.testes_priorizados, [], ehArray),
        };
      });

      return res.json({
        ocorrencia_id: id,
        total: historico.length,
        historico,
      });
    } catch (erro) {
      console.error("Erro ao buscar histórico:", erro);
      return res.status(500).json({
        erro: "Erro ao carregar histórico de análises.",
      });
    }
  });

  return router;
}

const router = criarRouterIA();
router.criarRouterIA = criarRouterIA;

module.exports = router;

