const formSenha = document.getElementById("formSenha");
const mensagemSenha = document.getElementById("mensagemSenha");
const botaoSalvar = formSenha.querySelector('button[type="submit"]');
let csrfToken = null;
let envioEmAndamento = false;

botaoSalvar.disabled = true;
mensagemSenha.textContent = "Verificando sessão...";

const sessaoPronta = fetch("/api/auth/me")
  .then(async (resposta) => {
    if (!resposta.ok) {
      window.location.replace("/login.html");
      return null;
    }
    const dados = await resposta.json();
    if (typeof dados.csrfToken !== "string" || dados.csrfToken.length === 0) {
      throw new Error("Não foi possível validar a sessão.");
    }
    csrfToken = dados.csrfToken;
    botaoSalvar.disabled = false;
    mensagemSenha.textContent = "";
    return csrfToken;
  })
  .catch(() => {
    window.location.replace("/login.html");
    return null;
  });

formSenha.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (envioEmAndamento) return;
  envioEmAndamento = true;
  botaoSalvar.disabled = true;

  try {
    const tokenCsrf = await sessaoPronta;
    if (!tokenCsrf) return;

    mensagemSenha.textContent = "Atualizando senha...";
    const resposta = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": tokenCsrf },
      body: JSON.stringify({
        senhaAtual: document.getElementById("senhaAtual").value,
        novaSenha: document.getElementById("novaSenha").value,
        confirmacao: document.getElementById("confirmacao").value,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível atualizar a senha.");
    window.location.replace("/");
  } catch (erro) {
    mensagemSenha.textContent = erro.message;
  } finally {
    envioEmAndamento = false;
    if (csrfToken) botaoSalvar.disabled = false;
  }
});
