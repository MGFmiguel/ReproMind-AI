const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-auth-"));
process.env.DATABASE_PATH = path.join(diretorioTemporario, "teste.db");
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";

const express = require("express");
const db = require("../database/database");
const { carregarSessao } = require("../middleware/autenticacao");
const { criarHashSenha } = require("../services/autenticacao");
const rotasAuth = require("../routes/auth");

let servidor;
after(async () => {
  if (servidor?.listening) {
    await new Promise((resolver) => servidor.close(resolver));
  }
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

test("a troca de senha aguarda o token CSRF antes de enviar o formulário", async () => {
  const codigo = readFileSync(path.join(__dirname, "../public/js/senha.js"), "utf8");
  let enviarFormulario;
  let resolverSessao;
  const chamadas = [];
  const botao = { disabled: false };
  const mensagem = { textContent: "" };
  const redirecionamentos = [];
  const valores = {
    senhaAtual: { value: "senha-antiga" },
    novaSenha: { value: "senha-nova" },
    confirmacao: { value: "senha-nova" },
  };
  const sessaoAdiada = new Promise((resolver) => {
    resolverSessao = resolver;
  });
  const form = {
    querySelector: () => botao,
    addEventListener: (evento, callback) => {
      if (evento === "submit") enviarFormulario = callback;
    },
  };

  vm.runInNewContext(codigo, {
    document: {
      getElementById: (id) => id === "formSenha" ? form : id === "mensagemSenha" ? mensagem : valores[id],
    },
    fetch: (url, opcoes) => {
      chamadas.push({ url, opcoes });
      if (url === "/api/auth/me") return sessaoAdiada;
      return Promise.resolve({ ok: true, json: async () => ({ mensagem: "Senha atualizada." }) });
    },
    window: { location: { replace: (destino) => redirecionamentos.push(destino) } },
  });

  assert.equal(botao.disabled, true);
  const envio = enviarFormulario({ preventDefault() {} });
  await Promise.resolve();
  assert.equal(chamadas.length, 1, "o POST não deve ocorrer antes da resposta de /me");

  resolverSessao({ ok: true, json: async () => ({ csrfToken: "csrf-de-teste" }) });
  await envio;

  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[1].url, "/api/auth/change-password");
  assert.equal(chamadas[1].opcoes.headers["X-CSRF-Token"], "csrf-de-teste");
  assert.deepEqual(redirecionamentos, ["/"]);
});

test("login, alteração de senha, CSRF e limites de tentativas funcionam via HTTP", async () => {
  const app = express();
  app.use(express.json());
  app.use(carregarSessao);
  app.use("/api/auth", rotasAuth);

  servidor = app.listen(0, "127.0.0.1");
  await new Promise((resolver, rejeitar) => {
    servidor.once("listening", resolver);
    servidor.once("error", rejeitar);
  });
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;

  const credencial = await criarHashSenha("senha-atual");
  db.prepare(`
    INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, ativo, deve_trocar_senha)
    VALUES (?, ?, ?, 'membro', 1, 0)
  `).run("equipe", credencial.hash, credencial.salt);

  async function login(nomeUsuario, senha) {
    return fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nomeUsuario, senha }),
    });
  }

  const respostaLogin = await login("equipe", "senha-atual");
  assert.equal(respostaLogin.status, 200);
  const dadosLogin = await respostaLogin.json();
  assert.ok(dadosLogin.csrfToken);
  const cookie = respostaLogin.headers.get("set-cookie").split(";")[0];

  const respostaMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(respostaMe.status, 200);
  const dadosMe = await respostaMe.json();
  assert.equal(dadosMe.csrfToken, dadosLogin.csrfToken);

  const alteracaoSemCsrf = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ senhaAtual: "senha-atual", novaSenha: "senha-nova", confirmacao: "senha-nova" }),
  });
  assert.equal(alteracaoSemCsrf.status, 403);

  const alteracaoComCsrf = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": dadosMe.csrfToken,
    },
    body: JSON.stringify({ senhaAtual: "senha-atual", novaSenha: "senha-nova", confirmacao: "senha-nova" }),
  });
  assert.equal(alteracaoComCsrf.status, 200);
  const cookieAtualizado = alteracaoComCsrf.headers.get("set-cookie").split(";")[0];
  const meDepoisDaTroca = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieAtualizado } });
  assert.equal(meDepoisDaTroca.status, 200);
  assert.equal((await login("equipe", "senha-atual")).status, 401);
  assert.equal((await login("equipe", "senha-nova")).status, 200);

  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    assert.equal((await login("bloqueado", "incorreta")).status, 401);
  }
  const contaBloqueada = await login("bloqueado", "incorreta");
  assert.equal(contaBloqueada.status, 429);
  assert.ok(Number(contaBloqueada.headers.get("retry-after")) > 0);
  assert.equal((await login("outra-conta", "incorreta")).status, 401);

  for (let tentativa = 0; tentativa < 38; tentativa += 1) {
    assert.equal((await login(`ip-${tentativa}`, "incorreta")).status, 401);
  }
  assert.equal((await login("mais-uma-conta", "incorreta")).status, 429);

  const tentativasSalvas = db.prepare("SELECT escopo, chave_hash FROM tentativas_login").all();
  assert.ok(tentativasSalvas.length > 0);
  assert.ok(tentativasSalvas.every((tentativa) => /^[a-f0-9]{64}$/.test(tentativa.chave_hash)));
  assert.ok(!JSON.stringify(tentativasSalvas).includes("bloqueado"));
});
