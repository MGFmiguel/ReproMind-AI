const PRIORIDADES = ["Baixa", "Média", "Alta", "Crítica"];
const CATEGORIAS = [
  "Frontend",
  "Backend",
  "Banco de dados",
  "Integração",
  "Outro",
];
const STATUS = ["Aberta", "Em investigação", "Concluída"];

function calcularPrioridade(impacto, frequencia, usuariosAfetados) {
  const valores = [impacto, frequencia, usuariosAfetados].map(Number);
  const [impactoNumero, frequenciaNumero, usuariosNumero] = valores;

  if (
    !Number.isInteger(impactoNumero) || impactoNumero < 1 || impactoNumero > 5 ||
    !Number.isInteger(frequenciaNumero) || frequenciaNumero < 1 || frequenciaNumero > 3 ||
    !Number.isInteger(usuariosNumero) || usuariosNumero < 1 || usuariosNumero > 3
  ) {
    throw new TypeError("Os critérios de prioridade estão fora dos valores permitidos.");
  }

  const pontuacao = impactoNumero + frequenciaNumero + usuariosNumero;
  if (pontuacao >= 9) return "Crítica";
  if (pontuacao >= 7) return "Alta";
  if (pontuacao >= 5) return "Média";
  return "Baixa";
}

function normalizarPrioridade(valor) {
  if (valor === "Media") return "Média";
  if (valor === "Critica") return "Crítica";
  return valor;
}

function textoValido(valor, limite, obrigatorio = false) {
  if (typeof valor !== "string") return !obrigatorio && (valor === undefined || valor === null);
  const texto = valor.trim();
  return (!obrigatorio || texto.length > 0) && texto.length <= limite;
}

function validarCadastroOcorrencia(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { erro: "Envie os dados da ocorrência em formato JSON." };
  }

  const { titulo, descricao } = body;
  if (!textoValido(titulo, 200, true) || !textoValido(descricao, 5000, true)) {
    return { erro: "Título (até 200 caracteres) e descrição (até 5.000) são obrigatórios." };
  }

  const categoria = body.categoria || "Não definida";
  if (categoria !== "Não definida" && !CATEGORIAS.includes(categoria)) {
    return { erro: "Categoria inválida." };
  }

  const criterios = [body.impacto, body.frequencia, body.usuariosAfetados];
  const enviados = criterios.filter((valor) => valor !== undefined && valor !== null && valor !== "").length;
  if (enviados !== 0 && enviados !== criterios.length) {
    return { erro: "Informe os três critérios de prioridade juntos." };
  }

  let prioridade = normalizarPrioridade(body.prioridade || "Média");
  if (enviados === criterios.length) {
    try {
      prioridade = calcularPrioridade(...criterios);
    } catch (erro) {
      return { erro: erro.message };
    }
  } else if (!PRIORIDADES.includes(prioridade)) {
    return { erro: "Prioridade inválida." };
  }

  return {
    dados: {
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      categoria,
      prioridade,
      impacto: enviados ? Number(body.impacto) : null,
      frequencia: enviados ? Number(body.frequencia) : null,
      usuariosAfetados: enviados ? Number(body.usuariosAfetados) : null,
    },
  };
}

function validarAtualizacaoOcorrencia(body, atual) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { erro: "Envie os dados da ocorrência em formato JSON." };
  }

  const titulo = body.titulo === undefined ? atual.titulo : body.titulo;
  const descricao = body.descricao === undefined ? atual.descricao : body.descricao;
  const categoria = body.categoria === undefined ? (atual.categoria || "Não definida") : (body.categoria || "Não definida");
  if (!textoValido(titulo, 200, true) || !textoValido(descricao, 5000, true)) {
    return { erro: "Título (até 200 caracteres) e descrição (até 5.000) são obrigatórios." };
  }
  if (categoria !== "Não definida" && !CATEGORIAS.includes(categoria)) {
    return { erro: "Categoria inválida." };
  }

  const nomes = ["impacto", "frequencia", "usuariosAfetados"];
  const fornecidos = nomes.filter((nome) => body[nome] !== undefined);
  const atualizarCriterios = fornecidos.length > 0;
  let impacto = atual.impacto;
  let frequencia = atual.frequencia;
  let usuariosAfetados = atual.usuarios_afetados;
  let prioridade = body.prioridade === undefined
    ? normalizarPrioridade(atual.prioridade)
    : normalizarPrioridade(body.prioridade);

  if (atualizarCriterios) {
    if (fornecidos.length !== nomes.length) {
      return { erro: "Informe os três critérios de prioridade juntos." };
    }
    try {
      prioridade = calcularPrioridade(body.impacto, body.frequencia, body.usuariosAfetados);
      impacto = Number(body.impacto);
      frequencia = Number(body.frequencia);
      usuariosAfetados = Number(body.usuariosAfetados);
    } catch (erro) {
      return { erro: erro.message };
    }
  } else if (!PRIORIDADES.includes(prioridade)) {
    return { erro: "Prioridade inválida." };
  }

  return {
    dados: {
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      categoria,
      prioridade,
      impacto,
      frequencia,
      usuariosAfetados,
    },
  };
}

module.exports = {
  CATEGORIAS,
  PRIORIDADES,
  STATUS,
  calcularPrioridade,
  normalizarPrioridade,
  textoValido,
  validarAtualizacaoOcorrencia,
  validarCadastroOcorrencia,
};
