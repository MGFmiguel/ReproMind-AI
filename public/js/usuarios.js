const formUsuario = document.getElementById("formUsuario");
const listaUsuarios = document.getElementById("listaUsuarios");
const mensagemUsuario = document.getElementById("mensagemUsuario");

async function carregarUsuarios() {
  try {
    const resposta = await fetch("/api/usuarios");
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível carregar os usuários.");

    listaUsuarios.replaceChildren();
    if (dados.usuarios.length === 0) {
      listaUsuarios.textContent = "Nenhum usuário cadastrado.";
      return;
    }

    dados.usuarios.forEach((usuario) => {
      const card = document.createElement("article");
      card.className = "history-card user-card";
      const titulo = document.createElement("h3");
      titulo.textContent = usuario.nome_usuario;
      const detalhes = document.createElement("p");
      detalhes.textContent = `${usuario.papel === "admin" ? "Administrador" : "Membro"} · ${usuario.ativo ? "Ativo" : "Desativado"}${usuario.deve_trocar_senha ? " · troca de senha pendente" : ""}`;
      card.append(titulo, detalhes);

      if (usuario.papel !== "admin") {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.textContent = usuario.ativo ? "Desativar" : "Ativar";
        botao.addEventListener("click", async () => {
          try {
            const resposta = await fetch(`/api/usuarios/${usuario.id}/ativo`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ativo: !usuario.ativo }),
            });
            const resultado = await resposta.json();
            if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível atualizar a conta.");
            await carregarUsuarios();
          } catch (erro) {
            mensagemUsuario.textContent = erro.message;
          }
        });
        const formRedefinicao = document.createElement("form");
        formRedefinicao.className = "user-password-form";
        formRedefinicao.hidden = true;
        const senhaTemporaria = document.createElement("input");
        senhaTemporaria.type = "password";
        senhaTemporaria.required = true;
        senhaTemporaria.minLength = 6;
        senhaTemporaria.maxLength = 128;
        senhaTemporaria.autocomplete = "new-password";
        senhaTemporaria.setAttribute("aria-label", `Nova senha temporária para ${usuario.nome_usuario}`);
        const salvarSenha = document.createElement("button");
        salvarSenha.type = "submit";
        salvarSenha.textContent = "Confirmar redefinição";
        formRedefinicao.append(senhaTemporaria, salvarSenha);

        const redefinir = document.createElement("button");
        redefinir.type = "button";
        redefinir.textContent = "Redefinir senha";
        redefinir.addEventListener("click", () => {
          formRedefinicao.hidden = !formRedefinicao.hidden;
          if (!formRedefinicao.hidden) senhaTemporaria.focus();
        });
        formRedefinicao.addEventListener("submit", async (evento) => {
          evento.preventDefault();
          try {
            const resposta = await fetch(`/api/usuarios/${usuario.id}/redefinir-senha`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ senhaTemporaria: senhaTemporaria.value }),
            });
            const resultado = await resposta.json();
            if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível redefinir a senha.");
            mensagemUsuario.textContent = resultado.mensagem;
            await carregarUsuarios();
          } catch (erro) {
            mensagemUsuario.textContent = erro.message;
          }
        });
        card.append(botao, redefinir, formRedefinicao);
      }

      listaUsuarios.appendChild(card);
    });
  } catch (erro) {
    listaUsuarios.textContent = erro.message;
  }
}

formUsuario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  mensagemUsuario.textContent = "Criando conta...";
  try {
    const resposta = await fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nomeUsuario: document.getElementById("novoNomeUsuario").value,
        senhaTemporaria: document.getElementById("senhaTemporaria").value,
      }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível criar a conta.");
    mensagemUsuario.textContent = dados.mensagem;
    formUsuario.reset();
    await carregarUsuarios();
  } catch (erro) {
    mensagemUsuario.textContent = erro.message;
  }
});

carregarUsuarios();
