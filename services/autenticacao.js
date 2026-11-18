const crypto = require("crypto");
const { promisify } = require("util");
const db = require("../database/database");

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 1 << 14, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
const TAMANHO_HASH = 64;
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000;
const SALT_DUMMY = "0f89a52de4782db03d2ee29b2f331d76";

function normalizarNomeUsuario(nomeUsuario) {
  return typeof nomeUsuario === "string" ? nomeUsuario.trim().toLowerCase() : "";
}

function validarNomeUsuario(nomeUsuario) {
  return /^[a-z0-9_.-]{3,32}$/.test(normalizarNomeUsuario(nomeUsuario));
}

function validarSenha(senha, minimo = 6) {
  return typeof senha === "string" && senha.length >= minimo && senha.length <= 128;
}

async function criarHashSenha(senha, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(senha, salt, TAMANHO_HASH, SCRYPT_OPTIONS);
  return { salt, hash: hash.toString("hex") };
}

async function verificarSenha(senha, salt, hashEsperado) {
  const derivado = await scrypt(senha, salt, TAMANHO_HASH, SCRYPT_OPTIONS);
  const esperado = Buffer.from(hashEsperado, "hex");
  return esperado.length === derivado.length && crypto.timingSafeEqual(derivado, esperado);
}

async function inicializarAdmin() {
  const total = db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total;
  if (total > 0) return;

  const credencial = await criarHashSenha("admin");
  try {
    db.prepare(`
      INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, deve_trocar_senha)
      VALUES ('admin', ?, ?, 'admin', 1)
    `).run(credencial.hash, credencial.salt);
    console.log("Conta inicial admin criada; a senha deverá ser trocada no primeiro acesso.");
  } catch (erro) {
    if (erro.code !== "SQLITE_CONSTRAINT_UNIQUE") throw erro;
  }
}

async function buscarUsuarioPorCredencial(nomeUsuario, senha) {
  const usuarioNormalizado = normalizarNomeUsuario(nomeUsuario);
  const usuario = db.prepare(`
    SELECT id, nome_usuario, senha_hash, senha_salt, papel, ativo, deve_trocar_senha
    FROM usuarios WHERE nome_usuario = ? COLLATE NOCASE
  `).get(usuarioNormalizado);

  const hashValido = usuario
    ? await verificarSenha(senha, usuario.senha_salt, usuario.senha_hash)
    : await verificarSenha(senha, SALT_DUMMY, "0".repeat(TAMANHO_HASH * 2));

  if (!usuario || !usuario.ativo || !hashValido) return null;
  return usuario;
}

function criarSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const expiraEm = Date.now() + DURACAO_SESSAO_MS;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  db.prepare("DELETE FROM sessoes WHERE expira_em <= ?").run(Date.now());
  db.prepare(`
    INSERT INTO sessoes (token_hash, usuario_id, csrf_token, expira_em)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, usuarioId, csrfToken, expiraEm);

  return { token, csrfToken, expiraEm };
}

function buscarSessao(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return db.prepare(`
    SELECT s.token_hash, s.csrf_token, s.expira_em,
           u.id, u.nome_usuario, u.papel, u.deve_trocar_senha
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1
  `).get(tokenHash, Date.now()) || null;
}

function revogarSessao(tokenHash) {
  db.prepare("DELETE FROM sessoes WHERE token_hash = ?").run(tokenHash);
}

function revogarSessoesUsuario(usuarioId) {
  db.prepare("DELETE FROM sessoes WHERE usuario_id = ?").run(usuarioId);
}

module.exports = {
  DURACAO_SESSAO_MS,
  buscarSessao,
  buscarUsuarioPorCredencial,
  criarHashSenha,
  criarSessao,
  inicializarAdmin,
  normalizarNomeUsuario,
  revogarSessao,
  revogarSessoesUsuario,
  validarNomeUsuario,
  validarSenha,
  verificarSenha,
};
