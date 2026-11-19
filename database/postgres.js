const { AsyncLocalStorage } = require("node:async_hooks");

const TABELAS_COM_ID = new Set([
  "ocorrencias",
  "relatorios",
  "respostas_investigacao",
  "usuarios",
  "ia_usos_reais",
]);

function substituirPlaceholders(sql) {
  let resultado = "";
  let numero = 0;
  let aspasSimples = false;
  let aspasDuplas = false;
  let comentarioLinha = false;
  let comentarioBloco = 0;

  for (let indice = 0; indice < sql.length; indice += 1) {
    const caractere = sql[indice];
    const proximo = sql[indice + 1];

    if (comentarioLinha) {
      resultado += caractere;
      if (caractere === "\n") comentarioLinha = false;
      continue;
    }

    if (comentarioBloco > 0) {
      resultado += caractere;
      if (caractere === "/" && proximo === "*") {
        resultado += proximo;
        comentarioBloco += 1;
        indice += 1;
      } else if (caractere === "*" && proximo === "/") {
        resultado += proximo;
        comentarioBloco -= 1;
        indice += 1;
      }
      continue;
    }

    if (!aspasDuplas && caractere === "'" && aspasSimples && proximo === "'") {
      resultado += "''";
      indice += 1;
      continue;
    }
    if (!aspasDuplas && caractere === "'") {
      aspasSimples = !aspasSimples;
      resultado += caractere;
      continue;
    }
    if (!aspasSimples && caractere === '"') {
      aspasDuplas = !aspasDuplas;
      resultado += caractere;
      continue;
    }
    if (!aspasSimples && !aspasDuplas && caractere === "-" && proximo === "-") {
      resultado += "--";
      comentarioLinha = true;
      indice += 1;
      continue;
    }
    if (!aspasSimples && !aspasDuplas && caractere === "/" && proximo === "*") {
      resultado += "/*";
      comentarioBloco = 1;
      indice += 1;
      continue;
    }

    if (!aspasSimples && !aspasDuplas && caractere === "?") {
      numero += 1;
      resultado += `$${numero}`;
      continue;
    }

    resultado += caractere;
  }

  return resultado;
}

function adicionarRetornoId(sql) {
  if (/\bRETURNING\b/i.test(sql)) return sql;
  const insercao = sql.match(/^\s*INSERT\s+INTO\s+["']?([a-z_][a-z0-9_]*)/i);
  if (!insercao || !TABELAS_COM_ID.has(insercao[1].toLowerCase())) return sql;
  return `${sql.trim().replace(/;\s*$/, "")} RETURNING id`;
}

function normalizarInt8(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : valor;
}

function criarPostgresDatabase({ connectionString, PoolClass, types }) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DATABASE_URL é obrigatória quando DATABASE_DRIVER=postgres.");
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL não contém uma URL PostgreSQL válida.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL deve usar o protocolo PostgreSQL.");
  }
  if (!["require", "verify-ca", "verify-full"].includes((url.searchParams.get("sslmode") || "").toLowerCase())) {
    throw new Error("DATABASE_URL deve exigir TLS com sslmode=require.");
  }

  if (types?.setTypeParser) types.setTypeParser(20, normalizarInt8);
  const pool = new PoolClass({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  const contextoTransacao = new AsyncLocalStorage();

  function criarStatement(sql, query = executarQuery) {
    return {
      get(...parametros) {
        return query(sql, parametros).then((resultado) => resultado.rows[0]);
      },
      all(...parametros) {
        return query(sql, parametros).then((resultado) => resultado.rows);
      },
      run(...parametros) {
        const sqlComId = adicionarRetornoId(sql);
        return query(sqlComId, parametros).then((resultado) => ({
          changes: resultado.rowCount,
          lastInsertRowid: resultado.rows[0]?.id === undefined
            ? undefined
            : normalizarInt8(resultado.rows[0].id),
        }));
      },
    };
  }

  function executarQuery(sql, parametros = []) {
    const cliente = contextoTransacao.getStore();
    const executor = cliente || pool;
    return executor.query(substituirPlaceholders(sql), parametros);
  }

  const banco = {
    dialect: "postgres",
    prepare(sql) {
      return criarStatement(sql);
    },
    transaction(callback) {
      if (typeof callback !== "function") throw new TypeError("A transação exige uma função.");
      return async (...argumentos) => {
        const cliente = await pool.connect();
        try {
          await cliente.query("BEGIN");
          const transacao = {
            dialect: "postgres",
            prepare(sql) {
              return criarStatement(sql, (consulta, parametros = []) =>
                cliente.query(substituirPlaceholders(consulta), parametros));
            },
          };
          const resultado = await contextoTransacao.run(cliente, () => callback(transacao, ...argumentos));
          await cliente.query("COMMIT");
          return resultado;
        } catch (erro) {
          try {
            await cliente.query("ROLLBACK");
          } catch {
            // Preserva o erro original da operação.
          }
          throw erro;
        } finally {
          cliente.release();
        }
      };
    },
    async ping() {
      await executarQuery("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };

  pool.on?.("error", (erro) => {
    const codigo = typeof erro?.code === "string" ? erro.code : "erro_interno";
    console.error("Erro inesperado no pool PostgreSQL:", codigo);
  });

  return banco;
}

module.exports = {
  adicionarRetornoId,
  criarPostgresDatabase,
  substituirPlaceholders,
};
