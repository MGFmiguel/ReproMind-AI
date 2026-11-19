require("dotenv").config();

const express = require("express");
const path = require("path");

const db = require("./database/connection");
const { carregarSessao, exigirAutenticacao, exigirCsrf, exigirPagina, exigirSenhaAtualizada } = require("./middleware/autenticacao");
const { inicializarAdmin } = require("./services/autenticacao");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const arquivosPublicos = path.join(__dirname, "public");
let inicializacaoBanco = null;
let erroInicializacaoBanco = null;
let proximaTentativaInicializacaoBanco = 0;
const INTERVALO_RETENTATIVA_INICIALIZACAO_MS = 1000;

function garantirBancoInicializado() {
  if (inicializacaoBanco) return inicializacaoBanco;
  if (Date.now() < proximaTentativaInicializacaoBanco) {
    return Promise.reject(erroInicializacaoBanco);
  }

  inicializacaoBanco = Promise.resolve()
    .then(() => (db.dialect === "postgres" ? db.ping() : undefined))
    .then(() => inicializarAdmin())
    .then(() => {
      erroInicializacaoBanco = null;
      proximaTentativaInicializacaoBanco = 0;
    })
    .catch((erro) => {
      inicializacaoBanco = null;
      erroInicializacaoBanco = erro;
      proximaTentativaInicializacaoBanco = Date.now() + INTERVALO_RETENTATIVA_INICIALIZACAO_MS;
      throw erro;
    });

  return inicializacaoBanco;
}

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  // A Vercel edge replaces X-Forwarded-For with the requester's public IP.
  app.set("trust proxy", true);
}
app.use(express.json({ limit: "50kb" }));
app.use((req, res, next) => {
  garantirBancoInicializado().then(() => next(), next);
});
app.use(carregarSessao);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Rotas da API
const ocorrenciasRoutes = require("./routes/ocorrencias");
const investigacaoRoutes = require("./routes/investigacao");
const iaRoutes = require("./routes/ia");
const authRoutes = require("./routes/auth");
const usuariosRoutes = require("./routes/usuarios");

app.use("/api/auth", authRoutes);
app.use("/api/ocorrencias", exigirAutenticacao, exigirSenhaAtualizada, exigirCsrf, ocorrenciasRoutes);
app.use("/api/investigacao", exigirAutenticacao, exigirSenhaAtualizada, exigirCsrf, investigacaoRoutes);
app.use("/api/ia", exigirAutenticacao, exigirSenhaAtualizada, exigirCsrf, iaRoutes);
app.use("/api/usuarios", usuariosRoutes);

const paginasHtml = path.join(__dirname, "views");
app.get("/login.html", (req, res) => {
  if (req.usuario) {
    return res.redirect(req.usuario.deveTrocarSenha ? "/alterar-senha.html" : "/");
  }
  res.sendFile(path.join(paginasHtml, "login.html"));
});

app.get("/registro.html", (req, res) => {
  if (req.usuario) {
    return res.redirect(req.usuario.deveTrocarSenha ? "/alterar-senha.html" : "/");
  }
  res.sendFile(path.join(paginasHtml, "registro.html"));
});

app.get("/alterar-senha.html", (req, res) => {
  if (!req.usuario) return res.redirect("/login.html");
  res.sendFile(path.join(paginasHtml, "alterar-senha.html"));
});

app.get("/usuarios.html", exigirPagina, (req, res) => {
  if (req.usuario.papel !== "admin") return res.redirect("/");
  res.sendFile(path.join(paginasHtml, "usuarios.html"));
});

for (const pagina of ["/", "/index.html", "/investigacao.html", "/historico.html", "/relatorio.html"]) {
  app.get(pagina, exigirPagina, (req, res) => {
    res.sendFile(path.join(paginasHtml, pagina === "/" ? "index.html" : pagina.slice(1)));
  });
}

app.use("/css", express.static(path.join(arquivosPublicos, "css")));
app.use("/js", express.static(path.join(arquivosPublicos, "js")));

app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  if (erro.type === "entity.too.large") {
    return res.status(413).json({ erro: "A requisição excede o limite de 50 KB." });
  }
  if (erro instanceof SyntaxError && erro.status === 400 && "body" in erro) {
    return res.status(400).json({ erro: "O corpo da requisição contém JSON inválido." });
  }
  console.error("Erro não tratado na requisição:", erro);
  return res.status(500).json({ erro: "Não foi possível processar a requisição." });
});

if (require.main === module) {
  garantirBancoInicializado().then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Servidor iniciado: http://${HOST}:${PORT}`);
    });
  }, (erro) => {
    const codigo = typeof erro.code === "string" ? erro.code : "erro_interno";
    console.error("Falha ao inicializar o banco e a conta administrativa:", codigo);
    process.exitCode = 1;
  });
}

module.exports = app;
