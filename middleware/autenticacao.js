const { buscarSessao } = require("../services/autenticacao");

function lerCookie(req, nome) {
  const cookies = (req.headers.cookie || "").split(";");
  const prefixo = `${nome}=`;
  const cookie = cookies.find((item) => item.trim().startsWith(prefixo));
  return cookie ? cookie.trim().slice(prefixo.length) : "";
}

function carregarSessao(req, res, next) {
  try {
    const token = lerCookie(req, "repromind.sid");
    req.sessao = token ? buscarSessao(token) : null;
    req.tokenSessao = token || null;
    req.usuario = req.sessao
      ? {
          id: req.sessao.id,
          nomeUsuario: req.sessao.nome_usuario,
          papel: req.sessao.papel,
          deveTrocarSenha: Boolean(req.sessao.deve_trocar_senha),
        }
      : null;
    next();
  } catch (erro) {
    next(erro);
  }
}

function exigirAutenticacao(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: "Autenticação necessária." });
  next();
}

function exigirSenhaAtualizada(req, res, next) {
  if (req.usuario?.deveTrocarSenha) {
    return res.status(403).json({
      erro: "Troque a senha inicial antes de continuar.",
      codigo: "TROCA_SENHA_OBRIGATORIA",
    });
  }
  next();
}

function exigirAdmin(req, res, next) {
  if (req.usuario?.papel !== "admin") {
    return res.status(403).json({ erro: "Acesso restrito ao administrador." });
  }
  next();
}

function exigirCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const tokenEnviado = req.get("X-CSRF-Token");
  const enviado = typeof tokenEnviado === "string" ? Buffer.from(tokenEnviado) : Buffer.alloc(0);
  const esperado = Buffer.from(req.sessao?.csrf_token || "");
  if (
    enviado.length !== esperado.length ||
    esperado.length === 0 ||
    !require("crypto").timingSafeEqual(enviado, esperado)
  ) {
    return res.status(403).json({ erro: "Token de segurança inválido ou ausente." });
  }
  next();
}

function exigirPagina(req, res, next) {
  if (!req.usuario) {
    const destino = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?next=${destino}`);
  }
  if (req.usuario.deveTrocarSenha && req.path !== "/alterar-senha.html") {
    return res.redirect("/alterar-senha.html");
  }
  next();
}

module.exports = {
  carregarSessao,
  exigirAdmin,
  exigirAutenticacao,
  exigirCsrf,
  exigirPagina,
  exigirSenhaAtualizada,
};
