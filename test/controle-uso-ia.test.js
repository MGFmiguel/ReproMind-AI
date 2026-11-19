const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const diretorioTemporario = mkdtempSync(path.join(os.tmpdir(), "repromind-controle-ia-"));
const caminhoBancoTemporario = path.join(diretorioTemporario, "legado.db");
process.env.DATABASE_PATH = caminhoBancoTemporario;
process.env.DATABASE_DRIVER = "sqlite";
process.env.NODE_ENV = "test";

const bancoLegado = new Database(caminhoBancoTemporario);
bancoLegado.pragma("foreign_keys = ON");
bancoLegado.exec(`
  CREATE TABLE ocorrencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    categoria TEXT,
    prioridade TEXT DEFAULT 'Media',
    status TEXT DEFAULT 'Aberta',
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE relatorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocorrencia_id INTEGER NOT NULL,
    resumo TEXT,
    hipotese TEXT,
    evidencias TEXT,
    testes_sugeridos TEXT,
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id)
  );
  INSERT INTO ocorrencias (id, titulo, descricao) VALUES (1, 'Ocorrencia antiga', 'Dados existentes');
  INSERT INTO relatorios (id, ocorrencia_id, resumo) VALUES (1, 1, 'Relatorio legado');
`);
bancoLegado.close();

const db = require("../database/database");
const {
  calcularFingerprintEntrada,
  carregarConfiguracao,
  criarControleUsoIA,
} = require("../services/controleUsoIA");
let conexaoSecundaria;

after(() => {
  if (conexaoSecundaria?.open) conexaoSecundaria.close();
  if (db.open) db.close();
  rmSync(diretorioTemporario, { recursive: true, force: true });
});

function criarUsuario(nomeUsuario, papel = "membro", ativo = 1) {
  const resultado = db.prepare(`
    INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, ativo)
    VALUES (?, 'hash-de-teste', 'salt-de-teste', ?, ?)
  `).run(nomeUsuario, papel, ativo);
  return Number(resultado.lastInsertRowid);
}

function criarOcorrencia(titulo) {
  const resultado = db.prepare(`
    INSERT INTO ocorrencias (titulo, descricao) VALUES (?, 'Descricao de teste')
  `).run(titulo);
  return Number(resultado.lastInsertRowid);
}

function config(limites = {}) {
  return {
    limiteUsuarioHora: 10,
    limiteUsuarioDia: 30,
    limiteGlobalDia: 100,
    maxConcorrenciaUsuario: 1,
    maxConcorrenciaGlobal: 2,
    ttlReservaMs: 15 * 60 * 1000,
    ...limites,
  };
}

function fingerprint(valor) {
  return crypto.createHash("sha256").update(valor).digest("hex");
}

test("a migracao aditiva preserva dados legados e cria indices de uso real", () => {
  const bancoAberto = db.pragma("database_list").find((item) => item.name === "main");
  assert.equal(path.resolve(bancoAberto.file), path.resolve(caminhoBancoTemporario));
  assert.equal(db.prepare("SELECT titulo FROM ocorrencias WHERE id = 1").get().titulo, "Ocorrencia antiga");
  assert.equal(db.prepare("SELECT resumo FROM relatorios WHERE id = 1").get().resumo, "Relatorio legado");
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ia_usos_reais'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ia_usos_reais_reserva_duplicada'").get());
  assert.ok(db.prepare("PRAGMA table_info(relatorios)").all().some((coluna) => coluna.name === "modo"));
});

test("configuracao de ambiente valida os limites e conversao do TTL", () => {
  const carregada = carregarConfiguracao({
    IA_LIMITE_USUARIO_HORA: "7",
    IA_LIMITE_USUARIO_DIA: "21",
    IA_LIMITE_GLOBAL_DIA: "80",
    IA_MAX_CONCORRENCIA_USUARIO: "2",
    IA_MAX_CONCORRENCIA_GLOBAL: "4",
    IA_RESERVA_TTL_MINUTOS: "9",
  });
  assert.deepEqual(carregada, {
    limiteUsuarioHora: 7,
    limiteUsuarioDia: 21,
    limiteGlobalDia: 80,
    maxConcorrenciaUsuario: 2,
    maxConcorrenciaGlobal: 4,
    ttlReservaMs: 9 * 60 * 1000,
  });
  assert.throws(() => carregarConfiguracao({ IA_LIMITE_GLOBAL_DIA: "0" }), /inteiro positivo/);
});

