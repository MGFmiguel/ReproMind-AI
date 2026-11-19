const crypto = require("node:crypto");
const bancoPadrao = require("../database/connection");
const { normalizarNomeUsuario } = require("./autenticacao");

const MAX_TENTATIVAS_POR_CREDENCIAL = 10;
const MAX_TENTATIVAS_POR_IP = 50;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;

function hashChave(valor) {
  return crypto.createHash("sha256").update(valor).digest("hex");
}

function criarControleTentativasLogin({ db = bancoPadrao, relogio = Date.now } = {}) {
  function obterChaves(ip, nomeUsuario) {
    const credencial = `${ip}\u0000${normalizarNomeUsuario(nomeUsuario)}`;
    return [
      { escopo: "credencial", chaveHash: hashChave(credencial), limite: MAX_TENTATIVAS_POR_CREDENCIAL },
      { escopo: "ip", chaveHash: hashChave(ip), limite: MAX_TENTATIVAS_POR_IP },
    ];
  }

  async function obterTempoBloqueio(ip, nomeUsuario) {
    const agora = relogio();
    await db.prepare("DELETE FROM tentativas_login WHERE inicio <= ?")
      .run(agora - JANELA_TENTATIVAS_MS);

    const chaves = obterChaves(ip, nomeUsuario);
    const tentativas = await db.prepare(`
      SELECT escopo, chave_hash, inicio, quantidade
      FROM tentativas_login
      WHERE (escopo = ? AND chave_hash = ?) OR (escopo = ? AND chave_hash = ?)
    `).all(chaves[0].escopo, chaves[0].chaveHash, chaves[1].escopo, chaves[1].chaveHash);

    const esperas = [];
    for (const chave of chaves) {
      const atual = tentativas.find((item) => item.escopo === chave.escopo && item.chave_hash === chave.chaveHash);
      if (atual && atual.quantidade >= chave.limite) {
        esperas.push(atual.inicio + JANELA_TENTATIVAS_MS - agora);
      }
    }
    return esperas.length ? Math.ceil(Math.max(...esperas) / 1000) : 0;
  }

  const sqlIncrementar = `
    INSERT INTO tentativas_login (escopo, chave_hash, inicio, quantidade)
    VALUES (?, ?, ?, 1)
    ON CONFLICT (escopo, chave_hash) DO UPDATE SET
      inicio = CASE
        WHEN tentativas_login.inicio + ? <= ? THEN excluded.inicio
        ELSE tentativas_login.inicio
      END,
      quantidade = CASE
        WHEN tentativas_login.inicio + ? <= ? THEN 1
        ELSE tentativas_login.quantidade + 1
      END
  `;

  function registrarFalhaLogin(ip, nomeUsuario) {
    const agora = relogio();
    const chaves = obterChaves(ip, nomeUsuario);

    if (db.dialect === "postgres") {
      return db.transaction(async (tx) => {
        await tx.prepare("SELECT pg_advisory_xact_lock(?)").get(0x52504d4c4f47);
        await tx.prepare("DELETE FROM tentativas_login WHERE inicio <= ?")
          .run(agora - JANELA_TENTATIVAS_MS);
        for (const chave of chaves) {
          await tx.prepare(sqlIncrementar).run(
            chave.escopo,
            chave.chaveHash,
            agora,
            JANELA_TENTATIVAS_MS,
            agora,
            JANELA_TENTATIVAS_MS,
            agora,
          );
        }
      })();
    }

    const transacao = db.transaction(() => {
      db.prepare("DELETE FROM tentativas_login WHERE inicio <= ?")
        .run(agora - JANELA_TENTATIVAS_MS);
      for (const chave of chaves) {
        db.prepare(sqlIncrementar).run(
          chave.escopo,
          chave.chaveHash,
          agora,
          JANELA_TENTATIVAS_MS,
          agora,
          JANELA_TENTATIVAS_MS,
          agora,
        );
      }
    });
    return transacao.immediate();
  }

  function limparTentativasCredencial(ip, nomeUsuario) {
    const chave = obterChaves(ip, nomeUsuario)[0];
    return db.prepare(`
      DELETE FROM tentativas_login WHERE escopo = ? AND chave_hash = ?
    `).run(chave.escopo, chave.chaveHash);
  }

  return { obterTempoBloqueio, registrarFalhaLogin, limparTentativasCredencial };
}

module.exports = { criarControleTentativasLogin };
