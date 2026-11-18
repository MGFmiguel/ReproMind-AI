const express = require("express");
const router = express.Router();
const db = require("../database/database");
const {
  buscarUsuarioPorCredencial,
  criarHashSenha,
  criarSessao,
  revogarSessao,
  revogarSessoesUsuario,
  normalizarNomeUsuario,
  validarSenha,
  verificarSenha,
} = require("../services/autenticacao");
const {
  exigirAutenticacao,
  exigirCsrf,
} = require("../middleware/autenticacao");

const MAX_TENTATIVAS_POR_CREDENCIAL = 10;
const MAX_TENTATIVAS_POR_IP = 50;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const tentativasPorCredencial = new Map();
const tentativasPorIp = new Map();
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

function lerTentativaAtiva(mapa, chave, agora) {
  const tentativa = mapa.get(chave);
  if (tentativa && tentativa.inicio + JANELA_TENTATIVAS_MS <= agora) {
    mapa.delete(chave);
    return null;
  }
  return tentativa || null;
}

function chaveCredencial(ip, nomeUsuario) {
  return `${ip}\u0000${normalizarNomeUsuario(nomeUsuario)}`;
}

function tempoBloqueio(ip, nomeUsuario, agora) {
  const tentativaCredencial = lerTentativaAtiva(
    tentativasPorCredencial,
    chaveCredencial(ip, nomeUsuario),
    agora,
  );
  const tentativaIp = lerTentativaAtiva(tentativasPorIp, ip, agora);
  const esperas = [];

  if (tentativaCredencial?.quantidade >= MAX_TENTATIVAS_POR_CREDENCIAL) {
    esperas.push(tentativaCredencial.inicio + JANELA_TENTATIVAS_MS - agora);
  }
  if (tentativaIp?.quantidade >= MAX_TENTATIVAS_POR_IP) {
    esperas.push(tentativaIp.inicio + JANELA_TENTATIVAS_MS - agora);
  }

  return esperas.length ? Math.ceil(Math.max(...esperas) / 1000) : 0;
}

function registrarFalhaLogin(ip, nomeUsuario, agora) {
  const chaves = [
    [tentativasPorCredencial, chaveCredencial(ip, nomeUsuario)],
    [tentativasPorIp, ip],
  ];
  for (const [mapa, chave] of chaves) {
    const atual = lerTentativaAtiva(mapa, chave, agora);
    mapa.set(chave, {
      inicio: atual?.inicio || agora,
      quantidade: (atual?.quantidade || 0) + 1,
    });
  }
}

function limparTentativasExpiradas() {
  const agora = Date.now();
  for (const mapa of [tentativasPorCredencial, tentativasPorIp]) {
    for (const [chave, tentativa] of mapa) {
      if (tentativa.inicio + JANELA_TENTATIVAS_MS <= agora) mapa.delete(chave);
    }
  }
}

const temporizadorLimpeza = setInterval(limparTentativasExpiradas, 60 * 1000);
temporizadorLimpeza.unref?.();

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
  const agora = Date.now();
  const nomeUsuario = req.body?.nomeUsuario;
  const senha = req.body?.senha;
  if (
    typeof nomeUsuario !== "string" || nomeUsuario.length > 32 ||
    typeof senha !== "string" || senha.length > 128
  ) {
    return res.status(400).json({ erro: "Informe nome de usuário e senha." });
  }

  const espera = tempoBloqueio(ip, nomeUsuario, agora);
  if (espera > 0) {
    res.set("Retry-After", String(espera));
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde antes de tentar novamente." });
  }

  try {
    const usuario = await buscarUsuarioPorCredencial(nomeUsuario, senha);
    if (!usuario) {
      registrarFalhaLogin(ip, nomeUsuario, agora);
      return res.status(401).json({ erro: "Nome de usuário ou senha inválidos." });
    }

    // Limpa apenas as falhas deste usuário e IP, sem apagar as falhas de
    // outras pessoas que possam compartilhar o mesmo endereço de rede.
    tentativasPorCredencial.delete(chaveCredencial(ip, nomeUsuario));
    if (req.sessao?.token_hash) revogarSessao(req.sessao.token_hash);
    const sessao = criarSessao(usuario.id);
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

router.post("/logout", exigirAutenticacao, exigirCsrf, (req, res) => {
  revogarSessao(req.sessao.token_hash);
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
    const credencialAtual = db.prepare(`
      SELECT senha_hash, senha_salt FROM usuarios WHERE id = ?
    `).get(req.usuario.id);
    const senhaAtualValida = typeof senhaAtual === "string" && await verificarSenha(
      senhaAtual,
      credencialAtual.senha_salt,
      credencialAtual.senha_hash,
    );
    if (!senhaAtualValida) {
      return res.status(400).json({ erro: "A senha atual está incorreta." });
    }

    const credencialNova = await criarHashSenha(novaSenha);
    const atualizarESessao = db.transaction(() => {
      db.prepare(`
        UPDATE usuarios
        SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0
        WHERE id = ?
      `).run(credencialNova.hash, credencialNova.salt, req.usuario.id);
      revogarSessoesUsuario(req.usuario.id);
      return criarSessao(req.usuario.id);
    });
    const sessao = atualizarESessao();
    definirCookie(res, sessao.token);
    res.json({ mensagem: "Senha atualizada.", csrfToken: sessao.csrfToken });
  } catch (erro) {
    console.error("Falha ao atualizar senha:", erro);
    res.status(500).json({ erro: "Não foi possível atualizar a senha." });
  }
});

module.exports = router;
