const parametros = new URLSearchParams(window.location.search);
const ocorrenciaId = parametros.get("id");

const areaRelatorio = document.getElementById("relatorio");
const botaoImprimir = document.getElementById("imprimir");

const botaoIA = document.getElementById("analisarIA");
const statusIA = document.getElementById("statusIA");
const resultadoIA = document.getElementById("resultadoIA");
const tipoAnalise = document.getElementById("tipoAnalise");
let analisesSalvas = [];

botaoImprimir.addEventListener("click", () => {
  window.print();
});

// ===============================
// FUNÇÕES DE CRIAÇÃO DE SEÇÕES
// ===============================

function criarSecao(titulo, conteudo, classe = "") {
  const secao = document.createElement("section");
  secao.className = `report-section ${classe}`;

  const h2 = document.createElement("h2");
  h2.textContent = titulo;

  const p = document.createElement("p");
  p.textContent = conteudo || "Informação não disponível.";

  secao.append(h2, p);
  return secao;
}

function criarLista(titulo, itens, classe = "") {
  const secao = document.createElement("section");
  secao.className = `report-section ${classe}`;

  const h2 = document.createElement("h2");
  h2.textContent = titulo;

  const ul = document.createElement("ul");

  (itens || []).forEach((texto) => {
    const li = document.createElement("li");
    li.textContent = texto;
    ul.appendChild(li);
  });

  secao.append(h2, ul);
  return secao;
}

// ===============================
// TESTES PRIORITÁRIOS
// ===============================

function criarTestesPrioritarios(testes) {
  const secao = document.createElement("section");
  secao.className = "report-section priority-tests";

  const titulo = document.createElement("h2");
  titulo.textContent = "Testes prioritários";

  secao.appendChild(titulo);

  if (!testes || testes.length === 0) {
    const mensagem = document.createElement("p");
    mensagem.textContent = "Nenhum teste prioritizado disponível.";
    secao.appendChild(mensagem);
    return secao;
  }

  testes.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "priority-test-card";

    const cabecalho = document.createElement("div");
    cabecalho.className = "priority-test-header";

    const numero = document.createElement("span");
    numero.className = "priority-test-number";
    numero.textContent = `Teste ${item.ordem || index + 1}`;

    const badge = document.createElement("span");

    const prioridade = (item.prioridade || "Média")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    badge.className = `priority-test-badge priority-${prioridade}`;
    badge.textContent = item.prioridade || "Média";

    cabecalho.append(numero, badge);

    const teste = document.createElement("h3");
    teste.textContent = item.teste || "Teste não informado.";

    const motivoTitulo = document.createElement("strong");
    motivoTitulo.textContent = "Por que este teste?";

    const motivo = document.createElement("p");
    motivo.textContent =
      item.motivo || "Teste recomendado para coletar informações.";

    card.append(cabecalho, teste, motivoTitulo, motivo);

    secao.appendChild(card);
  });

  return secao;
}

// ===============================
// RENDERIZAR ANÁLISE DE IA
// ===============================

