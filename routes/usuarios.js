const express = require("express");
const router = express.Router();
const db = require("../database/connection");
const {
  criarHashSenha,
  revogarSessoesUsuario,
  validarNomeUsuario,
  validarSenha,
} = require("../services/autenticacao");
const { exigirAdmin, exigirAutenticacao, exigirCsrf, exigirSenhaAtualizada } = require("../middleware/autenticacao");

router.use(exigirAutenticacao, exigirSenhaAtualizada, exigirAdmin);

router.get("/", async (req, res) => {
  const usuarios = await db.prepare(`
    SELECT id, nome_usuario, papel, ativo, deve_trocar_senha, data_criacao
    FROM usuarios ORDER BY LOWER(nome_usuario)
  `).all();
  res.json({ usuarios });
});

router.post("/", exigirCsrf, async (req, res) => {
  const nomeUsuario = typeof req.body?.nomeUsuario === "string"
    ? req.body.nomeUsuario.trim().toLowerCase()
    : "";
  const senhaTemporaria = req.body?.senhaTemporaria;

  if (!validarNomeUsuario(nomeUsuario)) {
    return res.status(400).json({ erro: "O nome deve ter 3 a 32 letras, números, ponto, hífen ou sublinhado." });
  }
  if (!validarSenha(senhaTemporaria)) {
    return res.status(400).json({ erro: "A senha temporária deve ter de 6 a 128 caracteres." });
  }

  try {
    const credencial = await criarHashSenha(senhaTemporaria);
    const resultado = await db.prepare(`
      INSERT INTO usuarios (nome_usuario, senha_hash, senha_salt, papel, deve_trocar_senha)
      VALUES (?, ?, ?, 'membro', 1)
    `).run(nomeUsuario, credencial.hash, credencial.salt);
    res.status(201).json({
      mensagem: "Usuário criado. Ele deverá trocar a senha temporária no primeiro acesso.",
      usuario: { id: resultado.lastInsertRowid, nomeUsuario, papel: "membro", ativo: true },
    });
  } catch (erro) {
    if (["SQLITE_CONSTRAINT_UNIQUE", "23505"].includes(erro.code)) {
      return res.status(409).json({ erro: "Esse nome de usuário já está cadastrado." });
    }
    console.error("Falha ao criar usuário:", erro);
    res.status(500).json({ erro: "Não foi possível criar o usuário." });
  }
});

router.patch("/:id/ativo", exigirCsrf, async (req, res) => {
  const id = Number(req.params.id);
  const ativo = req.body?.ativo;
  if (!Number.isInteger(id) || id <= 0 || typeof ativo !== "boolean") {
    return res.status(400).json({ erro: "ID ou estado de usuário inválido." });
  }

  const usuario = await db.prepare("SELECT id, papel FROM usuarios WHERE id = ?").get(id);
  if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (!ativo && id === req.usuario.id) {
    return res.status(400).json({ erro: "O administrador não pode desativar a própria conta." });
  }
  if (!ativo && usuario.papel === "admin") {
    const adminsAtivos = (await db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'admin' AND ativo = 1").get()).total;
    if (adminsAtivos <= 1) return res.status(400).json({ erro: "Não é possível desativar o último administrador ativo." });
  }

  await db.prepare("UPDATE usuarios SET ativo = ? WHERE id = ?").run(ativo ? 1 : 0, id);
  if (!ativo) await revogarSessoesUsuario(id);
  res.json({ mensagem: ativo ? "Usuário ativado." : "Usuário desativado." });
});

router.post("/:id/redefinir-senha", exigirCsrf, async (req, res) => {
  const id = Number(req.params.id);
  const senhaTemporaria = req.body?.senhaTemporaria;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: "ID inválido." });
  if (!validarSenha(senhaTemporaria)) {
    return res.status(400).json({ erro: "A senha temporária deve ter de 6 a 128 caracteres." });
  }

  const usuario = await db.prepare("SELECT id FROM usuarios WHERE id = ?").get(id);
  if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado." });

  try {
    const credencial = await criarHashSenha(senhaTemporaria);
    await db.prepare(`
      UPDATE usuarios
      SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 1
      WHERE id = ?
    `).run(credencial.hash, credencial.salt, id);
    await revogarSessoesUsuario(id);
    res.json({ mensagem: "Senha redefinida. O usuário deverá trocá-la no próximo acesso." });
  } catch (erro) {
    console.error("Falha ao redefinir senha:", erro);
    res.status(500).json({ erro: "Não foi possível redefinir a senha." });
  }
});

module.exports = router;
