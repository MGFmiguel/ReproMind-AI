const navLateral = document.querySelector("[data-sidebar]");

if (navLateral) {
  window.reproAuthReady.then((usuario) => {
    if (!usuario) return;

    const caminho = window.location.pathname;
    const hash = window.location.hash;
    const parametros = new URLSearchParams(window.location.search);
    const ocorrenciaId = parametros.get("id");
    const paginaDashboard = caminho === "/" || caminho === "/index.html";
    const itens = [
      { href: "/", texto: "Dashboard", ativo: paginaDashboard && !hash },
      { href: "/#nova-ocorrencia", texto: "Nova ocorrência", ativo: hash === "#nova-ocorrencia" },
      { href: "/historico.html", texto: "Histórico de ocorrências", ativo: caminho === "/historico.html" },
    ];

    if (ocorrenciaId && caminho === "/investigacao.html") {
      itens.push({
        href: `/investigacao.html?id=${encodeURIComponent(ocorrenciaId)}`,
        texto: "Investigação atual",
        ativo: true,
      });
      itens.push({
        href: `/relatorio.html?id=${encodeURIComponent(ocorrenciaId)}`,
        texto: "Relatório da ocorrência",
        ativo: false,
      });
    } else if (ocorrenciaId && caminho === "/relatorio.html") {
      itens.push({
        href: `/investigacao.html?id=${encodeURIComponent(ocorrenciaId)}`,
        texto: "Investigação da ocorrência",
        ativo: false,
      });
      itens.push({
        href: `/relatorio.html?id=${encodeURIComponent(ocorrenciaId)}`,
        texto: "Relatório atual",
        ativo: true,
      });
    }

    if (usuario.papel === "admin") {
      itens.push({
        href: "/usuarios.html",
        texto: "Usuários autorizados",
        ativo: caminho === "/usuarios.html",
      });
    }

    navLateral.replaceChildren();
    itens.forEach((item) => {
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.texto;
      if (item.ativo) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      }
      navLateral.appendChild(link);
    });
  });
}