function renderizarAnaliseIA(relatorioIA, analiseTexto = "") {
  resultadoIA.innerHTML = "";
  resultadoIA.className = "ai-result visible";

  if (relatorioIA?.modo === "SIMULADO") {
    tipoAnalise.textContent = "ANÁLISE EM MODO SIMULADO";
    tipoAnalise.className = "ai-mode simulated";
  } else {
    tipoAnalise.textContent = "ANÁLISE COM IA";
    tipoAnalise.className = "ai-mode real";
  }

  if (!relatorioIA) {
    const analise = document.createElement("div");
    analise.className = "ai-analysis-text";
    analise.textContent = analiseTexto || "Análise não disponível.";

    resultadoIA.appendChild(analise);
    return;
  }

  // Resumo
  resultadoIA.appendChild(
    criarSecao("Resumo da ocorrência", relatorioIA.resumo),
  );
  // Testes prioritários
  resultadoIA.appendChild(
    criarTestesPrioritarios(relatorioIA.testes_priorizados),
  );

  // Informações coletadas
  const informacoes = relatorioIA.informacoes || {};

  const dadosInformacoes = [
    ["Categoria", informacoes.categoria],
    ["Prioridade", informacoes.prioridade],
    ["Frequência", informacoes.frequencia],
    ["Ambiente", informacoes.ambiente],
    ["Dispositivo ou navegador", informacoes.dispositivo],
    ["Mensagem de erro", informacoes.mensagemErro],
    ["Condições", informacoes.condicoes],
    ["Passos para reprodução", informacoes.passos],
  ];

  const secaoInfo = document.createElement("section");
  secaoInfo.className = "report-section";

  const tituloInfo = document.createElement("h2");
  tituloInfo.textContent = "Informações coletadas";

  const listaInfo = document.createElement("ul");

  dadosInformacoes.forEach(([titulo, valor]) => {
    if (valor && valor !== "Não informado") {
      const li = document.createElement("li");
      li.textContent = `${titulo}: ${valor}`;
      listaInfo.appendChild(li);
    }
  });

  if (Array.isArray(informacoes.relatoLegado)) {
    informacoes.relatoLegado.forEach((relato) => {
      const li = document.createElement("li");
      li.textContent = `Relato anterior: ${relato}`;
      listaInfo.appendChild(li);
    });
  }

  secaoInfo.append(tituloInfo, listaInfo);
  resultadoIA.appendChild(secaoInfo);

  // Hipóteses
  resultadoIA.appendChild(
    criarLista("Hipóteses de investigação", relatorioIA.hipoteses),
  );

  // Evidências
  resultadoIA.appendChild(
    criarLista("Evidências técnicas disponíveis", relatorioIA.evidencias),
  );

  // Testes
  resultadoIA.appendChild(
    criarLista("Testes recomendados", relatorioIA.testes),
  );

  // Confiança
  resultadoIA.appendChild(
    criarSecao("Nível de confiança", relatorioIA.confianca),
  );

  // Status
  resultadoIA.appendChild(
    criarSecao("Status da investigação", relatorioIA.status),
  );

  // Aviso
  const observacao = document.createElement("div");
  observacao.className = "report-note";

  observacao.textContent =
    "As hipóteses apresentadas são sugestões de investigação e não " +
    "representam causas raiz confirmadas. A validação depende de testes " +
    "e evidências técnicas.";

  resultadoIA.appendChild(observacao);
}

// ===============================
// CARREGAR RELATÓRIO
// ===============================

