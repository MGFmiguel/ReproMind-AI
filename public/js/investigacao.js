const parametros = new URLSearchParams(window.location.search);
const ocorrenciaId = parametros.get("id");

const chat = document.getElementById("chat");
const formulario = document.getElementById("formResposta");
const campoResposta = document.getElementById("resposta");
const botaoEnviar = document.getElementById("btnEnviar");
const conclusao = document.getElementById("conclusao");
const mensagem = document.getElementById("mensagemInvestigacao");

let perguntaAtual = null;

// Adicionar mensagem com segurança
function adicionarMensagem(texto, tipo) {
  const mensagemElemento = document.createElement("div");

  mensagemElemento.className = `chat-message ${tipo}`;
  mensagemElemento.textContent = texto;

  chat.appendChild(mensagemElemento);
  mensagemElemento.scrollIntoView({ behavior: "smooth" });
}

// Buscar dados da ocorrência
async function carregarOcorrencia() {
  if (!ocorrenciaId || !/^\d+$/.test(ocorrenciaId)) {
    throw new Error("ID da ocorrência inválido.");
  }

  const resposta = await fetch(`/api/ocorrencias/${ocorrenciaId}`);

  if (!resposta.ok) {
    throw new Error("Não foi possível encontrar a ocorrência.");
  }

  const ocorrencia = await resposta.json();

  document.getElementById("tituloInvestigacao").textContent = ocorrencia.titulo;
}

async function carregarRespostasAnteriores() {
  const resposta = await fetch(`/api/investigacao/${ocorrenciaId}/respostas`);
  const dados = await resposta.json();
  if (!resposta.ok) {
    throw new Error(dados.erro || "Não foi possível carregar as respostas anteriores.");
  }

  dados.respostas.forEach((item) => {
    adicionarMensagem(item.texto, "assistant");
    adicionarMensagem(item.resposta, "user");
  });
}

// Buscar próxima pergunta
async function carregarPergunta() {
  const resposta = await fetch(
    `/api/investigacao/${ocorrenciaId}/proxima-pergunta`,
  );

  const dados = await resposta.json();

  if (!resposta.ok) {
    throw new Error(dados.erro || "Erro ao carregar pergunta.");
  }

  if (dados.concluida) {
    formulario.hidden = true;
    conclusao.hidden = false;

    adicionarMensagem(
      "Concluímos a coleta inicial de informações. Obrigado pelas respostas!",
      "assistant",
    );

    return;
  }

  perguntaAtual = dados.pergunta;

  adicionarMensagem(dados.texto, "assistant");
}

// Enviar resposta
formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const respostaUsuario = campoResposta.value.trim();

  if (!respostaUsuario || !perguntaAtual) {
    return;
  }

  botaoEnviar.disabled = true;
  mensagem.textContent = "";

  try {
    const resposta = await fetch(
      `/api/investigacao/${ocorrenciaId}/respostas`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pergunta: perguntaAtual,
          resposta: respostaUsuario,
        }),
      },
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Erro ao salvar resposta.");
    }

    adicionarMensagem(respostaUsuario, "user");

    campoResposta.value = "";

    await carregarPergunta();
  } catch (erro) {
    mensagem.textContent = erro.message;
  } finally {
    botaoEnviar.disabled = false;
  }
});

// Iniciar investigação
async function iniciarInvestigacao() {
  try {
    await carregarOcorrencia();
    await carregarRespostasAnteriores();
    await carregarPergunta();
  } catch (erro) {
    adicionarMensagem(erro.message, "assistant");
    formulario.hidden = true;
  }
}

const botaoRelatorio = document.getElementById("gerarRelatorio");

botaoRelatorio.addEventListener("click", async () => {
  botaoRelatorio.disabled = true;
  botaoRelatorio.textContent = "Gerando relatório...";

  try {
    const resposta = await fetch(
      `/api/investigacao/${ocorrenciaId}/relatorio`,
      {
        method: "POST",
      },
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro);
    }

    window.location.href = `/relatorio.html?id=${ocorrenciaId}`;
  } catch (erro) {
    mensagem.textContent = erro.message;
    botaoRelatorio.disabled = false;
    botaoRelatorio.textContent = "Gerar relatório técnico";
  }
});

iniciarInvestigacao();
