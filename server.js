require("dotenv").config();

const express = require("express");
const path = require("path");

require("./database/database");
const { carregarSessao, exigirAutenticacao, exigirCsrf, exigirPagina, exigirSenhaAtualizada } = require("./middleware/autenticacao");
const { inicializarAdmin } = require("./services/autenticacao");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
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

const arquivosPublicos = path.join(__dirname, "public");
app.get("/login.html", (req, res) => {
  if (req.usuario) {
    return res.redirect(req.usuario.deveTrocarSenha ? "/alterar-senha.html" : "/");
  }
  res.sendFile(path.join(arquivosPublicos, "login.html"));
});

app.get("/alterar-senha.html", (req, res) => {
  if (!req.usuario) return res.redirect("/login.html");
  res.sendFile(path.join(arquivosPublicos, "alterar-senha.html"));
});

app.get("/usuarios.html", exigirPagina, (req, res) => {
  if (req.usuario.papel !== "admin") return res.redirect("/");
  res.sendFile(path.join(arquivosPublicos, "usuarios.html"));
});

for (const pagina of ["/", "/index.html", "/investigacao.html", "/historico.html", "/relatorio.html"]) {
  app.get(pagina, exigirPagina, (req, res) => {
    res.sendFile(path.join(arquivosPublicos, pagina === "/" ? "index.html" : pagina.slice(1)));
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

inicializarAdmin()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Servidor iniciado: http://${HOST}:${PORT}`);
    });
  })
  .catch((erro) => {
    console.error("Falha ao inicializar a conta de administrador:", erro);
    process.exitCode = 1;
  });
