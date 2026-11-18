const palavrasIgnoradas = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "e",
  "ou",
  "que",
  "para",
  "por",
  "com",
  "ao",
  "aos",
  "se",
  "não",
  "uma",
  "foi",
  "ser",
  "está",
  "estao",
  "quando",
  "como",
  "meu",
  "minha",
]);

function extrairPalavras(texto) {
  return new Set(
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(
        (palavra) => palavra.length > 2 && !palavrasIgnoradas.has(palavra),
      ),
  );
}

function calcularSimilaridade(textoA, textoB) {
  const palavrasA = extrairPalavras(textoA);
  const palavrasB = extrairPalavras(textoB);

  const intersecao = [...palavrasA].filter((palavra) => palavrasB.has(palavra));

  const uniao = new Set([...palavrasA, ...palavrasB]);

  if (uniao.size === 0) {
    return 0;
  }

  return intersecao.length / uniao.size;
}

function compararOcorrencias(atual, anteriores) {
  const textoAtual = `${atual.titulo} ${atual.descricao}`;

  return anteriores
    .map((ocorrencia) => {
      const textoAnterior = `${ocorrencia.titulo} ${ocorrencia.descricao}`;

      const pontuacao = calcularSimilaridade(textoAtual, textoAnterior);

      return {
        ...ocorrencia,
        similaridade: Math.round(pontuacao * 100),
      };
    })
    .filter((item) => item.similaridade >= 15)
    .sort((a, b) => b.similaridade - a.similaridade)
    .slice(0, 5);
}

module.exports = {
  compararOcorrencias,
};
