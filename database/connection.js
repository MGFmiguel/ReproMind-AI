const DRIVER_SQLITE = "sqlite";
const DRIVER_POSTGRES = "postgres";

function criarConexao(env = process.env) {
  const driverConfigurado = typeof env.DATABASE_DRIVER === "string" && env.DATABASE_DRIVER.trim();
  if (env.NODE_ENV === "production" && !driverConfigurado) {
    throw new Error("Defina DATABASE_DRIVER=postgres em produção para evitar uso de armazenamento efêmero.");
  }
  const driver = (driverConfigurado ? env.DATABASE_DRIVER : DRIVER_SQLITE).trim().toLowerCase();
  if (env.NODE_ENV === "production" && driver !== DRIVER_POSTGRES) {
    throw new Error("SQLite é destinado ao ambiente local; configure DATABASE_DRIVER=postgres em produção.");
  }
  if (driver === DRIVER_SQLITE) {
    const banco = require("./database");
    if (!banco.dialect) banco.dialect = DRIVER_SQLITE;
    return banco;
  }
  if (driver === DRIVER_POSTGRES) {
    const { Pool, types } = require("pg");
    const { criarPostgresDatabase } = require("./postgres");
    return criarPostgresDatabase({
      connectionString: env.DATABASE_URL,
      PoolClass: Pool,
      types,
    });
  }
  throw new Error("DATABASE_DRIVER deve ser sqlite ou postgres.");
}

const conexao = criarConexao();

module.exports = conexao;
