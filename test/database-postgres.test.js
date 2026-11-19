const assert = require("node:assert/strict");
const { test } = require("node:test");
const { criarPostgresDatabase, substituirPlaceholders } = require("../database/postgres");

function criarPoolFalso() {
  const chamadasPool = [];
  const chamadasCliente = [];
  let proximaResposta = { rows: [], rowCount: 0 };
  let liberado = false;
  let configuracaoPool;

  class PoolFalso {
    constructor(configuracao) {
      this.configuracao = configuracao;
      configuracaoPool = configuracao;
    }

    on() {}

    async query(texto, valores) {
      chamadasPool.push({ texto, valores });
      return proximaResposta;
    }

    async connect() {
      return {
        query: async (texto, valores) => {
          chamadasCliente.push({ texto, valores });
          if (texto === "SELECT id FROM usuarios WHERE id = $1") {
            return { rows: [{ id: 42 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release: () => { liberado = true; },
      };
    }

    async end() {}
  }

  return {
    PoolFalso,
    chamadasPool,
    chamadasCliente,
    configuracaoPool: () => configuracaoPool,
    setProximaResposta: (resposta) => { proximaResposta = resposta; },
    foiLiberado: () => liberado,
  };
}

test("converte placeholders sem alterar texto literal ou comentários SQL", () => {
  assert.equal(
    substituirPlaceholders("SELECT '?' AS literal, coluna FROM itens WHERE id = ? -- ?\nAND ativo = ?"),
    "SELECT '?' AS literal, coluna FROM itens WHERE id = $1 -- ?\nAND ativo = $2",
  );
});

test("conector usa pool pequeno, preserva parâmetros e retorna IDs do PostgreSQL", async () => {
  const falso = criarPoolFalso();
  falso.setProximaResposta({ rows: [{ id: "17" }], rowCount: 1 });
  const db = criarPostgresDatabase({
    connectionString: "postgresql://usuario:senha@localhost:6543/repromind?sslmode=require",
    PoolClass: falso.PoolFalso,
  });

  assert.equal(db.dialect, "postgres");
  assert.equal(falso.configuracaoPool().max, 1);
  assert.equal(falso.configuracaoPool().connectionTimeoutMillis, 5000);
  const resultado = await db.prepare("INSERT INTO ocorrencias (titulo) VALUES (?)").run("falha");

  assert.equal(falso.chamadasPool[0].texto, "INSERT INTO ocorrencias (titulo) VALUES ($1) RETURNING id");
  assert.deepEqual(falso.chamadasPool[0].valores, ["falha"]);
  assert.deepEqual(resultado, { changes: 1, lastInsertRowid: 17 });
});

test("transação faz commit e libera a conexão", async () => {
  const falso = criarPoolFalso();
  const db = criarPostgresDatabase({
    connectionString: "postgresql://usuario:senha@localhost:6543/repromind?sslmode=require",
    PoolClass: falso.PoolFalso,
  });

  const usuario = await db.transaction(async (tx) =>
    tx.prepare("SELECT id FROM usuarios WHERE id = ?").get(42))();

  assert.deepEqual(usuario, { id: 42 });
  assert.deepEqual(falso.chamadasCliente.map((item) => item.texto), [
    "BEGIN",
    "SELECT id FROM usuarios WHERE id = $1",
    "COMMIT",
  ]);
  assert.equal(falso.foiLiberado(), true);
});

test("DATABASE_URL inválida ou sem TLS é rejeitada sem abrir conexão", () => {
  const falso = criarPoolFalso();
  assert.throws(() => criarPostgresDatabase({
    connectionString: "postgresql://usuario:senha@localhost/repromind",
    PoolClass: falso.PoolFalso,
  }), /sslmode=require/);
});
