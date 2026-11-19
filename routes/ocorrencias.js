const express = require("express");
const router = express.Router();
const db = require("../database/connection");

const { compararOcorrencias } = require("../services/compararOcorrencias");
const {
  STATUS,
  validarAtualizacaoOcorrencia,
  validarCadastroOcorrencia,
} = require("../services/regrasOcorrencias");

// Cadastrar ocorrência
router.post("/", async (req, res) => {
  const validacao = validarCadastroOcorrencia(req.body);
  if (validacao.erro) return res.status(400).json({ erro: validacao.erro });

  const { titulo, descricao, categoria, prioridade, impacto, frequencia, usuariosAfetados } = validacao.dados;

  const resultado = await db
    .prepare(
      `
    INSERT INTO ocorrencias
    (titulo, descricao, categoria, prioridade, impacto, frequencia, usuarios_afetados)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(titulo, descricao, categoria, prioridade, impacto, frequencia, usuariosAfetados);

  res.status(201).json({
    mensagem: "Ocorrência cadastrada com sucesso!",
    id: resultado.lastInsertRowid,
    prioridade,
  });
});

// Listar ocorrências
router.get("/", async (req, res) => {
  const ocorrencias = await db
    .prepare(
      `
          SELECT * FROM ocorrencias
          ORDER BY id DESC
      `,
    )
    .all();

  res.json(ocorrencias);
});

// Buscar ocorrência por ID
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erro: "ID inválido." });
  }

  const atual = await db.prepare("SELECT * FROM ocorrencias WHERE id = ?").get(id);
  if (!atual) return res.status(404).json({ erro: "Ocorrência não encontrada." });

  const validacao = validarAtualizacaoOcorrencia(req.body, atual);
  if (validacao.erro) return res.status(400).json({ erro: validacao.erro });
  const dados = validacao.dados;
  await db.prepare(`
    UPDATE ocorrencias
    SET titulo = ?, descricao = ?, categoria = ?, prioridade = ?,
        impacto = ?, frequencia = ?, usuarios_afetados = ?
    WHERE id = ?
  `).run(
    dados.titulo,
    dados.descricao,
    dados.categoria,
    dados.prioridade,
    dados.impacto,
    dados.frequencia,
    dados.usuariosAfetados,
    id,
  );

  res.json({ mensagem: "Ocorrência atualizada com sucesso!", ocorrencia: { id, ...dados } });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erro: "ID inválido." });
  }

  const ocorrencia = await db
    .prepare(
      `
          SELECT * FROM ocorrencias
          WHERE id = ?
      `,
    )
    .get(id);

  if (!ocorrencia) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  res.json(ocorrencia);
});

// Buscar ocorrências semelhantes
router.get("/:id/similares", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID inválido.",
    });
  }

  const atual = await db
    .prepare(
      `
          SELECT * FROM ocorrencias
          WHERE id = ?
      `,
    )
    .get(id);

  if (!atual) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  const anteriores = await db
    .prepare(
      `
          SELECT id, titulo, descricao, categoria, prioridade, status
          FROM ocorrencias
          WHERE id != ?
          ORDER BY id DESC
      `,
    )
    .all(id);

  const similares = compararOcorrencias(atual, anteriores);

  res.json({
    total: similares.length,
    ocorrencias: similares,
  });
});

// Atualizar status da ocorrência
router.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      erro: "ID inválido.",
    });
  }

  if (!STATUS.includes(status)) {
    return res.status(400).json({
      erro: "Status inválido.",
    });
  }

  const ocorrencia = await db
    .prepare(
      `
          SELECT id FROM ocorrencias WHERE id = ?
      `,
    )
    .get(id);

  if (!ocorrencia) {
    return res.status(404).json({
      erro: "Ocorrência não encontrada.",
    });
  }

  await db.prepare(
    `
          UPDATE ocorrencias
          SET status = ?
          WHERE id = ?
      `,
  ).run(status, id);

  res.json({
    mensagem: "Status atualizado com sucesso!",
    status,
  });
});

module.exports = router;
