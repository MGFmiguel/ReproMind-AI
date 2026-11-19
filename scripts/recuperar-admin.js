const path = require("node:path");
const readline = require("node:readline");
const { createInterface } = require("node:readline/promises");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

let dependencias;

function obterDependencias() {
  if (!dependencias) {
    const db = require("../database/connection");
    const autenticacao = require("../services/autenticacao");
    dependencias = { db, autenticacao };
  }
  return dependencias;
}

function listarAdminsAtivos(db) {
  return db.prepare(`
    SELECT id, nome_usuario
    FROM usuarios
    WHERE papel = 'admin' AND ativo = 1
    ORDER BY LOWER(nome_usuario)
  `).all();
}

async function recuperarAdmin({ db, autenticacao }, nomeUsuario, senhaTemporaria, confirmacao) {
  if (!autenticacao.validarSenha(senhaTemporaria)) {
    throw new Error("A senha temporária deve ter de 6 a 128 caracteres.");
  }
  if (senhaTemporaria !== confirmacao) {
    throw new Error("As senhas informadas não coincidem. Nenhuma alteração foi feita.");
  }

  const nomeNormalizado = autenticacao.normalizarNomeUsuario(nomeUsuario);
  const usuario = await db.prepare(`
    SELECT id, nome_usuario, papel, ativo
    FROM usuarios
    WHERE LOWER(nome_usuario) = ?
  `).get(nomeNormalizado);

  if (!usuario) throw new Error("Conta não encontrada.");
  if (usuario.papel !== "admin") {
    throw new Error("Somente uma conta existente com papel admin pode ser recuperada.");
  }
  if (!usuario.ativo) {
    throw new Error("A conta admin está desativada e não pode ser recuperada por este comando.");
  }

  const credencial = await autenticacao.criarHashSenha(senhaTemporaria);
  if (db.dialect === "postgres") {
    await db.transaction(async (tx) => {
      const resultado = await tx.prepare(`
        UPDATE usuarios
        SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1
        WHERE id = ? AND papel = 'admin' AND ativo = 1
      `).run(credencial.hash, credencial.salt, usuario.id);
      if (resultado.changes !== 1) {
        throw new Error("A conta admin mudou durante a recuperacao. Nenhuma alteracao foi feita.");
      }
      await autenticacao.revogarSessoesUsuario(usuario.id, tx);
    })();
    return usuario.nome_usuario;
  }

  const redefinir = db.transaction(() => {
    const resultado = db.prepare(`
      UPDATE usuarios
      SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1
      WHERE id = ? AND papel = 'admin' AND ativo = 1
    `).run(credencial.hash, credencial.salt, usuario.id);

    if (resultado.changes !== 1) {
      throw new Error("A conta admin mudou durante a recuperação. Nenhuma alteração foi feita.");
    }
    autenticacao.revogarSessoesUsuario(usuario.id);
  });
  redefinir();

  return usuario.nome_usuario;
}

function solicitarSenhaOculta(pergunta, entrada = process.stdin, saida = process.stdout) {
  if (!entrada.isTTY || typeof entrada.setRawMode !== "function") {
    return Promise.reject(new Error("Execute este comando em um terminal interativo."));
  }

  readline.emitKeypressEvents(entrada);
  return new Promise((resolver, rejeitar) => {
    let senha = "";
    let concluido = false;

    const finalizar = (erro) => {
      if (concluido) return;
      concluido = true;
      entrada.off("keypress", aoPressionarTecla);
      entrada.setRawMode(false);
      entrada.pause();
      saida.write("\n");
      if (erro) rejeitar(erro);
      else resolver(senha);
    };

    const aoPressionarTecla = (texto, tecla = {}) => {
      if (tecla.ctrl && tecla.name === "c") {
        finalizar(new Error("Operação cancelada."));
      } else if (tecla.ctrl && tecla.name === "d") {
        finalizar(new Error("Entrada encerrada."));
      } else if (["return", "enter"].includes(tecla.name) || texto === "\r" || texto === "\n") {
        finalizar();
      } else if (tecla.name === "backspace") {
        senha = Array.from(senha).slice(0, -1).join("");
      } else if (!tecla.ctrl && !tecla.meta && typeof texto === "string") {
        senha += texto;
      }
    };

    saida.write(pergunta);
    entrada.resume();
    entrada.setRawMode(true);
    entrada.on("keypress", aoPressionarTecla);
  });
}

async function executar() {
  if (process.argv.length > 2) {
    throw new Error("Este comando não aceita argumentos. Selecione a conta e informe as senhas interativamente.");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Execute este comando em um terminal interativo.");
  }

  const { db, autenticacao } = obterDependencias();
  try {
    const admins = await listarAdminsAtivos(db);
    if (!admins.length) {
      throw new Error("Não há contas admin ativas disponíveis para recuperação.");
    }

    console.log("Contas admin ativas disponíveis:");
    for (const admin of admins) console.log(`- ${admin.nome_usuario}`);

    const interface = createInterface({ input: process.stdin, output: process.stdout });
    let nomeUsuario;
    try {
      nomeUsuario = await interface.question("Nome da conta admin a recuperar: ");
    } finally {
      interface.close();
    }

    const senhaTemporaria = await solicitarSenhaOculta("Nova senha temporária: ");
    const confirmacao = await solicitarSenhaOculta("Confirme a senha temporária: ");
    const usuarioRecuperado = await recuperarAdmin(
      { db, autenticacao },
      nomeUsuario,
      senhaTemporaria,
      confirmacao,
    );

    console.log(`Senha temporária definida para ${usuarioRecuperado}. No próximo login, será necessário trocá-la.`);
  } finally {
    if (db.open || db.dialect === "postgres") await db.close();
  }
}

if (require.main === module) {
  executar().catch((erro) => {
    console.error(`Falha na recuperacao: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  executar,
  listarAdminsAtivos,
  obterDependencias,
  recuperarAdmin,
  solicitarSenhaOculta,
};