async function carregarRelatorio() {
  try {
    if (!ocorrenciaId || !/^\d+$/.test(ocorrenciaId)) {
      throw new Error("ID da ocorrência inválido.");
    }

    const resposta = await fetch(`/api/investigacao/${ocorrenciaId}/relatorio`);

    const relatorio = await resposta.json();

    if (!resposta.ok) {
      throw new Error(relatorio.erro || "Erro ao carregar relatório.");
    }

    areaRelatorio.innerHTML = "";

    // Cabeçalho
    const cabecalho = document.createElement("div");
    cabecalho.className = "report-header";

    const titulo = document.createElement("h1");
    titulo.textContent = "Relatório de Investigação";

    const subtitulo = document.createElement("p");
    subtitulo.textContent = `Ocorrência #${ocorrenciaId}`;

    cabecalho.append(titulo, subtitulo);
    areaRelatorio.appendChild(cabecalho);

    // Relatório tradicional
    areaRelatorio.appendChild(
      criarSecao("Resumo da ocorrência", relatorio.resumo, "report-summary"),
    );

    const informacoes = relatorio.informacoes || {};
    if (informacoes.descricaoInicial || informacoes.respostas || informacoes.relatoLegado) {
      const secaoRelatos = document.createElement("section");
      secaoRelatos.className = "report-section";
      const tituloRelatos = document.createElement("h2");
      tituloRelatos.textContent = "Relatos fornecidos";
      secaoRelatos.appendChild(tituloRelatos);

      if (informacoes.descricaoInicial) {
        const descricao = document.createElement("p");
        descricao.textContent = `Descrição inicial: ${informacoes.descricaoInicial}`;
        secaoRelatos.appendChild(descricao);
      }

      const respostasRelato = informacoes.respostas || {};
      const relatos = informacoes.relatoLegado || Object.entries(respostasRelato).map(([pergunta, resposta]) => `${pergunta}: ${resposta}`);
      if (relatos.length) {
        const listaRelatos = document.createElement("ul");
        relatos.forEach((relato) => {
          const item = document.createElement("li");
          item.textContent = relato;
          listaRelatos.appendChild(item);
        });
        secaoRelatos.appendChild(listaRelatos);
      }
      areaRelatorio.appendChild(secaoRelatos);
    }

    areaRelatorio.appendChild(
      criarSecao("Hipótese inicial", relatorio.hipotese, "report-hypothesis"),
    );

    areaRelatorio.appendChild(
      criarLista("Evidências técnicas registradas", relatorio.evidencias),
    );

    areaRelatorio.appendChild(
      criarLista(
        "Testes recomendados",
        relatorio.testes_sugeridos || relatorio.testes,
      ),
    );

    // Aviso técnico
    const observacao = document.createElement("div");
    observacao.className = "report-note";

    observacao.textContent =
      "Este relatório contém informações coletadas e hipóteses iniciais. " +
      "As hipóteses não representam conclusões definitivas e devem ser " +
      "validadas por meio de testes e análise técnica.";

    areaRelatorio.appendChild(observacao);

    // ===============================
    // CARREGAR ÚLTIMA ANÁLISE SALVA
    // ===============================

    if (relatorio.modo) {
      const relatorioIA = {
        modo: relatorio.modo,
        resumo: relatorio.resumo,
        informacoes,
        hipoteses: relatorio.hipoteses || [],
        evidencias: relatorio.evidencias || [],
        testes: relatorio.testes_sugeridos || relatorio.testes || [],
        confianca: relatorio.confianca,
        status: relatorio.status_investigacao,
        testes_priorizados: relatorio.testes_priorizados || [],
      };

      renderizarAnaliseIA(relatorioIA);

      statusIA.textContent = "Última análise salva carregada.";
      statusIA.className = "ai-status success";
    }
  } catch (erro) {
    areaRelatorio.textContent = erro.message;
    console.error(erro);
  }
}

// ===============================
// ANALISAR COM IA
// ===============================

botaoIA.addEventListener("click", async () => {
  botaoIA.disabled = true;
  botaoIA.textContent = "Analisando...";

  statusIA.textContent = "A inteligência artificial está analisando os dados.";

  statusIA.className = "ai-status loading";

  resultadoIA.innerHTML = "";
  resultadoIA.className = "ai-result";

  try {
    const resposta = await fetch(`/api/ia/analisar/${ocorrenciaId}`, {
      method: "POST",
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Erro na análise.");
    }

    renderizarAnaliseIA(dados.relatorio, dados.analise);

    statusIA.textContent = "Análise concluída! Verifique o resultado abaixo.";

    statusIA.className = "ai-status success";
  } catch (erro) {
    statusIA.textContent = erro.message;
    statusIA.className = "ai-status error";

    console.error(erro);
  } finally {
    botaoIA.disabled = false;
    botaoIA.textContent = "Analisar novamente";
  }
});

// ===============================
// OCORRÊNCIAS SEMELHANTES
// ===============================

async function carregarSimilares() {
  const listaSimilares = document.getElementById("listaSimilares");

  try {
    const resposta = await fetch(`/api/ocorrencias/${ocorrenciaId}/similares`);

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Erro ao buscar ocorrências.");
    }

    listaSimilares.innerHTML = "";

    if (dados.ocorrencias.length === 0) {
      listaSimilares.textContent =
        "Nenhuma ocorrência semelhante foi encontrada.";
      return;
    }

    dados.ocorrencias.forEach((ocorrencia) => {
      const card = document.createElement("div");
      card.className = "occurrence";

      const titulo = document.createElement("h3");
      titulo.textContent = ocorrencia.titulo;

      const descricao = document.createElement("p");
      descricao.textContent = ocorrencia.descricao;

      const categoria = document.createElement("p");
      categoria.textContent = `Categoria: ${ocorrencia.categoria || "Não definida"}`;

      const pontuacao = document.createElement("span");
      pontuacao.className = "tag";
      pontuacao.textContent = `Semelhança textual: ${ocorrencia.similaridade}%`;

      card.append(titulo, descricao, categoria, pontuacao);

      listaSimilares.appendChild(card);
    });
  } catch (erro) {
    listaSimilares.textContent = erro.message;
    console.error(erro);
  }
}

