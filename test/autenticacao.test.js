const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-auth-unit-"));
process.env.DATABASE_PATH = path.join(diretorioTemporario, "teste.db");

const db = require("../database/database");
const {
  criarHashSenha,
  normalizarNomeUsuario,
  validarNomeUsuario,
  validarSenha,
  verificarSenha,
} = require("../services/autenticacao");

after(() => {
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

test("normaliza e valida nomes de usuário", () => {
  assert.equal(normalizarNomeUsuario("  Equipe.A  "), "equipe.a");
  assert.equal(validarNomeUsuario("admin"), true);
  assert.equal(validarNomeUsuario("ab"), false);
  assert.equal(validarNomeUsuario("nome com espaço"), false);
});

test("aplica o mínimo de seis caracteres a senhas temporárias", () => {
  assert.equal(validarSenha("123456"), true);
  assert.equal(validarSenha("12345"), false);
  assert.equal(validarSenha("x".repeat(129)), false);
});

test("hash usa salt individual e verifica a senha", async () => {
  const primeiro = await criarHashSenha("uma senha de teste longa");
  const segundo = await criarHashSenha("uma senha de teste longa");
  assert.notEqual(primeiro.salt, segundo.salt);
  assert.notEqual(primeiro.hash, segundo.hash);
  assert.equal(await verificarSenha("uma senha de teste longa", primeiro.salt, primeiro.hash), true);
  assert.equal(await verificarSenha("senha incorreta", primeiro.salt, primeiro.hash), false);
});