test("fingerprint acompanha modelo, ocorrencia e respostas sem depender da ordem das chaves", () => {
  const primeira = calcularFingerprintEntrada({
    modelo: "modelo-a",
    ocorrencia: { id: 8, titulo: "Erro", descricao: "Falha" },
    respostas: [{ pergunta: "passos", resposta: "A-B" }],
  });
  const mesmaEntrada = calcularFingerprintEntrada({
    modelo: "modelo-a",
    ocorrencia: { descricao: "Falha", titulo: "Erro", id: 8 },
    respostas: [{ pergunta: "passos", resposta: "A-B" }],
  });
  const respostaAlterada = calcularFingerprintEntrada({
    modelo: "modelo-a",
    ocorrencia: { id: 8, titulo: "Erro", descricao: "Falha" },
    respostas: [{ pergunta: "passos", resposta: "A-C" }],
  });

  assert.equal(primeira, mesmaEntrada);
  assert.notEqual(primeira, respostaAlterada);
  assert.notEqual(primeira, calcularFingerprintEntrada({
    modelo: "modelo-b",
    ocorrencia: { id: 8, titulo: "Erro", descricao: "Falha" },
    respostas: [{ pergunta: "passos", resposta: "A-B" }],
  }));
});

test("reservas transacionais registram usuario, cota, concorrencia e deduplicacao", () => {
  const usuarioA = criarUsuario("equipe-a", "admin");
  const usuarioB = criarUsuario("equipe-b");
  const usuarioC = criarUsuario("equipe-c");
  const ocorrenciaA = criarOcorrencia("Falha A");
  const ocorrenciaB = criarOcorrencia("Falha B");
  let agora = 1_700_000_000_000;
  const controleA = criarControleUsoIA({
    db,
    configuracao: config({ maxConcorrenciaUsuario: 1, maxConcorrenciaGlobal: 2 }),
    relogio: () => agora,
  });
  conexaoSecundaria = new Database(caminhoBancoTemporario);
  conexaoSecundaria.pragma("foreign_keys = ON");
  const controleB = criarControleUsoIA({
    db: conexaoSecundaria,
    configuracao: config({ maxConcorrenciaUsuario: 1, maxConcorrenciaGlobal: 2 }),
    relogio: () => agora,
  });
  const fingerprintA = fingerprint("entrada-a");

  const reservaA = controleA.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrenciaA,
    fingerprintEntrada: fingerprintA,
    modelo: "modelo-de-teste",
  });
  assert.equal(reservaA.permitida, true);

  const duplicada = controleB.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrenciaA,
    fingerprintEntrada: fingerprintA,
  });
  assert.equal(duplicada.permitida, false);
  assert.equal(duplicada.motivo, "duplicada");

  const mesmaContaEmParalelo = controleB.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrenciaA,
    fingerprintEntrada: fingerprint("entrada-b"),
  });
  assert.equal(mesmaContaEmParalelo.motivo, "concorrencia_usuario");

  const reservaB = controleB.reservarUsoReal({
    usuarioId: usuarioB,
    ocorrenciaId: ocorrenciaB,
    fingerprintEntrada: fingerprint("entrada-c"),
  });
  assert.equal(reservaB.permitida, true);
  assert.equal(controleA.reservarUsoReal({
    usuarioId: usuarioC,
    ocorrenciaId: ocorrenciaA,
    fingerprintEntrada: fingerprint("entrada-d"),
  }).motivo, "concorrencia_global");

  controleA.concluirUsoReal(reservaA.usoId, {
    tokensEntrada: 120,
    tokensSaida: 45,
  });
  controleB.concluirUsoReal(reservaB.usoId, { modelo: "modelo-de-teste-2" });

  const usoRegistrado = db.prepare("SELECT * FROM ia_usos_reais WHERE id = ?").get(reservaA.usoId);
  assert.equal(usoRegistrado.usuario_id, usuarioA);
  assert.equal(usoRegistrado.ocorrencia_id, ocorrenciaA);
  assert.equal(usoRegistrado.status, "concluida");
  assert.equal(usoRegistrado.tokens_entrada, 120);
  assert.equal(usoRegistrado.tokens_saida, 45);

  const reanalise = controleA.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrenciaA,
    fingerprintEntrada: fingerprintA,
  });
  assert.equal(reanalise.permitida, true, "uma reserva concluida nao bloqueia uma reanalise posterior");
  controleA.cancelarReservaUsoReal(reanalise.usoId);
});

