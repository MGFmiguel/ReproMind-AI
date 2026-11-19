const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const TABELAS = [
  {
    nome: "usuarios",
    colunas: ["id", "nome_usuario", "senha_hash", "senha_salt", "papel", "ativo", "deve_trocar_senha", "data_criacao"],
    obrigatorias: ["id", "nome_usuario", "senha_hash", "senha_salt", "papel", "ativo", "deve_trocar_senha"],
    ordem: "id",
    identidade: true,
  },
  {
    nome: "ocorrencias",
    colunas: ["id", "titulo", "descricao", "categoria", "prioridade", "status", "data_criacao", "impacto", "frequencia", "usuarios_afetados"],
    obrigatorias: ["id", "titulo", "descricao"],
    ordem: "id",
    identidade: true,
  },
  {
    nome: "relatorios",
    colunas: ["id", "ocorrencia_id", "resumo", "hipotese", "evidencias", "testes_sugeridos", "data_criacao", "modo", "informacoes", "hipoteses", "confianca", "status_investigacao", "testes_priorizados"],
    obrigatorias: ["id", "ocorrencia_id"],
    ordem: "id",
    identidade: true,
  },
  {
    nome: "respostas_investigacao",
    colunas: ["id", "ocorrencia_id", "pergunta", "resposta", "ordem", "data_criacao"],
    obrigatorias: ["id", "ocorrencia_id", "pergunta", "ordem"],
    ordem: "id",
    identidade: true,
  },
  {
    nome: "sessoes",
    colunas: ["token_hash", "usuario_id", "csrf_token", "expira_em", "data_criacao"],
    obrigatorias: ["token_hash", "usuario_id", "csrf_token", "expira_em"],
    ordem: "token_hash",
  },
  {
    nome: "tentativas_login",
    colunas: ["escopo", "chave_hash", "inicio", "quantidade"],
    obrigatorias: ["escopo", "chave_hash", "inicio", "quantidade"],
    ordem: "escopo, chave_hash",
    opcional: true,
  },
  {
    nome: "ia_usos_reais",
    colunas: ["id", "usuario_id", "ocorrencia_id", "fingerprint_entrada", "status", "modelo", "solicitada_em", "reservada_ate", "finalizada_em", "tokens_entrada", "tokens_saida", "codigo_erro"],
    obrigatorias: ["id", "usuario_id", "ocorrencia_id", "fingerprint_entrada", "status", "solicitada_em"],
    ordem: "id",
    identidade: true,
    opcional: true,
  },
];

const CHAVE_LOCK_MIGRACAO = 0x52504d49475241;

function caminhoBancoOrigem(env = process.env, cwd = process.cwd()) {
  const configurado = env.DATABASE_PATH;
  return path.resolve(cwd, configurado || path.join(__dirname, "..", "database", "database.db"));
}

function abrirFonteSqlite({ DatabaseClass = Database, caminho = caminhoBancoOrigem() } = {}) {
  if (!fs.existsSync(caminho)) throw new Error("O arquivo de banco SQLite de origem não foi encontrado.");
  return new DatabaseClass(caminho, { readonly: true, fileMustExist: true });
}

function lerSnapshotSqlite(db) {
  const snapshot = {};
  const tabelasExistentes = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((linha) => linha.name));

  for (const tabela of TABELAS) {
    if (!tabelasExistentes.has(tabela.nome)) {
      if (tabela.opcional) {
        snapshot[tabela.nome] = [];
        continue;
      }
      throw new Error(`A tabela SQLite obrigatória ${tabela.nome} não existe.`);
    }

    const disponiveis = new Set(db.prepare(`PRAGMA table_info("${tabela.nome}")`)
      .all().map((coluna) => coluna.name));
    const ausentes = tabela.obrigatorias.filter((coluna) => !disponiveis.has(coluna));
    if (ausentes.length) {
      throw new Error(`A tabela SQLite ${tabela.nome} não contém todas as colunas necessárias.`);
    }

    const selecao = tabela.colunas.map((coluna) =>
      disponiveis.has(coluna) ? `"${coluna}"` : `NULL AS "${coluna}"`).join(", ");
    snapshot[tabela.nome] = db.prepare(`
      SELECT ${selecao} FROM "${tabela.nome}" ORDER BY ${tabela.ordem}
    `).all();
  }

  return snapshot;
}

async function contarDestino(db) {
  const contagens = {};
  for (const tabela of TABELAS) {
    const linha = await db.prepare(`SELECT COUNT(*) AS total FROM public.${tabela.nome}`).get();
    contagens[tabela.nome] = Number(linha.total);
  }
  return contagens;
}

function destinoVazio(contagens) {
  return Object.values(contagens).every((total) => total === 0);
}