// ===============================
// RENDERIZAR LINHA DO TEMPO
// ===============================

function renderizarLinhaDoTempo(analises) {
  const linhaDoTempo = document.getElementById("linhaDoTempo");

  linhaDoTempo.innerHTML = "";

  if (!analises || analises.length === 0) {
    linhaDoTempo.textContent = "Nenhuma análise disponível.";
    return;
  }

  // Ordenar da análise mais antiga para a mais recente
  const analisesOrdenadas = [...analises].sort((a, b) => a.id - b.id);

  analisesOrdenadas.forEach((analise, indice) => {
    const item = document.createElement("div");
    item.className = "timeline-item";

    const marcador = document.createElement("div");
    marcador.className = "timeline-marker";

    const conteudo = document.createElement("div");
    conteudo.className = "timeline-content";

    const cabecalho = document.createElement("div");
    cabecalho.className = "timeline-header";

    const titulo = document.createElement("h3");
    titulo.textContent = `Análise #${analise.id}`;

    const modo = document.createElement("span");
    modo.className = `history-mode ${
      analise.modo === "SIMULADO" ? "simulated" : "real"
    }`;

    modo.textContent =
      analise.modo === "SIMULADO" ? "Modo simulado" : "IA real";

    cabecalho.append(titulo, modo);

    const data = document.createElement("p");
    data.className = "timeline-date";
    data.textContent = analise.data_criacao
      ? `Data: ${analise.data_criacao}`
      : "Data não disponível";

    const resumo = document.createElement("p");
    resumo.className = "timeline-summary";
    resumo.textContent = analise.resumo || "Resumo não disponível.";

    const detalhes = document.createElement("div");
    detalhes.className = "timeline-details";

    const confianca = document.createElement("p");
    confianca.textContent = `Confiança: ${
      analise.confianca || "Não informada"
    }`;

    const status = document.createElement("p");
    status.textContent = `Status: ${
      analise.status_investigacao || analise.status || "Não informado"
    }`;

    detalhes.append(confianca, status);

    const numero = document.createElement("span");
    numero.className = "timeline-step";
    numero.textContent = `Etapa ${indice + 1}`;

    conteudo.append(numero, cabecalho, data, resumo, detalhes);

    item.append(marcador, conteudo);
    linhaDoTempo.appendChild(item);
  });
}

// ===============================
// HISTÓRICO DE ANÁLISES
// ===============================

