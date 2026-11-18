const lista = document.getElementById("listaHistorico");

const pesquisa = document.getElementById("pesquisa");
const filtroPrioridade = document.getElementById("filtroPrioridade");
const filtroStatus = document.getElementById("filtroStatus");

let ocorrencias = [];

// Buscar ocorrências no banco
async function carregarHistorico() {
  try {
    const resposta = await fetch("/api/ocorrencias");

    if (!resposta.ok) {
      throw new Error("Não foi possível carregar o histórico.");
    }

    ocorrencias = await resposta.json();

    atualizarIndicadores();
    renderizarHistorico();
  } catch (erro) {
    lista.textContent = erro.message;
    console.error(erro);
  }
}

// Atualizar indicadores
function atualizarIndicadores() {
  document.getElementById("total").textContent = ocorrencias.length;

  document.getElementById("abertas").textContent = ocorrencias.filter(
    (item) => item.status === "Aberta",
  ).length;

  document.getElementById("altas").textContent = ocorrencias.filter(
    (item) => item.prioridade === "Alta" || item.prioridade === "Crítica" || item.prioridade === "Critica",
  ).length;
}

// Renderizar histórico
function renderizarHistorico() {
  const termo = pesquisa.value.toLowerCase().trim();
  const prioridade = filtroPrioridade.value;
  const status = filtroStatus.value;

  const filtradas = ocorrencias.filter((item) => {
    const correspondePesquisa =
      item.titulo.toLowerCase().includes(termo) ||
      item.descricao.toLowerCase().includes(termo);

    const prioridadeNormalizada = item.prioridade === "Media"
      ? "Média"
      : item.prioridade === "Critica"
        ? "Crítica"
        : item.prioridade;
    const correspondePrioridade = !prioridade || prioridadeNormalizada === prioridade;

    const correspondeStatus = !status || item.status === status;

    return correspondePesquisa && correspondePrioridade && correspondeStatus;
  });

  lista.innerHTML = "";

  if (filtradas.length === 0) {
    lista.textContent = "Nenhuma ocorrência encontrada.";
    return;
  }

  filtradas.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-card";

    const titulo = document.createElement("h3");
    titulo.textContent = item.titulo;

    const descricao = document.createElement("p");
    descricao.textContent = item.descricao;

    const informacoes = document.createElement("div");
    informacoes.className = "history-info";

    const prioridadeTag = document.createElement("span");
    prioridadeTag.className = "tag";
    prioridadeTag.textContent = `Prioridade: ${item.prioridade}`;

    const statusTag = document.createElement("span");
    statusTag.className = "tag";
    statusTag.textContent = `Status: ${item.status}`;

    informacoes.append(prioridadeTag, statusTag);

    const botoes = document.createElement("div");
    botoes.className = "history-actions";

    const seletorStatus = document.createElement("select");

    seletorStatus.className = "status-select";

    const statusDisponiveis = ["Aberta", "Em investigação", "Concluída"];

    statusDisponiveis.forEach((status) => {
      const opcao = document.createElement("option");

      opcao.value = status;
      opcao.textContent = status;

      if (item.status === status) {
        opcao.selected = true;
      }

      seletorStatus.appendChild(opcao);
    });

    const salvarStatus = document.createElement("button");

    salvarStatus.textContent = "Atualizar status";

    salvarStatus.addEventListener("click", async () => {
      salvarStatus.disabled = true;
      salvarStatus.textContent = "Salvando...";

      try {
        const resposta = await fetch(`/api/ocorrencias/${item.id}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: seletorStatus.value,
          }),
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
          throw new Error(dados.erro);
        }

        item.status = dados.status;

        atualizarIndicadores();
        renderizarHistorico();
      } catch (erro) {
        alert(erro.message);
        salvarStatus.disabled = false;
        salvarStatus.textContent = "Atualizar status";
      }
    });

    botoes.append(seletorStatus, salvarStatus);

    const investigar = document.createElement("button");
    investigar.textContent = "Investigar";

    investigar.addEventListener("click", () => {
      window.location.href = `/investigacao.html?id=${item.id}`;
    });

    const relatorio = document.createElement("button");
    relatorio.textContent = "Ver relatório";

    relatorio.addEventListener("click", () => {
      window.location.href = `/relatorio.html?id=${item.id}`;
    });

    const editar = document.createElement("button");
    editar.type = "button";
    editar.textContent = "Editar ocorrência";
    const formularioEdicao = document.createElement("form");
    formularioEdicao.className = "occurrence-edit-form";
    formularioEdicao.hidden = true;

    const campoTitulo = document.createElement("input");
    campoTitulo.type = "text";
    campoTitulo.maxLength = 200;
    campoTitulo.required = true;
    campoTitulo.setAttribute("aria-label", "Título da ocorrência");
    campoTitulo.value = item.titulo;

    const campoDescricao = document.createElement("textarea");
    campoDescricao.maxLength = 5000;
    campoDescricao.required = true;
    campoDescricao.setAttribute("aria-label", "Descrição da ocorrência");
    campoDescricao.value = item.descricao;

    const campoCategoria = document.createElement("select");
    campoCategoria.setAttribute("aria-label", "Categoria da ocorrência");
    ["Não definida", "Frontend", "Backend", "Banco de dados", "Integração", "Outro"].forEach((categoria) => {
      const opcao = document.createElement("option");
      opcao.value = categoria;
      opcao.textContent = categoria;
      opcao.selected = (item.categoria || "Não definida") === categoria;
      campoCategoria.appendChild(opcao);
    });

    const salvarEdicao = document.createElement("button");
    salvarEdicao.type = "submit";
    salvarEdicao.textContent = "Salvar edição";
    const cancelarEdicao = document.createElement("button");
    cancelarEdicao.type = "button";
    cancelarEdicao.textContent = "Cancelar";
    cancelarEdicao.addEventListener("click", () => {
      formularioEdicao.hidden = true;
      editar.hidden = false;
    });

    editar.addEventListener("click", () => {
      formularioEdicao.hidden = false;
      editar.hidden = true;
      campoTitulo.focus();
    });

    formularioEdicao.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      salvarEdicao.disabled = true;
      try {
        const resposta = await fetch(`/api/ocorrencias/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titulo: campoTitulo.value,
            descricao: campoDescricao.value,
            categoria: campoCategoria.value,
          }),
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || "Não foi possível atualizar a ocorrência.");
        Object.assign(item, dados.ocorrencia);
        renderizarHistorico();
      } catch (erro) {
        alert(erro.message);
        salvarEdicao.disabled = false;
      }
    });

    formularioEdicao.append(campoTitulo, campoDescricao, campoCategoria, salvarEdicao, cancelarEdicao);
    botoes.append(editar, investigar, relatorio);

    card.append(titulo, descricao, informacoes, botoes, formularioEdicao);

    lista.appendChild(card);
  });
}

// Eventos dos filtros
pesquisa.addEventListener("input", renderizarHistorico);

filtroPrioridade.addEventListener("change", renderizarHistorico);

filtroStatus.addEventListener("change", renderizarHistorico);

// Inicializar
carregarHistorico();