async function aplicarSnapshot(db, snapshot) {
  return db.transaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(?)").get(CHAVE_LOCK_MIGRACAO);
    const antes = await contarDestino(tx);
    if (!destinoVazio(antes)) {
      throw new Error("A migração foi interrompida: o banco Supabase já contém registros.");
    }

    for (const tabela of TABELAS) {
      const linhas = snapshot[tabela.nome] || [];
      if (!linhas.length) continue;
      const nomesColunas = tabela.colunas;
      const listaColunas = nomesColunas.map((coluna) => `"${coluna}"`).join(", ");
      const marcadores = nomesColunas.map(() => "?").join(", ");
      const inserir = tx.prepare(`
        INSERT INTO public.${tabela.nome} (${listaColunas})
        VALUES (${marcadores})
      `);
      for (const linha of linhas) {
        await inserir.run(...nomesColunas.map((coluna) => linha[coluna] ?? null));
      }
    }

    for (const tabela of TABELAS.filter((item) => item.identidade)) {
      await tx.prepare(`
        SELECT setval(
          pg_get_serial_sequence('public.${tabela.nome}', 'id'),
          COALESCE(MAX(id), 1),
          COUNT(*) > 0
        )
        FROM public.${tabela.nome}
      `).get();
    }

    const depois = await contarDestino(tx);
    for (const tabela of TABELAS) {
      const esperado = (snapshot[tabela.nome] || []).length;
      if (depois[tabela.nome] !== esperado) {
        throw new Error(`A verificação da tabela ${tabela.nome} falhou; a transação será desfeita.`);
      }
    }
    return depois;
  })();
}

async function executarMigracao({ db, snapshot, aplicar = false }) {
  const contagens = await contarDestino(db);
  const vazia = destinoVazio(contagens);
  if (!aplicar) return { aplicada: false, destinoVazio: vazia, contagens };
  if (!vazia) throw new Error("A migração foi interrompida: o banco Supabase já contém registros.");
  const importadas = await aplicarSnapshot(db, snapshot);
  return { aplicada: true, destinoVazio: false, contagens: importadas };
}

function lerModo(args) {
  if (args.length > 1 || (args.length === 1 && !["--apply", "--dry-run"].includes(args[0]))) {
    throw new Error("Use apenas --dry-run para conferir ou --apply para importar os dados.");
  }
  return args[0] === "--apply";
}

function validarProjectRef(connectionString, projectRef) {
  if (typeof projectRef !== "string" || !/^[a-z0-9]{16,32}$/i.test(projectRef)) {
    throw new Error("Configure SUPABASE_PROJECT_REF com o identificador do projeto de destino.");
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL não contém uma URL PostgreSQL válida.");
  }
  const referencia = projectRef.toLowerCase();
  const usuario = decodeURIComponent(url.username).toLowerCase();
  const destinoConfere = url.hostname.toLowerCase().includes(referencia) || usuario.endsWith(`.${referencia}`);
  if (!destinoConfere) {
    throw new Error("DATABASE_URL não corresponde ao SUPABASE_PROJECT_REF configurado.");
  }
}

async function executar() {
  const aplicar = lerModo(process.argv.slice(2));
  validarProjectRef(process.env.DATABASE_URL, process.env.SUPABASE_PROJECT_REF);
  const { Pool, types } = require("pg");
  const { criarPostgresDatabase } = require("../database/postgres");
  const destino = criarPostgresDatabase({
    connectionString: process.env.DATABASE_URL,
    PoolClass: Pool,
    types,
  });
  let fonte;

  try {
    fonte = abrirFonteSqlite();
    const snapshot = lerSnapshotSqlite(fonte);
    const resultado = await executarMigracao({ db: destino, snapshot, aplicar });
    console.log(aplicar ? "Importação concluída." : "Prévia; nenhum dado foi gravado.");
    console.log(`Banco Supabase vazio: ${resultado.destinoVazio ? "sim" : "não"}`);
    for (const tabela of TABELAS) {
      const origem = (snapshot[tabela.nome] || []).length;
      const destinoAtual = resultado.contagens[tabela.nome];
      console.log(`${tabela.nome}: origem=${origem}; destino=${destinoAtual}`);
    }
  } finally {
    fonte?.close();
    await destino.close();
  }
}

if (require.main === module) {
  executar().catch((erro) => {
    const mensagem = erro.message.startsWith("DATABASE_") || erro.message.startsWith("Configure SUPABASE_PROJECT_REF") || erro.message.startsWith("A ") || erro.message.startsWith("Use ")
      ? erro.message
      : "Falha ao migrar os dados. Confira o código do erro nos logs do banco e a configuração local.";
    console.error(mensagem);
    process.exitCode = 1;
  });
}

module.exports = {
  TABELAS,
  aplicarSnapshot,
  abrirFonteSqlite,
  caminhoBancoOrigem,
  contarDestino,
  destinoVazio,
  executarMigracao,
  lerModo,
  lerSnapshotSqlite,
  validarProjectRef,
};