async function carregarHistoricoAnalises() {
  const areaHistorico = document.getElementById("historicoAnalises");

  try {
    const resposta = await fetch(`/api/ia/historico/${ocorrenciaId}`);

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Erro ao carregar histórico.");
    }

    analisesSalvas = dados.historico;
    renderizarLinhaDoTempo(analisesSalvas);

    areaHistorico.innerHTML = "";

    // ===============================
    // PREENCHER SELETORES DE COMPARAÇÃO
    // ===============================

    const selectAnterior = document.getElementById("analiseAnterior");
    const selectAtual = document.getElementById("analiseAtual");

    selectAnterior.innerHTML = '<option value="">Análise anterior</option>';
    selectAtual.innerHTML = '<option value="">Análise atual</option>';

    dados.historico.forEach((analise) => {
      const opcaoAnterior = document.createElement("option");
      opcaoAnterior.value = analise.id;
      opcaoAnterior.textContent = `Análise #${analise.id} - ${analise.data_criacao}`;

      const opcaoAtual = document.createElement("option");
      opcaoAtual.value = analise.id;
      opcaoAtual.textContent = `Análise #${analise.id} - ${analise.data_criacao}`;

      selectAnterior.appendChild(opcaoAnterior);
      selectAtual.appendChild(opcaoAtual);
    });

    if (dados.historico.length === 0) {
      areaHistorico.innerHTML = `
          <p class="empty">
            Nenhuma análise anterior encontrada.
          </p>
        `;
      return;
    }

    dados.historico.forEach((analise, indice) => {
      const card = document.createElement("div");
      card.className = "history-card";

      const cabecalho = document.createElement("div");
      cabecalho.className = "history-card-header";

      const titulo = document.createElement("h3");
      titulo.textContent = `Análise #${analise.id}`;

      const modo = document.createElement("span");
      modo.className = `history-mode ${
        analise.modo === "SIMULADO" ? "simulated" : "real"
      }`;

      modo.textContent =
        analise.modo === "SIMULADO" ? "Modo simulado" : "IA real";

      cabecalho.append(titulo, modo);

      const data = document.createElement("p");
      data.className = "history-date";
      data.textContent = `Data: ${analise.data_criacao || "Não disponível"}`;

      const resumo = document.createElement("p");
      resumo.className = "history-summary";
      resumo.textContent = analise.resumo || "Resumo não disponível.";

      const botao = document.createElement("button");
      botao.type = "button";
      botao.textContent = "Visualizar análise";

      botao.addEventListener("click", () => {
        renderizarAnaliseIA(analise);

        statusIA.textContent = `Visualizando análise histórica #${analise.id}`;

        statusIA.className = "ai-status success";

        resultadoIA.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });

      card.append(cabecalho, data, resumo, botao);

      areaHistorico.appendChild(card);
    });
  } catch (erro) {
    areaHistorico.textContent = erro.message;
    console.error(erro);
  }
}

// ===============================
// COMPARAR ANÁLISES
// ===============================

