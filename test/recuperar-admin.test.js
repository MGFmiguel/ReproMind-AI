const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { EventEmitter } = require("node:events");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-recuperar-admin-"));
const caminhoBancoTemporario = path.join(diretorioTemporario, "teste.db");
process.env.DATABASE_PATH = caminhoBancoTemporario;

const {
  listarAdminsAtivos,
  obterDependencias,
  recuperarAdmin,
  solicitarSenhaOculta,
  executar,
} = require("../scripts/recuperar-admin");
const dependencias = obterDependencias();
const { db, autenticacao } = dependencias;

after(() => {
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

async function criarUsuario(nomeUsuario, senha, papel = "membro", ativo = 1) {
  const credencial = await autenticacao.criarHashSenha(senha);
  const resultado = db.prepare(`
    INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, ativo, deve_trocar_senha)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(nomeUsuario, credencial.hash, credencial.salt, papel, ativo);
  return { id: Number(resultado.lastInsertRowid), ...credencial };
}

test("recupera somente admin ativo e preserva o banco e as demais contas", async (t) => {
  const bancoPrincipal = db.pragma("database_list").find((banco) => banco.name === "main");
  assert.equal(path.resolve(bancoPrincipal.file), path.resolve(caminhoBancoTemporario));
  assert.notEqual(
    path.resolve(bancoPrincipal.file),
    path.resolve(__dirname, "../database/database.db"),
    "os testes precisam usar o banco temporario, nunca o banco do projeto",
  );

  const admin = await criarUsuario("admin", "senha-admin-antiga", "admin");
  const membro = await criarUsuario("membro", "senha-membro");
  const totalUsuariosAntes = db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total;
  const sessaoAdmin1 = autenticacao.criarSessao(admin.id);
  const sessaoAdmin2 = autenticacao.criarSessao(admin.id);
  const sessaoMembro = autenticacao.criarSessao(membro.id);
  const membroAntes = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(membro.id);

  await t.test("lista somente administradores ativos", () => {
    assert.deepEqual(listarAdminsAtivos(db).map((usuario) => usuario.nome_usuario), ["admin"]);
  });

  await t.test("recupera a conta admin, troca hash, exige nova troca e revoga apenas suas sessoes", async () => {
    assert.ok(await autenticacao.buscarUsuarioPorCredencial("admin", "senha-admin-antiga"));

    const nomeRecuperado = await recuperarAdmin(
      dependencias,
      " admin ",
      "senha-temporaria-nova",
      "senha-temporaria-nova",
    );

    assert.equal(nomeRecuperado, "admin");
    assert.equal(await autenticacao.buscarUsuarioPorCredencial("admin", "senha-admin-antiga"), null);
    const loginNovo = await autenticacao.buscarUsuarioPorCredencial("admin", "senha-temporaria-nova");
    assert.ok(loginNovo);
    assert.equal(Boolean(loginNovo.deve_trocar_senha), true);

    const adminDepois = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(admin.id);
    assert.notEqual(adminDepois.senha_hash, admin.hash);
    assert.notEqual(adminDepois.senha_salt, admin.salt);
    assert.equal(adminDepois.papel, "admin");
    assert.equal(adminDepois.ativo, 1);
    assert.equal(adminDepois.deve_trocar_senha, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total, totalUsuariosAntes);

    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sessoes WHERE usuario_id = ?").get(admin.id).total, 0);
    assert.equal(autenticacao.buscarSessao(sessaoAdmin1.token), null);
    assert.equal(autenticacao.buscarSessao(sessaoAdmin2.token), null);
    assert.ok(autenticacao.buscarSessao(sessaoMembro.token));

    const membroDepois = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(membro.id);
    assert.equal(membroDepois.senha_hash, membroAntes.senha_hash);
    assert.equal(membroDepois.senha_salt, membroAntes.senha_salt);
    assert.equal(membroDepois.deve_trocar_senha, membroAntes.deve_trocar_senha);
  });

  await t.test("recusa recuperacao de membro sem alterar conta ou sessao", async () => {
    const sessao = autenticacao.criarSessao(membro.id);
    await assert.rejects(
      recuperarAdmin(dependencias, "membro", "senha-temporaria-nova", "senha-temporaria-nova"),
      /papel admin/,
    );
    const membroDepois = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(membro.id);
    assert.equal(membroDepois.senha_hash, membroAntes.senha_hash);
    assert.equal(membroDepois.senha_salt, membroAntes.senha_salt);
    assert.ok(autenticacao.buscarSessao(sessao.token));
    assert.ok(await autenticacao.buscarUsuarioPorCredencial("membro", "senha-membro"));
  });

  await t.test("recusa conta admin desativada sem reativar nem alterar sua senha", async () => {
    const desativado = await criarUsuario("admin-inativo", "senha-inativa", "admin", 0);
    const sessao = autenticacao.criarSessao(desativado.id);
    const sessoesAntes = db.prepare("SELECT COUNT(*) AS total FROM sessoes WHERE usuario_id = ?").get(desativado.id).total;

    assert.deepEqual(listarAdminsAtivos(db).map((usuario) => usuario.nome_usuario), ["admin"]);
    await assert.rejects(
      recuperarAdmin(dependencias, "admin-inativo", "senha-temporaria-nova", "senha-temporaria-nova"),
      /desativada/,
    );

    const contaDepois = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(desativado.id);
    assert.equal(contaDepois.ativo, 0);
    assert.equal(contaDepois.senha_hash, desativado.hash);
    assert.equal(contaDepois.senha_salt, desativado.salt);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sessoes WHERE usuario_id = ?").get(desativado.id).total, sessoesAntes);
    assert.equal(autenticacao.buscarSessao(sessao.token), null);
  });

  await t.test("senhas diferentes na confirmacao sao rejeitadas antes de alterar dados", async () => {
    const segundoAdmin = await criarUsuario("admin-secundario", "senha-admin-secundario", "admin");
    const sessao = autenticacao.criarSessao(segundoAdmin.id);

    await assert.rejects(
      recuperarAdmin(dependencias, "admin-secundario", "temporaria-correta", "temporaria-diferente"),
      /não coincidem/,
    );
    const contaDepois = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(segundoAdmin.id);
    assert.equal(contaDepois.senha_hash, segundoAdmin.hash);
    assert.equal(contaDepois.senha_salt, segundoAdmin.salt);
    assert.equal(contaDepois.deve_trocar_senha, 0);
    assert.ok(autenticacao.buscarSessao(sessao.token));
  });
});

test("a entrada de senha nao a exibe no terminal", async () => {
  const entrada = new EventEmitter();
  const modosRaw = [];
  let textoExibido = "";
  entrada.isTTY = true;
  entrada.setRawMode = (modo) => modosRaw.push(modo);
  entrada.resume = () => {};
  entrada.pause = () => {};
  const saida = { write: (texto) => { textoExibido += texto; } };

  const senhaInformada = solicitarSenhaOculta("Senha: ", entrada, saida);
  entrada.emit("keypress", "s", { name: "s" });
  entrada.emit("keypress", "e", { name: "e" });
  entrada.emit("keypress", "g", { name: "g" });
  entrada.emit("keypress", "r", { name: "r" });
  entrada.emit("keypress", "e", { name: "e" });
  entrada.emit("keypress", "d", { name: "d" });
  entrada.emit("keypress", "\r", { name: "return" });

  assert.equal(await senhaInformada, "segred");
  assert.equal(textoExibido.includes("segred"), false);
  assert.deepEqual(modosRaw, [true, false]);
});

test("o comando recusa argumentos de linha de comando", async () => {
  const argumentosOriginais = process.argv.slice();
  process.argv.splice(2, process.argv.length - 2, "admin", "senha-nao-deve-ser-argumento");
  try {
    await assert.rejects(executar(), /não aceita argumentos/);
  } finally {
    process.argv.splice(0, process.argv.length, ...argumentosOriginais);
  }
});
