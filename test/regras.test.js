const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calcularPrioridade,
  normalizarPrioridade,
  validarAtualizacaoOcorrencia,
  validarCadastroOcorrencia,
} = require("../services/regrasOcorrencias");
const { ehArray, ehObjeto, lerJson } = require("../services/jsonSeguro");
const {
  deveUsarModoSimulado,
  normalizarRelatorioIA,
  priorizarTestes,
} = require("../services/inteligenciaArtificial");

test("calcula prioridade conforme as faixas do produto", () => {
  assert.equal(calcularPrioridade(1, 1, 1), "Baixa");
  assert.equal(calcularPrioridade(2, 2, 1), "Média");
  assert.equal(calcularPrioridade(3, 2, 2), "Alta");
  assert.equal(calcularPrioridade(5, 3, 3), "Crítica");
});

test("rejeita critérios de prioridade fora da faixa", () => {
  assert.throws(() => calcularPrioridade(0, 2, 1), TypeError);
  assert.throws(() => calcularPrioridade(2, 4, 1), TypeError);
  assert.throws(() => calcularPrioridade("x", 1, 1), TypeError);
});

test("valida cadastro, normaliza prioridade antiga e rejeita critérios parciais", () => {
  const cadastro = validarCadastroOcorrencia({
    titulo: " Falha ",
    descricao: " Detalhes ",
    prioridade: "Media",
  });
  assert.equal(cadastro.dados.titulo, "Falha");
  assert.equal(cadastro.dados.prioridade, "Média");
  assert.match(validarCadastroOcorrencia({ titulo: "x", descricao: "y", impacto: 3 }).erro, /três critérios/);
  assert.match(validarCadastroOcorrencia({ titulo: " ", descricao: "y" }).erro, /obrigatórios/);
});

test("valida edição parcial mantendo campos não enviados", () => {
  const atual = {
    titulo: "Antigo",
    descricao: "Descrição",
    categoria: null,
    prioridade: "Media",
    impacto: 2,
    frequencia: 2,
    usuarios_afetados: 1,
  };
  const atualizacao = validarAtualizacaoOcorrencia({ titulo: "Novo" }, atual);
  assert.equal(atualizacao.dados.titulo, "Novo");
  assert.equal(atualizacao.dados.categoria, "Não definida");
  assert.equal(atualizacao.dados.prioridade, "Média");
  assert.equal(atualizacao.dados.impacto, 2);
  assert.match(validarAtualizacaoOcorrencia({ impacto: 3 }, atual).erro, /três critérios/);
});

test("leitura JSON inválido ou de tipo errado usa fallback seguro", () => {
  assert.deepEqual(lerJson("{", [], ehArray), []);
  assert.deepEqual(lerJson("{}", [], ehArray), []);
  assert.deepEqual(lerJson('{"a":1}', {}, ehObjeto), { a: 1 });
});

test("normaliza o conteúdo produzido pela IA e prioriza testes", () => {
  const relatorio = normalizarRelatorioIA({
    resumo: " Resumo ",
    informacoes: [],
    hipoteses: ["H1", 3],
    evidencias: null,
    testes: ["Reproduzir a falha", null],
    confianca: "incerta",
  }, "Crítica");

  assert.equal(relatorio.resumo, "Resumo");
  assert.deepEqual(relatorio.informacoes, {});
  assert.deepEqual(relatorio.hipoteses, ["H1"]);
  assert.deepEqual(relatorio.evidencias, []);
  assert.equal(relatorio.confianca, "Não definida");
  assert.equal(relatorio.testes_priorizados[0].prioridade, "Alta");
  assert.equal(normalizarPrioridade("Media"), "Média");
  assert.deepEqual(priorizarTestes(null, "Alta"), []);
});

test("fallback simulado cobre falhas temporárias e não oculta erros de configuração", () => {
  assert.equal(deveUsarModoSimulado({ status: 503 }), true);
  assert.equal(deveUsarModoSimulado({ name: "APIConnectionError" }), true);
  assert.equal(deveUsarModoSimulado({ code: "invalid_api_key", status: 401 }), false);
  assert.equal(deveUsarModoSimulado(new TypeError("bug local")), false);
});