test("cotas moveis por usuario e globais contam chamadas reais", () => {
  const usuarioA = criarUsuario("cotas-a");
  const usuarioB = criarUsuario("cotas-b");
  const ocorrencia = criarOcorrencia("Cota de uso");
  let agora = 1_700_100_000_000;
  const controle = criarControleUsoIA({
    db,
    configuracao: config({
      limiteUsuarioHora: 2,
      limiteUsuarioDia: 3,
      limiteGlobalDia: 3,
      maxConcorrenciaUsuario: 1,
      maxConcorrenciaGlobal: 2,
    }),
    relogio: () => agora,
  });

  for (const sufixo of ["cota-a", "cota-b"]) {
    const reserva = controle.reservarUsoReal({
      usuarioId: usuarioA,
      ocorrenciaId: ocorrencia,
      fingerprintEntrada: fingerprint(sufixo),
    });
    assert.equal(reserva.permitida, true);
    controle.concluirUsoReal(reserva.usoId);
  }
  assert.equal(controle.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("cota-c"),
  }).motivo, "limite_usuario_hora");

  agora += 60 * 60 * 1000 + 1;
  const terceira = controle.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("cota-c"),
  });
  assert.equal(terceira.permitida, true);
  controle.registrarFalhaUsoReal(terceira.usoId, "temporarily_unavailable");

  const quarta = controle.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("cota-d"),
  });
  assert.equal(quarta.motivo, "limite_usuario_dia");

  assert.equal(controle.reservarUsoReal({
    usuarioId: usuarioB,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("cota-e"),
  }).motivo, "limite_global_dia");
});

test("reservas expiradas liberam concorrencia e cancelamentos liberam cota", () => {
  const usuarioA = criarUsuario("ttl-a");
  const usuarioB = criarUsuario("ttl-b");
  const ocorrencia = criarOcorrencia("Reserva temporaria");
  let agora = 1_700_200_000_000;
  const controle = criarControleUsoIA({
    db,
    configuracao: config({
      limiteUsuarioHora: 10,
      limiteUsuarioDia: 10,
      limiteGlobalDia: 10,
      maxConcorrenciaUsuario: 1,
      maxConcorrenciaGlobal: 1,
      ttlReservaMs: 1000,
    }),
    relogio: () => agora,
  });

  const reservaAntiga = controle.reservarUsoReal({
    usuarioId: usuarioA,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("ttl-a"),
  });
  assert.equal(reservaAntiga.permitida, true);
  assert.equal(db.prepare("SELECT reservada_ate FROM ia_usos_reais WHERE id = ?").get(reservaAntiga.usoId).reservada_ate, agora + 1000);

  agora += 900;
  const renovacao = controle.renovarReservaUsoReal(reservaAntiga.usoId);
  assert.equal(renovacao.renovada, true);
  assert.equal(renovacao.reservadaAte, agora + 1000);

  agora += 900;
  assert.equal(controle.reservarUsoReal({
    usuarioId: usuarioB,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("ttl-b"),
  }).motivo, "concorrencia_global", "a renovacao mantem a reserva ativa alem do prazo inicial");

  agora += 101;
  const reservaNova = controle.reservarUsoReal({
    usuarioId: usuarioB,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("ttl-b"),
  });
  assert.equal(reservaNova.permitida, true);
  assert.equal(db.prepare("SELECT status FROM ia_usos_reais WHERE id = ?").get(reservaAntiga.usoId).status, "expirada");

  controle.cancelarReservaUsoReal(reservaNova.usoId);
  const reservaRepetida = controle.reservarUsoReal({
    usuarioId: usuarioB,
    ocorrenciaId: ocorrencia,
    fingerprintEntrada: fingerprint("ttl-b"),
  });
  assert.equal(reservaRepetida.permitida, true);
});

test("a inicializacao repetida da migracao preserva o banco existente", () => {
  if (conexaoSecundaria?.open) conexaoSecundaria.close();
  db.close();
  delete require.cache[require.resolve("../database/database")];
  const bancoReaberto = require("../database/database");

  assert.equal(bancoReaberto.prepare("SELECT titulo FROM ocorrencias WHERE id = 1").get().titulo, "Ocorrencia antiga");
  assert.equal(bancoReaberto.prepare("SELECT resumo FROM relatorios WHERE id = 1").get().resumo, "Relatorio legado");
  assert.ok(bancoReaberto.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ia_usos_reais'").get());
  bancoReaberto.close();
});
