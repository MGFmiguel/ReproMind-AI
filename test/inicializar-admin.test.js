const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-admin-bootstrap-"));
const nodeEnvOriginal = process.env.NODE_ENV;
const senhaInicialOriginal = process.env.ADMIN_INITIAL_PASSWORD;
process.env.DATABASE_PATH = path.join(diretorioTemporario, "teste.db");
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";

const db = require("../database/database");
const { inicializarAdmin, verificarSenha } = require("../services/autenticacao");

after(() => {
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
  if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvOriginal;
  if (senhaInicialOriginal === undefined) delete process.env.ADMIN_INITIAL_PASSWORD;
  else process.env.ADMIN_INITIAL_PASSWORD = senhaInicialOriginal;
});

test("em produção, a primeira conta exige senha configurada fora do código", async () => {
  await assert.rejects(
    inicializarAdmin({ env: { NODE_ENV: "production" } }),
    /ADMIN_INITIAL_PASSWORD/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total, 0);

  await inicializarAdmin({
    env: { NODE_ENV: "production", ADMIN_INITIAL_PASSWORD: "senha-inicial-segura" },
  });
  const admin = db.prepare(`
    SELECT nome_usuario, senha_hash, senha_salt, papel, deve_trocar_senha
    FROM usuarios WHERE nome_usuario = 'admin'
  `).get();

  assert.equal(admin.papel, "admin");
  assert.equal(admin.deve_trocar_senha, 1);
  assert.equal(await verificarSenha("senha-inicial-segura", admin.senha_salt, admin.senha_hash), true);
  assert.equal(await verificarSenha("admin", admin.senha_salt, admin.senha_hash), false);
});
