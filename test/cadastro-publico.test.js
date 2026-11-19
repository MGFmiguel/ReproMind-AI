const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-cadastro-"));
process.env.DATABASE_PATH = path.join(diretorioTemporario, "teste.db");
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";
process.env.ADMIN_INITIAL_PASSWORD = "senha-temporaria-de-teste";

const app = require("../server");
const db = require("../database/database");
let servidor;

after(async () => {
  if (servidor?.listening) {
    await new Promise((resolver) => servidor.close(resolver));
  }
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

test("cadastro público valida dados e cria somente contas de membro", async () => {
  servidor = app.listen(0, "127.0.0.1");
  await new Promise((resolver, rejeitar) => {
    servidor.once("listening", resolver);
    servidor.once("error", rejeitar);
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const pagina = await fetch(`${base}/registro.html`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /id="formCadastro"/);

  async function cadastrar(dados) {
    return fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
  }

  const cadastro = await cadastrar({
    nomeUsuario: " Equipe.Nova ",
    senha: "senha-segura",
    confirmacao: "senha-segura",
    papel: "admin",
  });
  assert.equal(cadastro.status, 201);

  const usuario = db.prepare(`
    SELECT nome_usuario, senha_hash, senha_salt, papel, ativo, deve_trocar_senha
    FROM usuarios WHERE nome_usuario = ?
  `).get("equipe.nova");
  assert.equal(usuario.nome_usuario, "equipe.nova");
  assert.equal(usuario.papel, "membro");
  assert.equal(usuario.ativo, 1);
  assert.equal(usuario.deve_trocar_senha, 0);
  assert.notEqual(usuario.senha_hash, "senha-segura");
  assert.notEqual(usuario.senha_salt, "senha-segura");

  assert.equal((await cadastrar({
    nomeUsuario: "EQUIPE.NOVA",
    senha: "senha-segura",
    confirmacao: "senha-segura",
  })).status, 409);

  assert.equal((await cadastrar({
    nomeUsuario: "ab",
    senha: "senha-segura",
    confirmacao: "senha-segura",
  })).status, 400);
  assert.equal((await cadastrar({
    nomeUsuario: "usuario",
    senha: "curta",
    confirmacao: "curta",
  })).status, 400);
  assert.equal((await cadastrar({
    nomeUsuario: "usuario",
    senha: "senha-segura",
    confirmacao: "senha-diferente",
  })).status, 400);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nomeUsuario: "EQUIPE.NOVA", senha: "senha-segura" }),
  });
  assert.equal(login.status, 200);
});

test("cadastro público limita tentativas por IP", async () => {
  const base = `http://127.0.0.1:${servidor.address().port}`;
  for (let indice = 0; indice < 8; indice += 1) {
    const resposta = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nomeUsuario: `novo${indice}`,
        senha: "senha-segura",
        confirmacao: "senha-segura",
      }),
    });
    assert.equal(resposta.status, 201);
  }

  const bloqueado = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nomeUsuario: "novo-limite",
      senha: "senha-segura",
      confirmacao: "senha-segura",
    }),
  });
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get("retry-after")) > 0);
});
