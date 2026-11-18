const formLogin = document.getElementById("formLogin");
const mensagemLogin = document.getElementById("mensagemLogin");

fetch("/api/auth/me")
  .then((resposta) => {
    if (resposta.ok) window.location.replace("/");
  })
  .catch(() => {});

formLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mensagemLogin.textContent = "Verificando acesso...";

  try {
    const resposta = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nomeUsuario: document.getElementById("nomeUsuario").value,
        senha: document.getElementById("senha").value,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível entrar.");

    const destino = new URLSearchParams(window.location.search).get("next");
    const rotasPermitidas = ["/", "/index.html", "/historico.html", "/investigacao.html", "/relatorio.html", "/usuarios.html"];
    let caminho = "/";
    if (destino) {
      try {
        const url = new URL(destino, window.location.origin);
        if (url.origin === window.location.origin && rotasPermitidas.includes(url.pathname)) {
          caminho = `${url.pathname}${url.search}`;
        }
      } catch {}
    }

    window.location.replace(dados.usuario.deveTrocarSenha ? "/alterar-senha.html" : caminho);
  } catch (erro) {
    mensagemLogin.textContent = erro.message;
  }
});
