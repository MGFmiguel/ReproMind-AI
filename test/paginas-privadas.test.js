const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, readdirSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-pages-"));
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

test("páginas HTML ficam fora do diretório público", () => {
  const paginasPublicas = readdirSync(path.join(__dirname, "../public"))
    .filter((arquivo) => arquivo.toLowerCase().endsWith(".html"));
  assert.deepEqual(paginasPublicas, []);
});

test("páginas privadas exigem sessão e o login continua acessível", async () => {
  servidor = app.listen(0, "127.0.0.1");
  await new Promise((resolver, rejeitar) => {
    servidor.once("listening", resolver);
    servidor.once("error", rejeitar);
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const dashboard = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get("location"), "/login.html?next=%2F");

  const investigacao = await fetch(`${base}/investigacao.html`, { redirect: "manual" });
  assert.equal(investigacao.status, 302);
  assert.match(investigacao.headers.get("location"), /\/login\.html/);

  const senha = await fetch(`${base}/alterar-senha.html`, { redirect: "manual" });
  assert.equal(senha.status, 302);
  assert.equal(senha.headers.get("location"), "/login.html");

  const login = await fetch(`${base}/login.html`);
  assert.equal(login.status, 200);
  assert.match(login.headers.get("content-type"), /text\/html/);

  const arquivoQueAntesEraPublico = await fetch(`${base}/index.html`, { redirect: "manual" });
  assert.equal(arquivoQueAntesEraPublico.status, 302);
});
