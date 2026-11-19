const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, test } = require("node:test");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-migracao-pg-"));
const caminhoFonte = path.join(diretorioTemporario, "origem.db");
process.env.DATABASE_PATH = caminhoFonte;
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";

const db = require("../database/database");
const {
  abrirFonteSqlite,
  destinoVazio,
  executarMigracao,
  lerModo,
  lerSnapshotSqlite,
  validarProjectRef,
} = require("../scripts/migrar-sqlite-postgres");

after(() => {
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

test("a prévia lê todas as tabelas em modo somente leitura e mantém os IDs", () => {
  const usuario = db.prepare(`
    INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, ativo, deve_trocar_senha)
    VALUES ('migracao', 'hash', 'salt', 'admin', 1, 1)
  `).run();
  const ocorrencia = db.prepare(`
    INSERT INTO ocorrencias (titulo, descricao, categoria, prioridade, impacto)
    VALUES ('Falha de teste', 'Dados locais', 'Backend', 'Alta', 3)
  `).run();
  const relatorio = db.prepare(`
    INSERT INTO relatorios (ocorrencia_id, resumo, modo)
    VALUES (?, 'Resumo', 'SIMULADO')
  `).run(ocorrencia.lastInsertRowid);
  db.prepare(`
    INSERT INTO respostas_investigacao (ocorrencia_id, pergunta, resposta, ordem)
    VALUES (?, 'passos', 'Reproduzir', 1)
  `).run(ocorrencia.lastInsertRowid);
  db.prepare(`
    INSERT INTO sessoes (token_hash, usuario_id, csrf_token, expira_em)
    VALUES ('token-hash', ?, 'csrf', 9999999999999)
  `).run(usuario.lastInsertRowid);
  const fingerprint = crypto.createHash("sha256").update("entrada").digest("hex");
  db.prepare(`
    INSERT INTO ia_usos_reais (usuario_id, ocorrencia_id, fingerprint_entrada, status, solicitada_em)
    VALUES (?, ?, ?, 'concluida', 1000)
  `).run(usuario.lastInsertRowid, ocorrencia.lastInsertRowid, fingerprint);
  db.prepare(`
    INSERT INTO tentativas_login (escopo, chave_hash, inicio, quantidade)
    VALUES ('ip', ?, 1000, 1)
  `).run("a".repeat(64));

  db.prepare("UPDATE relatorios SET informacoes = ? WHERE id = ?")
    .run('{"respostas":{}}', relatorio.lastInsertRowid);
  db.close();
  const hashAntes = crypto.createHash("sha256").update(readFileSync(caminhoFonte)).digest("hex");

  const fonteSomenteLeitura = abrirFonteSqlite({ DatabaseClass: Database, caminho: caminhoFonte });
  const snapshot = lerSnapshotSqlite(fonteSomenteLeitura);
  fonteSomenteLeitura.close();
  const hashDepois = crypto.createHash("sha256").update(readFileSync(caminhoFonte)).digest("hex");

  assert.equal(hashDepois, hashAntes);
  assert.equal(snapshot.usuarios[0].id, 1);
  assert.equal(snapshot.ocorrencias[0].impacto, 3);
  assert.equal(snapshot.relatorios[0].modo, "SIMULADO");
  assert.equal(snapshot.respostas_investigacao[0].resposta, "Reproduzir");
  assert.equal(snapshot.sessoes[0].usuario_id, 1);
  assert.equal(snapshot.ia_usos_reais[0].fingerprint_entrada, fingerprint);
  assert.equal(snapshot.tentativas_login[0].chave_hash, "a".repeat(64));
});

test("a prévia não grava no destino e a importação exige banco vazio", async () => {
  let consultas = 0;
  const destino = {
    prepare: () => ({ get: async () => { consultas += 1; return { total: 0 }; } }),
  };
  const preview = await executarMigracao({ db: destino, snapshot: {}, aplicar: false });
  assert.equal(preview.aplicada, false);
  assert.equal(preview.destinoVazio, true);
  assert.equal(consultas, 7);
  assert.equal(destinoVazio(preview.contagens), true);

  const destinoComDados = {
    prepare: () => ({ get: async () => ({ total: 1 }) }),
  };
  await assert.rejects(
    executarMigracao({ db: destinoComDados, snapshot: {}, aplicar: true }),
    /já contém registros/,
  );
});

test("o comando só aceita modos explícitos de prévia ou importação", () => {
  assert.equal(lerModo([]), false);
  assert.equal(lerModo(["--dry-run"]), false);
  assert.equal(lerModo(["--apply"]), true);
  assert.throws(() => lerModo(["--apply", "--dry-run"]), /Use apenas/);
});

test("o importador rejeita uma URL de outro projeto Supabase", () => {
  const referencia = "prtwxspjfsnbzchrersb";
  assert.doesNotThrow(() => validarProjectRef(
    `postgresql://postgres.${referencia}:senha@pooler.supabase.com:6543/postgres?sslmode=require`,
    referencia,
  ));
  assert.throws(() => validarProjectRef(
    "postgresql://postgres.outroprojeto:senha@pooler.supabase.com:6543/postgres?sslmode=require",
    referencia,
  ), /não corresponde/);
});
