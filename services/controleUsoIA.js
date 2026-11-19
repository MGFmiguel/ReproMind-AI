const crypto = require("node:crypto");
const bancoPadrao = require("../database/connection");

const JANELA_HORA_MS = 60 * 60 * 1000;
const JANELA_DIA_MS = 24 * 60 * 60 * 1000;
const STATUS_QUE_CONTA_COTA = "'reservada', 'concluida', 'falhou', 'expirada'";

function lerInteiroPositivo(env, nome, padrao) {
  const valor = env[nome];
  if (valor === undefined || valor === "") return padrao;

  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new TypeError(`${nome} deve ser um numero inteiro positivo.`);
  }
  return numero;
}

function carregarConfiguracao(env = process.env) {
  return {
    limiteUsuarioHora: lerInteiroPositivo(env, "IA_LIMITE_USUARIO_HORA", 10),
    limiteUsuarioDia: lerInteiroPositivo(env, "IA_LIMITE_USUARIO_DIA", 30),
    limiteGlobalDia: lerInteiroPositivo(env, "IA_LIMITE_GLOBAL_DIA", 100),
    maxConcorrenciaUsuario: lerInteiroPositivo(env, "IA_MAX_CONCORRENCIA_USUARIO", 1),
    maxConcorrenciaGlobal: lerInteiroPositivo(env, "IA_MAX_CONCORRENCIA_GLOBAL", 2),
    ttlReservaMs: lerInteiroPositivo(env, "IA_RESERVA_TTL_MINUTOS", 15) * 60 * 1000,
  };
}

function validarConfiguracao(configuracao) {
  const nomes = [
    "limiteUsuarioHora",
    "limiteUsuarioDia",
    "limiteGlobalDia",
    "maxConcorrenciaUsuario",
    "maxConcorrenciaGlobal",
    "ttlReservaMs",
  ];
  for (const nome of nomes) {
    if (!Number.isSafeInteger(configuracao[nome]) || configuracao[nome] < 1) {
      throw new TypeError(`A configuracao ${nome} deve ser um numero inteiro positivo.`);
    }
  }
}

function validarId(valor, nome) {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new TypeError(`${nome} deve ser um identificador inteiro positivo.`);
  }
}

function validarFingerprint(valor) {
  if (typeof valor !== "string" || !/^[a-f0-9]{64}$/i.test(valor)) {
    throw new TypeError("A fingerprint da entrada deve ser um SHA-256 hexadecimal.");
  }
  return valor.toLowerCase();
}

function validarTokens(valor, nome) {
  if (valor === undefined || valor === null) return null;
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new TypeError(`${nome} deve ser um inteiro maior ou igual a zero.`);
  }
  return valor;
}

