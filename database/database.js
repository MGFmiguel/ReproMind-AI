const Database = require("better-sqlite3");
const path = require("path");

const caminhoBanco = process.env.DATABASE_PATH || path.join(__dirname, "database.db");
const db = new Database(caminhoBanco);

db.pragma("foreign_keys = ON");

// Tabela de ocorrências
db.exec(`
    CREATE TABLE IF NOT EXISTS ocorrencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        categoria TEXT,
        prioridade TEXT DEFAULT 'Media',
        status TEXT DEFAULT 'Aberta',
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Tabela de relatórios
db.exec(`
    CREATE TABLE IF NOT EXISTS relatorios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ocorrencia_id INTEGER NOT NULL,
        resumo TEXT,
        hipotese TEXT,
        evidencias TEXT,
        testes_sugeridos TEXT,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (ocorrencia_id)
        REFERENCES ocorrencias(id)
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS respostas_investigacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ocorrencia_id INTEGER NOT NULL,
        pergunta TEXT NOT NULL,
        resposta TEXT,
        ordem INTEGER NOT NULL,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (ocorrencia_id)
        REFERENCES ocorrencias(id)
        ON DELETE CASCADE
    );
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
        senha_hash TEXT NOT NULL,
        senha_salt TEXT NOT NULL,
        papel TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
        ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
        deve_trocar_senha INTEGER NOT NULL DEFAULT 0 CHECK (deve_trocar_senha IN (0, 1)),
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessoes (
        token_hash TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL,
        csrf_token TEXT NOT NULL,
        expira_em INTEGER NOT NULL,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessoes_expira_em ON sessoes(expira_em);
`);

// Estrutura aditiva para reservas e utilizacao real da OpenAI.
// Analises em modo simulado nao devem gerar registros nesta tabela.
db.exec(`
    CREATE TABLE IF NOT EXISTS ia_usos_reais (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        ocorrencia_id INTEGER NOT NULL,
        fingerprint_entrada TEXT NOT NULL CHECK (length(fingerprint_entrada) = 64),
        status TEXT NOT NULL CHECK (status IN ('reservada', 'concluida', 'falhou', 'cancelada', 'expirada')),
        modelo TEXT,
        solicitada_em INTEGER NOT NULL,
        reservada_ate INTEGER,
        finalizada_em INTEGER,
        tokens_entrada INTEGER CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
        tokens_saida INTEGER CHECK (tokens_saida IS NULL OR tokens_saida >= 0),
        codigo_erro TEXT CHECK (codigo_erro IS NULL OR length(codigo_erro) <= 100),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
        FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_ia_usos_reais_usuario_tempo
      ON ia_usos_reais(usuario_id, solicitada_em, status);

    CREATE INDEX IF NOT EXISTS idx_ia_usos_reais_tempo_status
      ON ia_usos_reais(solicitada_em, status);

    CREATE INDEX IF NOT EXISTS idx_ia_usos_reais_ocorrencia_tempo
      ON ia_usos_reais(ocorrencia_id, solicitada_em);

    CREATE INDEX IF NOT EXISTS idx_ia_usos_reais_status_tempo
      ON ia_usos_reais(status, solicitada_em);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ia_usos_reais_reserva_duplicada
      ON ia_usos_reais(usuario_id, ocorrencia_id, fingerprint_entrada)
      WHERE status = 'reservada';
`);

const colunasUsosIA = db
  .prepare("PRAGMA table_info(ia_usos_reais)")
  .all()
  .map((coluna) => coluna.name);

if (!colunasUsosIA.includes("reservada_ate")) {
  db.exec("ALTER TABLE ia_usos_reais ADD COLUMN reservada_ate INTEGER");
}

// Migração: adicionar campos para análise estruturada
const colunasRelatorios = db
  .prepare("PRAGMA table_info(relatorios)")
  .all()
  .map((coluna) => coluna.name);

const novasColunas = {
  modo: "TEXT",
  informacoes: "TEXT",
  hipoteses: "TEXT",
  confianca: "TEXT",
  status_investigacao: "TEXT",
  testes_priorizados: "TEXT",
};

const novasColunasOcorrencias = {
  impacto: "INTEGER",
  frequencia: "INTEGER",
  usuarios_afetados: "INTEGER",
};

for (const [coluna, tipo] of Object.entries(novasColunas)) {
  if (!colunasRelatorios.includes(coluna)) {
    db.exec(`ALTER TABLE relatorios ADD COLUMN ${coluna} ${tipo}`);
  }
}

const colunasOcorrencias = db
  .prepare("PRAGMA table_info(ocorrencias)")
  .all()
  .map((coluna) => coluna.name);

for (const [coluna, tipo] of Object.entries(novasColunasOcorrencias)) {
  if (!colunasOcorrencias.includes(coluna)) {
    db.exec(`ALTER TABLE ocorrencias ADD COLUMN ${coluna} ${tipo}`);
  }
}

console.log("Banco de dados conectado!");
console.log("Tabelas verificadas com sucesso.");

module.exports = db;
