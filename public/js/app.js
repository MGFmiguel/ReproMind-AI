const formulario = document.getElementById("formOcorrencia");
const lista = document.getElementById("listaOcorrencias");
const mensagem = document.getElementById("mensagem");

// ===============================
// CALCULAR PRIORIDADE
// ===============================

function calcularPrioridade() {
  const impacto = Number(document.getElementById("impacto").value);
  const frequencia = Number(document.getElementById("frequencia").value);
  const usuarios = Number(document.getElementById("usuariosAfetados").value);

  if (!impacto || !frequencia || !usuarios) {
    return "";
  }

  const pontuacao = impacto + frequencia + usuarios;

  if (pontuacao >= 9) return "Crítica";
  if (pontuacao >= 7) return "Alta";
  if (pontuacao >= 5) return "Média";

  return "Baixa";
}

// Atualizar prioridade automaticamente
document
  .getElementById("impacto")
  .addEventListener("change", atualizarPrioridade);
document
  .getElementById("frequencia")
  .addEventListener("change", atualizarPrioridade);
document
  .getElementById("usuariosAfetados")
  .addEventListener("change", atualizarPrioridade);

function atualizarPrioridade() {
  const prioridade = calcularPrioridade();

  if (prioridade) {
    document.getElementById("prioridade").value = prioridade;
  }
}

// ===============================
// BUSCAR OCORRÊNCIAS
// ===============================

async function carregarOcorrencias() {
  try {
    const resposta = await fetch("/api/ocorrencias");
    const ocorrencias = await resposta.json();

    gerarGraficos(ocorrencias);

    lista.innerHTML = "";

    if (ocorrencias.length === 0) {
      lista.innerHTML = '<p class="empty">Nenhuma ocorrência cadastrada.</p>';
    }

    ocorrencias.forEach((ocorrencia) => {
      const item = document.createElement("div");
      item.className = "occurrence";

      const titulo = document.createElement("h3");
      titulo.textContent = ocorrencia.titulo;

      const descricao = document.createElement("p");
      descricao.textContent = ocorrencia.descricao;

      const categoria = document.createElement("p");
      categoria.textContent = `Categoria: ${ocorrencia.categoria || "Não definida"}`;

      const prioridade = document.createElement("span");
      prioridade.className = "tag";
      prioridade.textContent = `Prioridade: ${ocorrencia.prioridade}`;

      // Botão de investigação
      const botaoInvestigar = document.createElement("button");
      botaoInvestigar.textContent = "Investigar com IA";

      botaoInvestigar.addEventListener("click", () => {
        window.location.href = `/investigacao.html?id=${ocorrencia.id}`;
      });

      item.append(titulo, descricao, categoria, prioridade, botaoInvestigar);

      lista.appendChild(item);
    });

    // ===============================
    // ATUALIZAR INDICADORES
    // ===============================

    document.getElementById("totalOcorrencias").textContent =
      ocorrencias.length;

    document.getElementById("abertas").textContent = ocorrencias.filter(
      (item) => item.status === "Aberta",
    ).length;

    document.getElementById("emInvestigacao").textContent = ocorrencias.filter(
      (item) => item.status === "Em investigação",
    ).length;

    document.getElementById("prioridadeAlta").textContent = ocorrencias.filter(
      (item) => ["Alta", "Crítica", "Critica"].includes(item.prioridade),
    ).length;
  } catch (erro) {
    lista.innerHTML = '<p class="empty">Erro ao carregar ocorrências.</p>';
    console.error(erro);
  }
}

// ===============================
// CADASTRAR OCORRÊNCIA
// ===============================

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const prioridadeCalculada = calcularPrioridade();

  if (!prioridadeCalculada) {
    mensagem.textContent = "Preencha todos os critérios de prioridade.";
    mensagem.style.color = "#f87171";
    return;
  }

  const dados = {
    titulo: document.getElementById("titulo").value,
    descricao: document.getElementById("descricao").value,
    categoria: document.getElementById("categoria").value,

    impacto: document.getElementById("impacto").value,
    frequencia: document.getElementById("frequencia").value,
    usuariosAfetados: document.getElementById("usuariosAfetados").value,

    prioridade: prioridadeCalculada,
  };

  try {
    const resposta = await fetch("/api/ocorrencias", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(dados),
    });

    const resultado = await resposta.json();

    if (!resposta.ok) {
      throw new Error(resultado.erro || "Não foi possível cadastrar.");
    }

    mensagem.textContent = resultado.mensagem;
    mensagem.style.color = "#86efac";

    formulario.reset();

    await carregarOcorrencias();
  } catch (erro) {
    mensagem.textContent = erro.message;
    mensagem.style.color = "#f87171";
  }
});

// ===============================
// GERAR GRÁFICOS
// ===============================

function gerarGraficos(ocorrencias) {
  const status = {
    Aberta: 0,
    "Em investigação": 0,
    Concluída: 0,
  };

  const prioridades = {
    Baixa: 0,
    Média: 0,
    Alta: 0,
    Crítica: 0,
  };

  ocorrencias.forEach((ocorrencia) => {
    if (status[ocorrencia.status] !== undefined) {
      status[ocorrencia.status]++;
    }

    // Compatibilidade com registros antigos
    const prioridadeNormalizada =
      ocorrencia.prioridade === "Media"
        ? "Média"
        : ocorrencia.prioridade === "Critica"
          ? "Crítica"
          : ocorrencia.prioridade;

    if (prioridades[prioridadeNormalizada] !== undefined) {
      prioridades[prioridadeNormalizada]++;
    }
  });

  renderizarGrafico("graficoStatus", status);
  renderizarGrafico("graficoPrioridade", prioridades);
}

// ===============================
// RENDERIZAR GRÁFICOS
// ===============================

function renderizarGrafico(elementoId, dados) {
  const container = document.getElementById(elementoId);

  if (!container) return;

  const total = Object.values(dados).reduce((soma, valor) => soma + valor, 0);

  container.innerHTML = "";

  Object.entries(dados).forEach(([nome, valor]) => {
    const porcentagem = total > 0 ? (valor / total) * 100 : 0;

    const linha = document.createElement("div");
    linha.className = "chart-row";

    linha.innerHTML = `
      <div class="chart-label">
        <span>${nome}</span>
        <strong>${valor}</strong>
      </div>

      <div class="chart-bar-bg">
        <div class="chart-bar" style="width: ${porcentagem}%"></div>
      </div>
    `;

    container.appendChild(linha);
  });
}

// ===============================
// INICIALIZAÇÃO
// ===============================

carregarOcorrencias();