function criarControleUsoIAPostgres({ db, configuracao, relogio }) {
  function obterAgora() {
    const agora = relogio();
    if (!Number.isSafeInteger(agora) || agora < 0) {
      throw new TypeError("O relogio deve retornar milissegundos desde epoch.");
    }
    return agora;
  }

  async function reservarUsoReal({ usuarioId, ocorrenciaId, fingerprintEntrada, modelo = null }) {
    validarId(usuarioId, "usuarioId");
    validarId(ocorrenciaId, "ocorrenciaId");
    const fingerprint = validarFingerprint(fingerprintEntrada);
    if (modelo !== null && (typeof modelo !== "string" || modelo.length > 100)) {
      throw new TypeError("O modelo deve ter no maximo 100 caracteres.");
    }

    return db.transaction(async (tx) => {
      // Serializa reservas em diferentes instancias serverless para que cotas e
      // limites globais de concorrencia sejam verificados atomicamente.
      await tx.prepare("SELECT pg_advisory_xact_lock(?)").get(0x52504d494e44);
      const agora = obterAgora();
      const reservadaAte = agora + configuracao.ttlReservaMs;
      if (!Number.isSafeInteger(reservadaAte)) {
        throw new RangeError("O prazo da reserva excede o intervalo suportado.");
      }

      await tx.prepare(`
        UPDATE ia_usos_reais
        SET status = 'expirada', finalizada_em = ?, reservada_ate = NULL
        WHERE status = 'reservada'
          AND (reservada_ate <= ? OR (reservada_ate IS NULL AND solicitada_em <= ?))
      `).run(agora, agora, agora - configuracao.ttlReservaMs);

      const usuario = await tx.prepare(`
        SELECT id FROM usuarios WHERE id = ? AND ativo = 1
      `).get(usuarioId);
      if (!usuario) return { permitida: false, motivo: "usuario_inativo_ou_inexistente" };

      const ocorrencia = await tx.prepare("SELECT id FROM ocorrencias WHERE id = ?").get(ocorrenciaId);
      if (!ocorrencia) return { permitida: false, motivo: "ocorrencia_inexistente" };

      const reservaDuplicada = await tx.prepare(`
        SELECT id FROM ia_usos_reais
        WHERE ocorrencia_id = ? AND fingerprint_entrada = ?
          AND status = 'reservada'
      `).get(ocorrenciaId, fingerprint);
      if (reservaDuplicada) {
        return { permitida: false, motivo: "duplicada", usoId: reservaDuplicada.id };
      }

      const usosUsuarioHora = (await tx.prepare(`
        SELECT COUNT(*) AS total FROM ia_usos_reais
        WHERE usuario_id = ? AND solicitada_em >= ?
          AND status IN (${STATUS_QUE_CONTA_COTA})
      `).get(usuarioId, agora - JANELA_HORA_MS)).total;
      if (usosUsuarioHora >= configuracao.limiteUsuarioHora) {
        return { permitida: false, motivo: "limite_usuario_hora", usado: usosUsuarioHora, limite: configuracao.limiteUsuarioHora };
      }

      const usosUsuarioDia = (await tx.prepare(`
        SELECT COUNT(*) AS total FROM ia_usos_reais
        WHERE usuario_id = ? AND solicitada_em >= ?
          AND status IN (${STATUS_QUE_CONTA_COTA})
      `).get(usuarioId, agora - JANELA_DIA_MS)).total;
      if (usosUsuarioDia >= configuracao.limiteUsuarioDia) {
        return { permitida: false, motivo: "limite_usuario_dia", usado: usosUsuarioDia, limite: configuracao.limiteUsuarioDia };
      }

      const usosGlobaisDia = (await tx.prepare(`
        SELECT COUNT(*) AS total FROM ia_usos_reais
        WHERE solicitada_em >= ? AND status IN (${STATUS_QUE_CONTA_COTA})
      `).get(agora - JANELA_DIA_MS)).total;
      if (usosGlobaisDia >= configuracao.limiteGlobalDia) {
        return { permitida: false, motivo: "limite_global_dia", usado: usosGlobaisDia, limite: configuracao.limiteGlobalDia };
      }

      const usosUsuarioAtivos = (await tx.prepare(`
        SELECT COUNT(*) AS total FROM ia_usos_reais
        WHERE usuario_id = ? AND status = 'reservada'
      `).get(usuarioId)).total;
      if (usosUsuarioAtivos >= configuracao.maxConcorrenciaUsuario) {
        return { permitida: false, motivo: "concorrencia_usuario", usado: usosUsuarioAtivos, limite: configuracao.maxConcorrenciaUsuario };
      }

      const usosGlobaisAtivos = (await tx.prepare(`
        SELECT COUNT(*) AS total FROM ia_usos_reais WHERE status = 'reservada'
      `).get()).total;
      if (usosGlobaisAtivos >= configuracao.maxConcorrenciaGlobal) {
        return { permitida: false, motivo: "concorrencia_global", usado: usosGlobaisAtivos, limite: configuracao.maxConcorrenciaGlobal };
      }

      const resultado = await tx.prepare(`
        INSERT INTO ia_usos_reais (
          usuario_id, ocorrencia_id, fingerprint_entrada, status, modelo, solicitada_em, reservada_ate
        ) VALUES (?, ?, ?, 'reservada', ?, ?, ?)
      `).run(usuarioId, ocorrenciaId, fingerprint, modelo, agora, reservadaAte);

      return { permitida: true, usoId: Number(resultado.lastInsertRowid), status: "reservada" };
    })();
  }

  async function renovarReservaUsoReal(usoId) {
    validarId(usoId, "usoId");
    const agora = obterAgora();
    const reservadaAte = agora + configuracao.ttlReservaMs;
    if (!Number.isSafeInteger(reservadaAte)) {
      throw new RangeError("O prazo da reserva excede o intervalo suportado.");
    }
    const resultado = await db.prepare(`
      UPDATE ia_usos_reais
      SET reservada_ate = ?
      WHERE id = ? AND status = 'reservada'
        AND (reservada_ate > ? OR (reservada_ate IS NULL AND solicitada_em > ?))
    `).run(reservadaAte, usoId, agora, agora - configuracao.ttlReservaMs);
    if (resultado.changes !== 1) {
      return { renovada: false, motivo: "reserva_expirada_ou_encerrada" };
    }
    return { renovada: true, usoId, reservadaAte };
  }

  async function atualizarReserva(usoId, status, campos = {}) {
    validarId(usoId, "usoId");
    const resultado = await db.prepare(`
      UPDATE ia_usos_reais
      SET status = ?, finalizada_em = ?, reservada_ate = NULL,
          modelo = COALESCE(?, modelo),
          tokens_entrada = ?, tokens_saida = ?, codigo_erro = ?
      WHERE id = ? AND status = 'reservada'
    `).run(
      status,
      obterAgora(),
      campos.modelo ?? null,
      campos.tokensEntrada ?? null,
      campos.tokensSaida ?? null,
      campos.codigoErro ?? null,
      usoId,
    );
    if (resultado.changes !== 1) throw new Error("A reserva nao existe ou ja foi encerrada.");
    return { usoId, status };
  }

  function concluirUsoReal(usoId, { modelo = null, tokensEntrada = null, tokensSaida = null } = {}) {
    if (modelo !== null && (typeof modelo !== "string" || modelo.length > 100)) {
      throw new TypeError("O modelo deve ter no maximo 100 caracteres.");
    }
    return atualizarReserva(usoId, "concluida", {
      modelo,
      tokensEntrada: validarTokens(tokensEntrada, "tokensEntrada"),
      tokensSaida: validarTokens(tokensSaida, "tokensSaida"),
    });
  }

  function registrarFalhaUsoReal(usoId, codigoErro = null) {
    const codigoSeguro = typeof codigoErro === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(codigoErro)
      ? codigoErro
      : null;
    return atualizarReserva(usoId, "falhou", { codigoErro: codigoSeguro });
  }

  function cancelarReservaUsoReal(usoId) {
    return atualizarReserva(usoId, "cancelada");
  }

  return {
    configuracao: { ...configuracao },
    reservarUsoReal,
    renovarReservaUsoReal,
    concluirUsoReal,
    registrarFalhaUsoReal,
    cancelarReservaUsoReal,
  };
}

