function lerJson(valor, fallback, validar = () => true) {
  if (typeof valor !== "string" || valor.length === 0) return fallback;
  try {
    const resultado = JSON.parse(valor);
    return validar(resultado) ? resultado : fallback;
  } catch {
    return fallback;
  }
}

const ehArray = (valor) => Array.isArray(valor);
const ehObjeto = (valor) => valor !== null && typeof valor === "object" && !Array.isArray(valor);

module.exports = { ehArray, ehObjeto, lerJson };
