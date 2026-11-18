const fetchOriginal = window.fetch.bind(window);
let sessaoAtual = null;
let tokenCsrf = "";

window.reproAuthReady = fetchOriginal("/api/auth/me")
  .then(async (resposta) => {
    if (!resposta.ok) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
      return null;
    }
    const dados = await resposta.json();
    sessaoAtual = dados.usuario;
    tokenCsrf = dados.csrfToken;

    if (sessaoAtual.deveTrocarSenha && window.location.pathname !== "/alterar-senha.html") {
      window.location.replace("/alterar-senha.html");
      return null;
    }
    adicionarControlesSessao();
    return sessaoAtual;
  })
  .catch(() => {
    window.location.replace("/login.html");
    return null;
  });

window.apiFetch = async (input, init = {}) => {
  const usuario = await window.reproAuthReady;
  if (!usuario) throw new Error("A sessão não está autenticada.");

  const url = new URL(input, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return fetchOriginal(input, init);
  }

  const headers = new Headers(init.headers || {});
  const metodo = (init.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    headers.set("X-CSRF-Token", tokenCsrf);
  }

  const resposta = await fetchOriginal(input, { ...init, headers, credentials: "same-origin" });
  if (resposta.status === 401) {
    window.location.replace("/login.html");
  } else if (resposta.status === 403) {
    const dados = await resposta.clone().json().catch(() => ({}));
    if (dados.codigo === "TROCA_SENHA_OBRIGATORIA") {
      window.location.replace("/alterar-senha.html");
    }
  }
  return resposta;
};

window.fetch = window.apiFetch;

function adicionarControlesSessao() {
  const topo = document.querySelector(".topbar");
  if (!topo || document.getElementById("controlesSessao")) return;

  const controles = document.createElement("div");
  controles.id = "controlesSessao";
  controles.className = "session-controls";

  const usuario = document.createElement("span");
  usuario.textContent = `Usuário: ${sessaoAtual.nomeUsuario}`;
  controles.appendChild(usuario);

  const alterar = document.createElement("a");
  alterar.href = "/alterar-senha.html";
  alterar.textContent = "Trocar senha";
  controles.appendChild(alterar);

  const sair = document.createElement("button");
  sair.type = "button";
  sair.textContent = "Sair";
  sair.addEventListener("click", async () => {
    await window.apiFetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login.html");
  });
  controles.appendChild(sair);
  topo.appendChild(controles);
}