document.getElementById("compararAnalises").addEventListener("click", () => {
  const selectAnterior = document.getElementById("analiseAnterior");
  const selectAtual = document.getElementById("analiseAtual");
  const areaComparacao = document.getElementById("resultadoComparacao");

  const idAnterior = selectAnterior.value;
  const idAtual = selectAtual.value;

  areaComparacao.innerHTML = "";

  if (!idAnterior || !idAtual) {
    areaComparacao.textContent = "Selecione duas análises para comparar.";
    return;
  }

  if (idAnterior === idAtual) {
    areaComparacao.textContent = "Selecione análises diferentes.";
    return;
  }

  const anterior = analisesSalvas.find(
    (analise) => String(analise.id) === idAnterior,
  );

  const atual = analisesSalvas.find(
    (analise) => String(analise.id) === idAtual,
  );

  if (!anterior || !atual) {
    areaComparacao.textContent = "Não foi possível localizar as análises.";
    return;
  }

  // Criar seção de comparação
  function criarBlocoComparacao(titulo, conteudo) {
    const bloco = document.createElement("section");
    bloco.className = "comparison-result-section";

    const h3 = document.createElement("h3");
    h3.textContent = titulo;

    const p = document.createElement("p");
    p.textContent = conteudo || "Informação não disponível.";

    bloco.append(h3, p);
    return bloco;
  }

  function compararListas(listaAnterior, listaAtual) {
    const anteriorLista = listaAnterior || [];
    const atualLista = listaAtual || [];

    const novas = atualLista.filter((item) => !anteriorLista.includes(item));

    const removidas = anteriorLista.filter(
      (item) => !atualLista.includes(item),
    );

    const mantidas = atualLista.filter((item) => anteriorLista.includes(item));

    return { novas, removidas, mantidas };
  }

  // Resumos
  areaComparacao.appendChild(
    criarBlocoComparacao("Resumo anterior", anterior.resumo),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao("Resumo atual", atual.resumo),
  );

  // ===============================
  // EVOLUÇÃO DAS HIPÓTESES
  // ===============================

  const resultadoHipoteses = compararListas(
    anterior.hipoteses || [],
    atual.hipoteses || [],
  );

  const secaoEvolucao = document.createElement("section");
  secaoEvolucao.className = "hypothesis-evolution";

  const tituloEvolucao = document.createElement("h3");
  tituloEvolucao.textContent = "Evolução das hipóteses";

  secaoEvolucao.appendChild(tituloEvolucao);

  function criarCardHipotese(texto, status, classe) {
    const card = document.createElement("div");
    card.className = `hypothesis-card ${classe}`;

    const badge = document.createElement("span");
    badge.className = "hypothesis-status";
    badge.textContent = status;

    const descricao = document.createElement("p");
    descricao.textContent = texto;

    card.append(badge, descricao);

    return card;
  }

  // Hipóteses novas
  resultadoHipoteses.novas.forEach((hipotese) => {
    secaoEvolucao.appendChild(
      criarCardHipotese(hipotese, "NOVA", "hypothesis-new"),
    );
  });

  // Hipóteses mantidas
  resultadoHipoteses.mantidas.forEach((hipotese) => {
    secaoEvolucao.appendChild(
      criarCardHipotese(hipotese, "MANTIDA", "hypothesis-maintained"),
    );
  });

  // Hipóteses que não aparecem mais
  resultadoHipoteses.removidas.forEach((hipotese) => {
    secaoEvolucao.appendChild(
      criarCardHipotese(
        hipotese,
        "NÃO LISTADA NA ANÁLISE ATUAL",
        "hypothesis-removed",
      ),
    );
  });

  const avisoEvolucao = document.createElement("p");
  avisoEvolucao.className = "hypothesis-evolution-note";

  avisoEvolucao.textContent =
    "A ausência de uma hipótese na análise atual não significa " +
    "que ela foi descartada. Sua validação depende de evidências " +
    "e testes técnicos.";

  secaoEvolucao.appendChild(avisoEvolucao);

  areaComparacao.appendChild(secaoEvolucao);

  // Evidências
  const resultadoEvidencias = compararListas(
    anterior.evidencias || [],
    atual.evidencias || [],
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Novas evidências",
      resultadoEvidencias.novas.join("\n") || "Nenhuma nova evidência.",
    ),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Evidências mantidas",
      resultadoEvidencias.mantidas.join("\n") || "Nenhuma evidência mantida.",
    ),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Evidências que não aparecem mais",
      resultadoEvidencias.removidas.join("\n") || "Nenhuma evidência removida.",
    ),
  );

  // Testes recomendados
  const testesAnterior = anterior.testes_sugeridos || anterior.testes || [];

  const testesAtual = atual.testes_sugeridos || atual.testes || [];

  const resultadoTestes = compararListas(testesAnterior, testesAtual);

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Novos testes recomendados",
      resultadoTestes.novas.join("\n") || "Nenhum novo teste recomendado.",
    ),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Testes mantidos",
      resultadoTestes.mantidas.join("\n") || "Nenhum teste mantido.",
    ),
  );

  // Confiança e status
  areaComparacao.appendChild(
    criarBlocoComparacao("Confiança anterior", anterior.confianca),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao("Confiança atual", atual.confianca),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Status anterior",
      anterior.status_investigacao || anterior.status,
    ),
  );

  areaComparacao.appendChild(
    criarBlocoComparacao(
      "Status atual",
      atual.status_investigacao || atual.status,
    ),
  );
});

// ===============================
// INICIALIZAÇÃO
// ===============================

carregarSimilares();
carregarRelatorio();
carregarHistoricoAnalises();