function calcularFingerprintEntrada({ ocorrencia, respostas, modelo, contexto = null }) {
  if (!ocorrencia || typeof ocorrencia !== "object" || Array.isArray(ocorrencia)) {
    throw new TypeError("A ocorrencia da analise e obrigatoria.");
  }
  if (!Array.isArray(respostas)) {
    throw new TypeError("As respostas da analise devem ser uma lista.");
  }

  const ocorrenciaOrdenada = Object.fromEntries(
    Object.keys(ocorrencia).sort().map((chave) => [chave, ocorrencia[chave]]),
  );
  const respostasNormalizadas = respostas.map((item) => ({
    pergunta: item?.pergunta ?? null,
    resposta: item?.resposta ?? null,
  }));
  const entrada = JSON.stringify({
    modelo: modelo || null,
    contexto,
    ocorrencia: ocorrenciaOrdenada,
    respostas: respostasNormalizadas,
  });
  return crypto.createHash("sha256").update(entrada).digest("hex");
}

function criarControleUsoIA({ db = bancoPadrao, configuracao = carregarConfiguracao(), relogio = Date.now } = {}) {
  validarConfiguracao(configuracao);
  if (db.dialect === "postgres") {
    return criarControleUsoIAPostgres({ db, configuracao, relogio });
  }

  function obterAgora() {
    const agora = relogio();
    if (!Number.isSafeInteger(agora) || agora < 0) {
      throw new TypeError("O relogio deve retornar milissegundos desde epoch.");
    }
    return agora;
  }

  const reservarTransacao = db.transaction((dados) => {
    const agora = obterAgora();
    const reservadaAte = agora + configuracao.ttlReservaMs;
    if (!Number.isSafeInteger(reservadaAte)) throw new RangeError("O prazo da reserva excede o intervalo suportado.");

    db.prepare(`
      UPDATE ia_usos_reais
      SET status = 'expirada', finalizada_em = ?, reservada_ate = NULL
      WHERE status = 'reservada'
        AND (reservada_ate <= ? OR (reservada_ate IS NULL AND solicitada_em <= ?))
    `).run(agora, agora, agora - configuracao.ttlReservaMs);

    const usuario = db.prepare(`
      SELECT id FROM usuarios WHERE id = ? AND ativo = 1
    `).get(dados.usuarioId);
    if (!usuario) return { permitida: false, motivo: "usuario_inativo_ou_inexistente" };

    const ocorrencia = db.prepare("SELECT id FROM ocorrencias WHERE id = ?").get(dados.ocorrenciaId);
    if (!ocorrencia) return { permitida: false, motivo: "ocorrencia_inexistente" };

    const reservaDuplicada = db.prepare(`
      SELECT id FROM ia_usos_reais
      WHERE ocorrencia_id = ? AND fingerprint_entrada = ?
        AND status = 'reservada'
    `).get(dados.ocorrenciaId, dados.fingerprintEntrada);
    if (reservaDuplicada) {
      return { permitida: false, motivo: "duplicada", usoId: reservaDuplicada.id };
    }

    const usosUsuarioHora = db.prepare(`
      SELECT COUNT(*) AS total FROM ia_usos_reais
      WHERE usuario_id = ? AND solicitada_em >= ?
        AND status IN (${STATUS_QUE_CONTA_COTA})
    `).get(dados.usuarioId, agora - JANELA_HORA_MS).total;
    if (usosUsuarioHora >= configuracao.limiteUsuarioHora) {
      return { permitida: false, motivo: "limite_usuario_hora", usado: usosUsuarioHora, limite: configuracao.limiteUsuarioHora };
    }

    const usosUsuarioDia = db.prepare(`
      SELECT COUNT(*) AS total FROM ia_usos_reais
      WHERE usuario_id = ? AND solicitada_em >= ?
        AND status IN (${STATUS_QUE_CONTA_COTA})
    `).get(dados.usuarioId, agora - JANELA_DIA_MS).total;
    if (usosUsuarioDia >= configuracao.limiteUsuarioDia) {
      return { permitida: false, motivo: "limite_usuario_dia", usado: usosUsuarioDia, limite: configuracao.limiteUsuarioDia };
    }

    const usosGlobaisDia = db.prepare(`
      SELECT COUNT(*) AS total FROM ia_usos_reais
      WHERE solicitada_em >= ? AND status IN (${STATUS_QUE_CONTA_COTA})
    `).get(agora - JANELA_DIA_MS).total;
    if (usosGlobaisDia >= configuracao.limiteGlobalDia) {
      return { permitida: false, motivo: "limite_global_dia", usado: usosGlobaisDia, limite: configuracao.limiteGlobalDia };
    }

    const usosUsuarioAtivos = db.prepare(`
      SELECT COUNT(*) AS total FROM ia_usos_reais
      WHERE usuario_id = ? AND status = 'reservada'
    `).get(dados.usuarioId).total;
    if (usosUsuarioAtivos >= configuracao.maxConcorrenciaUsuario) {
      return { permitida: false, motivo: "concorrencia_usuario", usado: usosUsuarioAtivos, limite: configuracao.maxConcorrenciaUsuario };
    }

    const usosGlobaisAtivos = db.prepare(`
      SELECT COUNT(*) AS total FROM ia_usos_reais WHERE status = 'reservada'
    `).get().total;
    if (usosGlobaisAtivos >= configuracao.maxConcorrenciaGlobal) {
      return { permitida: false, motivo: "concorrencia_global", usado: usosGlobaisAtivos, limite: configuracao.maxConcorrenciaGlobal };
    }

    const resultado = db.prepare(`
      INSERT INTO ia_usos_reais (
        usuario_id, ocorrencia_id, fingerprint_entrada, status, modelo, solicitada_em, reservada_ate
      ) VALUES (?, ?, ?, 'reservada', ?, ?, ?)
    `).run(
      dados.usuarioId,
      dados.ocorrenciaId,
      dados.fingerprintEntrada,
      dados.modelo,
      agora,
      reservadaAte,
    );

    return { permitida: true, usoId: Number(resultado.lastInsertRowid), status: "reservada" };
  });

  const renovarTransacao = db.transaction(({ usoId, agora, cutoffAntigo }) => {
    const reservadaAte = agora + configuracao.ttlReservaMs;
    if (!Number.isSafeInteger(reservadaAte)) throw new RangeError("O prazo da reserva excede o intervalo suportado.");

    const resultado = db.prepare(`
      UPDATE ia_usos_reais
      SET reservada_ate = ?
      WHERE id = ? AND status = 'reservada'
        AND (reservada_ate > ? OR (reservada_ate IS NULL AND solicitada_em > ?))
    `).run(reservadaAte, usoId, agora, cutoffAntigo);

    if (resultado.changes !== 1) {
      return { renovada: false, motivo: "reserva_expirada_ou_encerrada" };
    }
    return { renovada: true, usoId, reservadaAte };
  });

  function reservarUsoReal({ usuarioId, ocorrenciaId, fingerprintEntrada, modelo = null }) {
    validarId(usuarioId, "usuarioId");
    validarId(ocorrenciaId, "ocorrenciaId");
    const fingerprint = validarFingerprint(fingerprintEntrada);
    if (modelo !== null && (typeof modelo !== "string" || modelo.length > 100)) {
      throw new TypeError("O modelo deve ter no maximo 100 caracteres.");
    }
    return reservarTransacao.immediate({ usuarioId, ocorrenciaId, fingerprintEntrada: fingerprint, modelo });
  }

  function renovarReservaUsoReal(usoId) {
    validarId(usoId, "usoId");
    const agora = obterAgora();
    return renovarTransacao.immediate({
      usoId,
      agora,
      cutoffAntigo: agora - configuracao.ttlReservaMs,
    });
  }

  function atualizarReserva(usoId, status, campos = {}) {
    validarId(usoId, "usoId");
    const agora = obterAgora();
    const resultado = db.prepare(`
      UPDATE ia_usos_reais
      SET status = ?, finalizada_em = ?, reservada_ate = NULL,
          modelo = COALESCE(?, modelo),
          tokens_entrada = ?, tokens_saida = ?, codigo_erro = ?
      WHERE id = ? AND status = 'reservada'
    `).run(
      status,
      agora,
      campos.modelo ?? null,
      campos.tokensEntrada ?? null,
      campos.tokensSaida ?? null,
      campos.codigoErro ?? null,
      usoId,
    );
    if (resultado.changes !== 1) {
      throw new Error("A reserva nao existe ou ja foi encerrada.");
    }
    return { usoId, status };
  }

  function concluirUsoReal(usoId, { modelo = null, tokensEntrada = null, tokensSaida = null } = {}) {
    if (modelo !== null && (typeof modelo !== "string" || modelo.length > 100)) {
      throw new TypeError("O modelo deve ter no maximo 100 caracteres.");
    }
    return atualizarReserva(usoId, "concluida", {
      modelo,
      tokensEntrada: validarTokens(tokensEntrada, "tokensEntrada"),
      tokensSaida: validarTokens(tokensSaida, "tokensSaida"),
    });
  }

  function registrarFalhaUsoReal(usoId, codigoErro = null) {
    const codigoSeguro = typeof codigoErro === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(codigoErro)
      ? codigoErro
      : null;
    return atualizarReserva(usoId, "falhou", { codigoErro: codigoSeguro });
  }

  function cancelarReservaUsoReal(usoId) {
    return atualizarReserva(usoId, "cancelada");
  }

  return {
    configuracao: { ...configuracao },
    reservarUsoReal,
    renovarReservaUsoReal,
    concluirUsoReal,
    registrarFalhaUsoReal,
    cancelarReservaUsoReal,
  };
}

const controlePadrao = criarControleUsoIA();

module.exports = {
  carregarConfiguracao,
  calcularFingerprintEntrada,
  criarControleUsoIA,
  ...controlePadrao,
};
