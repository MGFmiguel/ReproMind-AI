const formCadastro = document.getElementById("formCadastro");
const mensagemCadastro = document.getElementById("mensagemCadastro");
const botaoCadastro = formCadastro.querySelector('button[type="submit"]');

formCadastro.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  botaoCadastro.disabled = true;
  mensagemCadastro.textContent = "Criando conta...";

  try {
    const resposta = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nomeUsuario: document.getElementById("nomeUsuario").value,
        senha: document.getElementById("senha").value,
        confirmacao: document.getElementById("confirmacao").value,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível criar a conta.");

    formCadastro.reset();
    mensagemCadastro.textContent = dados.mensagem;
  } catch (erro) {
    mensagemCadastro.textContent = erro.message;
  } finally {
    botaoCadastro.disabled = false;
  }
});
