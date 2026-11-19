const express = require("express");
const router = express.Router();
const db = require("../database/connection");
const { criarControleTentativasLogin } = require("../services/controleTentativasLogin");
const controleTentativasLogin = criarControleTentativasLogin({ db });
const {
  buscarUsuarioPorCredencial,
  criarHashSenha,
  criarSessao,
  revogarSessao,
  revogarSessoesUsuario,
  validarSenha,
  verificarSenha,
} = require("../services/autenticacao");
const {
  exigirAutenticacao,
  exigirCsrf,
} = require("../middleware/autenticacao");

const nomeCookie = "repromind.sid";

function definirCookie(res, token) {
  const partes = [
    `${nomeCookie}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${8 * 60 * 60}`,
  ];
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function limparCookie(res) {
  const partes = [`${nomeCookie}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    nomeUsuario: usuario.nome_usuario,
    papel: usuario.papel,
    deveTrocarSenha: Boolean(usuario.deve_trocar_senha),
  };
}

router.post("/login", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const nomeUsuario = req.body?.nomeUsuario;
  const senha = req.body?.senha;
  if (
    typeof nomeUsuario !== "string" || nomeUsuario.length > 32 ||
    typeof senha !== "string" || senha.length > 128
  ) {
    return res.status(400).json({ erro: "Informe nome de usuário e senha." });
  }

  const espera = await controleTentativasLogin.obterTempoBloqueio(ip, nomeUsuario);
  if (espera > 0) {
    res.set("Retry-After", String(espera));
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde antes de tentar novamente." });
  }

  try {
    const usuario = await buscarUsuarioPorCredencial(nomeUsuario, senha);
    if (!usuario) {
      await controleTentativasLogin.registrarFalhaLogin(ip, nomeUsuario);
      return res.status(401).json({ erro: "Nome de usuário ou senha inválidos." });
    }

    // Limpa apenas as falhas deste usuário e IP, sem apagar as falhas de
    // outras pessoas que possam compartilhar o mesmo endereço de rede.
    await controleTentativasLogin.limparTentativasCredencial(ip, nomeUsuario);
    if (req.sessao?.token_hash) await revogarSessao(req.sessao.token_hash);
    const sessao = await criarSessao(usuario.id);
    definirCookie(res, sessao.token);
    return res.json({ usuario: usuarioPublico(usuario), csrfToken: sessao.csrfToken });
  } catch (erro) {
    console.error("Falha ao autenticar usuário:", erro);
    return res.status(500).json({ erro: "Não foi possível iniciar a sessão." });
  }
});

router.get("/me", exigirAutenticacao, (req, res) => {
  res.json({ usuario: req.usuario, csrfToken: req.sessao.csrf_token });
});

router.post("/logout", exigirAutenticacao, exigirCsrf, async (req, res) => {
  await revogarSessao(req.sessao.token_hash);
  limparCookie(res);
  res.json({ mensagem: "Sessão encerrada." });
});

router.post("/change-password", exigirAutenticacao, exigirCsrf, async (req, res) => {
  const senhaAtual = req.body?.senhaAtual;
  const novaSenha = req.body?.novaSenha;
  const confirmacao = req.body?.confirmacao;

  if (!validarSenha(novaSenha) || novaSenha !== confirmacao) {
    return res.status(400).json({ erro: "A nova senha deve ter de 6 a 128 caracteres e coincidir com a confirmação." });
  }

  try {
    const credencialAtual = await db.prepare(`
      SELECT senha_hash, senha_salt FROM usuarios WHERE id = ?
    `).get(req.usuario.id);
    const senhaAtualValida = credencialAtual && typeof senhaAtual === "string" && await verificarSenha(
      senhaAtual,
      credencialAtual.senha_salt,
      credencialAtual.senha_hash,
    );
    if (!senhaAtualValida) {
      return res.status(400).json({ erro: "A senha atual está incorreta." });
    }

    const credencialNova = await criarHashSenha(novaSenha);
    let sessao;
    if (db.dialect === "postgres") {
      sessao = await db.transaction(async (tx) => {
        await tx.prepare(`
          UPDATE usuarios
          SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0
          WHERE id = ?
        `).run(credencialNova.hash, credencialNova.salt, req.usuario.id);
        await revogarSessoesUsuario(req.usuario.id, tx);
        return criarSessao(req.usuario.id, tx);
      })();
    } else {
      const atualizarESessao = db.transaction(() => {
        db.prepare(`
          UPDATE usuarios
          SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0
          WHERE id = ?
        `).run(credencialNova.hash, credencialNova.salt, req.usuario.id);
        revogarSessoesUsuario(req.usuario.id);
        return criarSessao(req.usuario.id);
      });
      sessao = atualizarESessao();
    }
    definirCookie(res, sessao.token);
    res.json({ mensagem: "Senha atualizada.", csrfToken: sessao.csrfToken });
  } catch (erro) {
    console.error("Falha ao atualizar senha:", erro);
    res.status(500).json({ erro: "Não foi possível atualizar a senha." });
  }
});

module.exports = router;
