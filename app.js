// ============================================================
// Casa em Ordem — lógica do app (passo 1: login + casa + abas)
// ============================================================

if (SUPABASE_URL.includes("COLE_AQUI") || SUPABASE_KEY.includes("COLE_AQUI")) {
  document.body.innerHTML = "<p style='padding:24px'>Configure o arquivo <b>config.js</b> com a URL e a chave do Supabase.</p>";
  throw new Error("config.js não configurado");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
let modoCadastro = false;
const estado = {
  householdId: null, userId: null,
  categorias: [], itens: [],
  membros: [], tarefas: [], diaSelecionado: new Date().getDay(),
  refeicoes: {}, semanaOffset: 0, diaCardapio: new Date().getDay(), editando: null,
};

// ---------- utilidades ----------
function mostrarMensagem(texto, tipo = "erro") {
  const el = $("msg");
  el.textContent = texto;          // textContent (não innerHTML) evita injeção de HTML
  el.className = "msg " + tipo;
  clearTimeout(mostrarMensagem.timer);
  mostrarMensagem.timer = setTimeout(() => el.classList.add("hidden"), 5000);
}

function traduzirErro(e) {
  const m = (e && e.message) || "";
  if (m.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("Email not confirmed")) return "Confirme seu e-mail antes de entrar (veja a caixa de entrada).";
  if (m.includes("User already registered")) return "Este e-mail já está cadastrado.";
  if (m.includes("Password should be at least")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (m.includes("Código de convite inválido")) return "Código de convite inválido.";
  if (m.includes("limite de 4 membros")) return "Esta casa já atingiu o limite de 4 membros.";
  if (m.includes("duplicate key")) return "Já existe um item com esse nome.";
  return m || "Algo deu errado. Tente de novo.";
}

function mostrarTela(nome) {
  for (const v of ["auth", "house", "app"]) {
    $("view-" + v).classList.toggle("hidden", v !== nome);
  }
}

async function nomeDoUsuario() {
  const { data: { user } } = await db.auth.getUser();
  return (user.user_metadata && user.user_metadata.nome) || user.email.split("@")[0];
}

// ---------- decide qual tela mostrar ----------
async function carregarEstado() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return mostrarTela("auth");

  // O RLS garante que só voltam as casas das quais o usuário é membro
  const { data, error } = await db
    .from("household_members")
    .select("household_id, papel, households(nome, codigo_convite)")
    .eq("user_id", session.user.id)
    .limit(1);

  if (error) { mostrarMensagem(traduzirErro(error)); return mostrarTela("auth"); }
  if (!data || data.length === 0) return mostrarTela("house");

  const casa = data[0].households;
  estado.householdId = data[0].household_id;
  estado.userId = session.user.id;
  $("house-name").textContent = casa.nome;
  $("invite-code").textContent = casa.codigo_convite;
  mostrarTela("app");
  carregarEstoque();
  carregarTarefas();
  carregarCardapio();
}

// ---------- login / cadastro ----------
function alternarModo(cadastro) {
  modoCadastro = cadastro;
  $("auth-titulo").textContent = cadastro ? "Criar conta" : "Entrar";
  $("auth-botao").textContent = cadastro ? "Cadastrar" : "Entrar";
  $("auth-alternar").textContent = cadastro ? "Já tem conta? Entrar" : "Não tem conta? Cadastre-se";
  $("label-nome").classList.toggle("hidden", !cadastro);
  $("nome").required = cadastro;
  $("senha").autocomplete = cadastro ? "new-password" : "current-password";
}

$("auth-alternar").addEventListener("click", () => alternarModo(!modoCadastro));

$("auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("auth-botao");
  botao.disabled = true;
  const email = $("email").value.trim();
  const senha = $("senha").value;

  if (modoCadastro) {
    const { data, error } = await db.auth.signUp({
      email, password: senha, options: { data: { nome: $("nome").value.trim() } },
    });
    botao.disabled = false;
    if (error) return mostrarMensagem(traduzirErro(error));
    if (!data.session) {
      alternarModo(false);
      return mostrarMensagem("Cadastro feito! Confirme seu e-mail e depois entre.", "ok");
    }
  } else {
    const { error } = await db.auth.signInWithPassword({ email, password: senha });
    botao.disabled = false;
    if (error) return mostrarMensagem(traduzirErro(error));
  }
  $("senha").value = "";
  await carregarEstado();
});

// ---------- criar casa / entrar com código ----------
$("form-criar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const { error } = await db.rpc("create_household", {
    p_nome: $("casa-nome").value.trim(),
    p_nome_exibicao: await nomeDoUsuario(),
  });
  if (error) return mostrarMensagem(traduzirErro(error));
  await carregarEstado();
});

$("form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const { error } = await db.rpc("join_household", {
    p_codigo: $("casa-codigo").value.trim(),
    p_nome_exibicao: await nomeDoUsuario(),
  });
  if (error) return mostrarMensagem(traduzirErro(error));
  await carregarEstado();
});

// ---------- sair ----------
async function sair() {
  await db.auth.signOut();
  await carregarEstado();
}
$("sair-1").addEventListener("click", sair);
$("sair-2").addEventListener("click", sair);

// ---------- copiar código de convite ----------
$("copiar-codigo").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("invite-code").textContent);
    mostrarMensagem("Código copiado!", "ok");
  } catch {
    mostrarMensagem("Não consegui copiar. Anote o código manualmente.");
  }
});

// ---------- abas ----------
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("hidden", p.id !== "panel-" + btn.dataset.tab);
    });
  });
});

// ============================================================
// MÓDULO: ESTOQUE
// ============================================================
const CATEGORIAS_PADRAO = ["Limpeza", "Higiene", "Comida", "Outros"];

// Cria elementos HTML de forma segura (textos entram como texto, nunca como HTML)
function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of filhos) e.append(f);
  return e;
}

async function carregarEstoque() {
  const [cat, itens] = await Promise.all([
    db.from("categorias_estoque").select("id, nome").order("nome"),
    db.from("itens_estoque")
      .select("id, categoria_id, nome, quantidade, unidade, quantidade_minima")
      .order("nome"),
  ]);
  if (cat.error || itens.error) return mostrarMensagem(traduzirErro(cat.error || itens.error));

  // Primeira vez: cria as categorias iniciais da casa
  if (cat.data.length === 0) {
    const { error } = await db.from("categorias_estoque").upsert(
      CATEGORIAS_PADRAO.map((nome) => ({ household_id: estado.householdId, nome })),
      { onConflict: "household_id,nome", ignoreDuplicates: true }
    );
    if (error) return mostrarMensagem(traduzirErro(error));
    return carregarEstoque();
  }

  estado.categorias = cat.data;
  estado.itens = itens.data;
  preencherSelectCategorias();
  renderEstoque();
}

function preencherSelectCategorias() {
  const sel = $("item-categoria");
  const atual = sel.value;
  sel.replaceChildren(
    ...estado.categorias.map((c) => el("option", { value: c.id }, c.nome)),
    el("option", { value: "__nova__" }, "➕ Nova categoria…")
  );
  if (estado.categorias.some((c) => c.id === atual)) sel.value = atual;
}

function renderEstoque() {
  const lista = $("estoque-lista");
  const so = $("so-acabando").checked;
  const itens = estado.itens.filter((i) => !so || Number(i.quantidade) <= Number(i.quantidade_minima));
  lista.replaceChildren();

  if (itens.length === 0) {
    lista.append(el("p", { class: "vazio" },
      estado.itens.length === 0
        ? "Nenhum produto ainda. Toque em “+ Produto” para começar."
        : "Nada acabando por aqui. 🎉"));
    return;
  }

  const grupos = [...estado.categorias, { id: null, nome: "Sem categoria" }];
  for (const g of grupos) {
    const doGrupo = itens.filter((i) => i.categoria_id === g.id);
    if (doGrupo.length === 0) continue;
    lista.append(el("h3", { class: "grupo" }, g.nome));
    for (const item of doGrupo) lista.append(cartaoItem(item));
  }
}

function cartaoItem(item) {
  const acabando = Number(item.quantidade) <= Number(item.quantidade_minima);

  const info = el("div", { class: "item-info" },
    el("strong", {}, item.nome),
    el("small", {}, `avisar em ${item.quantidade_minima} ${item.unidade}`));
  if (acabando) info.append(el("span", { class: "badge" }, "Acabando"));

  const controles = el("div", { class: "item-ctrl" },
    el("button", { type: "button", class: "mais-menos", "aria-label": "Diminuir",
      onclick: () => ajustarQuantidade(item.id, -1) }, "−"),
    el("span", { class: "qtd" }, `${item.quantidade} ${item.unidade}`),
    el("button", { type: "button", class: "mais-menos", "aria-label": "Aumentar",
      onclick: () => ajustarQuantidade(item.id, +1) }, "+"),
    el("button", { type: "button", class: "excluir", "aria-label": "Excluir produto",
      onclick: () => excluirItem(item.id) }, "🗑"));

  return el("div", { class: acabando ? "item acabando" : "item" }, info, controles);
}

// Atualiza na tela primeiro (rápido) e salva no banco; se falhar, desfaz.
async function ajustarQuantidade(id, delta) {
  const item = estado.itens.find((i) => i.id === id);
  if (!item) return;
  const anterior = Number(item.quantidade);
  const nova = Math.max(0, Math.round((anterior + delta) * 100) / 100);
  if (nova === anterior) return;

  item.quantidade = nova;
  renderEstoque();

  const { error } = await db.from("itens_estoque")
    .update({ quantidade: nova, atualizado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    item.quantidade = anterior;
    renderEstoque();
    mostrarMensagem(traduzirErro(error));
  }
}

async function excluirItem(id) {
  const item = estado.itens.find((i) => i.id === id);
  if (!item || !confirm(`Excluir "${item.nome}" do estoque?`)) return;
  const { error } = await db.from("itens_estoque").delete().eq("id", id);
  if (error) return mostrarMensagem(traduzirErro(error));
  estado.itens = estado.itens.filter((i) => i.id !== id);
  renderEstoque();
}

function fecharFormItem() {
  $("form-item").reset();
  $("form-item").classList.add("hidden");
  $("label-nova-cat").classList.add("hidden");
}

$("estoque-novo").addEventListener("click", () => {
  const form = $("form-item");
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) $("item-nome").focus();
});
$("item-cancelar").addEventListener("click", fecharFormItem);
$("so-acabando").addEventListener("change", renderEstoque);
$("item-categoria").addEventListener("change", () => {
  $("label-nova-cat").classList.toggle("hidden", $("item-categoria").value !== "__nova__");
});

$("form-item").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("item-salvar");
  botao.disabled = true;

  try {
    let categoriaId = $("item-categoria").value;

    if (categoriaId === "__nova__") {
      const nomeCat = $("item-nova-categoria").value.trim();
      if (!nomeCat) return mostrarMensagem("Digite o nome da nova categoria.");
      const existente = estado.categorias.find((c) => c.nome.toLowerCase() === nomeCat.toLowerCase());
      if (existente) {
        categoriaId = existente.id;
      } else {
        const { data, error } = await db.from("categorias_estoque")
          .insert({ household_id: estado.householdId, nome: nomeCat })
          .select("id, nome").single();
        if (error) return mostrarMensagem(traduzirErro(error));
        categoriaId = data.id;
      }
    }

    const { error } = await db.from("itens_estoque").insert({
      household_id: estado.householdId,
      categoria_id: categoriaId,
      nome: $("item-nome").value.trim(),
      quantidade: Number($("item-qtd").value),
      unidade: $("item-unidade").value,
      quantidade_minima: Number($("item-min").value),
    });
    if (error) return mostrarMensagem(traduzirErro(error));

    fecharFormItem();
    await carregarEstoque();
  } finally {
    botao.disabled = false;
  }
});

// ============================================================
// MÓDULO: TAREFAS DA SEMANA
// ============================================================
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Data local no formato AAAA-MM-DD (é o formato do tipo "date" do banco)
function dataLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function inicioDaSemana() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());   // volta até o domingo
  return dataLocal(d);
}
// "Feita" = concluída em algum dia desta semana. Na semana seguinte volta a pendente.
function tarefaFeita(t) {
  return !!t.concluida_em && t.concluida_em >= inicioDaSemana();
}
function nomeMembro(id) {
  const m = estado.membros.find((x) => x.user_id === id);
  return (m && m.nome_exibicao) || "Membro";
}

async function carregarTarefas() {
  const [mem, tar] = await Promise.all([
    db.from("household_members").select("user_id, nome_exibicao").eq("household_id", estado.householdId),
    db.from("tarefas").select("id, titulo, dia_semana, responsavel_id, concluida_em").order("criada_em"),
  ]);
  if (mem.error || tar.error) return mostrarMensagem(traduzirErro(mem.error || tar.error));
  estado.membros = mem.data;
  estado.tarefas = tar.data;
  preencherResponsaveis();
  renderDias();
  renderTarefas();
}

function preencherResponsaveis() {
  $("tarefa-responsavel").replaceChildren(
    el("option", { value: "" }, "Qualquer um"),
    ...estado.membros.map((m) => el("option", { value: m.user_id }, m.nome_exibicao || "Membro"))
  );
}

function renderDias() {
  const hoje = new Date().getDay();
  $("dias-semana").replaceChildren(
    ...DIAS.map((nome, i) => {
      const pendentes = estado.tarefas.filter((t) => t.dia_semana === i && !tarefaFeita(t)).length;
      const classes = ["dia", i === estado.diaSelecionado ? "ativo" : "", i === hoje ? "hoje" : ""].join(" ").trim();
      const botao = el("button", { type: "button", class: classes,
        onclick: () => { estado.diaSelecionado = i; renderDias(); renderTarefas(); } }, nome);
      if (pendentes > 0) botao.append(el("span", { class: "pend" }, String(pendentes)));
      return botao;
    })
  );
}

function renderTarefas() {
  const lista = $("tarefas-lista");
  const doDia = estado.tarefas.filter((t) => t.dia_semana === estado.diaSelecionado);
  const feitas = doDia.filter(tarefaFeita).length;
  lista.replaceChildren();

  if (doDia.length === 0) {
    $("tarefas-resumo").textContent = DIAS_LONGO[estado.diaSelecionado];
    lista.append(el("p", { class: "vazio" }, "Nenhuma tarefa neste dia. Toque em “+ Tarefa” para criar."));
    return;
  }
  $("tarefas-resumo").textContent = `${DIAS_LONGO[estado.diaSelecionado]} — ${feitas} de ${doDia.length} feitas`;
  // pendentes primeiro, feitas no fim
  const ordenadas = [...doDia].sort((a, b) => Number(tarefaFeita(a)) - Number(tarefaFeita(b)));
  for (const t of ordenadas) lista.append(cartaoTarefa(t));
}

function cartaoTarefa(t) {
  const feita = tarefaFeita(t);
  return el("div", { class: feita ? "tarefa feita" : "tarefa" },
    el("button", { type: "button", class: "check-redondo",
      "aria-label": feita ? "Marcar como pendente" : "Marcar como feita",
      onclick: () => alternarTarefa(t.id) }, feita ? "✓" : ""),
    el("div", { class: "tarefa-info" },
      el("span", { class: "tarefa-titulo" }, t.titulo),
      el("small", {}, t.responsavel_id ? "👤 " + nomeMembro(t.responsavel_id) : "👥 Qualquer um")),
    el("button", { type: "button", class: "excluir", "aria-label": "Excluir tarefa",
      onclick: () => excluirTarefa(t.id) }, "🗑"));
}

async function alternarTarefa(id) {
  const t = estado.tarefas.find((x) => x.id === id);
  if (!t) return;
  const anterior = t.concluida_em;
  t.concluida_em = tarefaFeita(t) ? null : dataLocal();
  renderDias();
  renderTarefas();

  const { error } = await db.from("tarefas")
    .update({ concluida_em: t.concluida_em, concluida: !!t.concluida_em })
    .eq("id", id);
  if (error) {
    t.concluida_em = anterior;
    renderDias();
    renderTarefas();
    mostrarMensagem(traduzirErro(error));
  }
}

async function excluirTarefa(id) {
  const t = estado.tarefas.find((x) => x.id === id);
  if (!t || !confirm(`Excluir "${t.titulo}" de ${DIAS_LONGO[t.dia_semana]}?`)) return;
  const { error } = await db.from("tarefas").delete().eq("id", id);
  if (error) return mostrarMensagem(traduzirErro(error));
  estado.tarefas = estado.tarefas.filter((x) => x.id !== id);
  renderDias();
  renderTarefas();
}

// ----- formulário -----
function montarDiasDoForm() {
  $("tarefa-dias").replaceChildren(
    ...DIAS.map((nome, i) =>
      el("label", { class: "dia-check" }, el("input", { type: "checkbox", value: String(i) }), el("span", {}, nome)))
  );
}
function fecharFormTarefa() {
  $("form-tarefa").reset();
  $("form-tarefa").classList.add("hidden");
}

$("tarefa-nova").addEventListener("click", () => {
  const form = $("form-tarefa");
  form.classList.toggle("hidden");
  if (form.classList.contains("hidden")) return;
  // já marca o dia que está selecionado na tela
  document.querySelectorAll("#tarefa-dias input").forEach((c) => {
    c.checked = Number(c.value) === estado.diaSelecionado;
  });
  $("tarefa-titulo").focus();
});
$("tarefa-cancelar").addEventListener("click", fecharFormTarefa);

$("form-tarefa").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const dias = [...document.querySelectorAll("#tarefa-dias input:checked")].map((c) => Number(c.value));
  if (dias.length === 0) return mostrarMensagem("Escolha pelo menos um dia.");

  const botao = $("tarefa-salvar");
  botao.disabled = true;
  try {
    const titulo = $("tarefa-titulo").value.trim();
    const responsavel = $("tarefa-responsavel").value || null;
    // uma linha por dia escolhido (ex.: "Lavar louça" de segunda a sexta = 5 linhas)
    const linhas = dias.map((d) => ({
      household_id: estado.householdId, titulo, dia_semana: d, responsavel_id: responsavel,
    }));
    const { error } = await db.from("tarefas").insert(linhas);
    if (error) return mostrarMensagem(traduzirErro(error));
    fecharFormTarefa();
    await carregarTarefas();
  } finally {
    botao.disabled = false;
  }
});

montarDiasDoForm();

// ============================================================
// MÓDULO: CARDÁPIO DA SEMANA
// ============================================================
const REFEICOES = [
  { tipo: "cafe",   nome: "Café da manhã", emoji: "☕" },
  { tipo: "almoco", nome: "Almoço",        emoji: "🍛" },
  { tipo: "lanche", nome: "Lanche",        emoji: "🥪" },
  { tipo: "jantar", nome: "Jantar",        emoji: "🍝" },
];

const chaveRef = (data, tipo) => `${data}|${tipo}`;

// As 7 datas (domingo a sábado) da semana mostrada; semanaOffset 0 = esta semana
function datasDaSemana() {
  const base = new Date();
  base.setHours(12, 0, 0, 0);   // meio-dia evita problemas de virada de horário
  base.setDate(base.getDate() - base.getDay() + estado.semanaOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d;
  });
}
const ddmm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

async function carregarCardapio() {
  const dias = datasDaSemana();
  const { data, error } = await db.from("refeicoes")
    .select("id, data, tipo, descricao")
    .gte("data", dataLocal(dias[0]))
    .lte("data", dataLocal(dias[6]));
  if (error) return mostrarMensagem(traduzirErro(error));

  estado.refeicoes = {};
  for (const r of data) estado.refeicoes[chaveRef(r.data, r.tipo)] = r;
  estado.editando = null;
  renderCardapio();
}

function renderCardapio() {
  const dias = datasDaSemana();
  const hoje = dataLocal();

  $("cardapio-hoje").textContent =
    (estado.semanaOffset === 0 ? "Esta semana · " : "") + `${ddmm(dias[0])} a ${ddmm(dias[6])}`;

  $("cardapio-dias").replaceChildren(
    ...dias.map((d, i) => {
      const ds = dataLocal(d);
      const planejadas = REFEICOES.filter((r) => estado.refeicoes[chaveRef(ds, r.tipo)]).length;
      const classes = ["dia", i === estado.diaCardapio ? "ativo" : "", ds === hoje ? "hoje" : ""].join(" ").trim();
      const botao = el("button", { type: "button", class: classes,
        onclick: () => { estado.diaCardapio = i; estado.editando = null; renderCardapio(); } },
        DIAS[i], el("span", { class: "dia-num" }, String(d.getDate())));
      if (planejadas > 0) botao.append(el("span", { class: "plan" }, String(planejadas)));
      return botao;
    })
  );

  const dataStr = dataLocal(dias[estado.diaCardapio]);
  $("cardapio-lista").replaceChildren(
    ...REFEICOES.map((ref) => cartaoRefeicao(ref, dataStr))
  );
}

function cartaoRefeicao(ref, dataStr) {
  const r = estado.refeicoes[chaveRef(dataStr, ref.tipo)];
  if (estado.editando === ref.tipo) return formRefeicao(ref, dataStr, r);

  return el("button", { type: "button", class: r ? "refeicao" : "refeicao vazia",
    onclick: () => { estado.editando = ref.tipo; renderCardapio(); } },
    el("span", { class: "ref-emoji" }, ref.emoji),
    el("span", { class: "ref-texto" },
      el("small", {}, ref.nome),
      el("strong", {}, r ? r.descricao : "Toque para adicionar")));
}

function formRefeicao(ref, dataStr, r) {
  const input = el("input", { type: "text", maxlength: "200",
    placeholder: "Ex.: Arroz, feijão e frango", value: r ? r.descricao : "" });
  const form = el("form", { class: "card refeicao-form",
    onsubmit: (ev) => { ev.preventDefault(); salvarRefeicao(dataStr, ref.tipo, input.value); } },
    el("label", {}, `${ref.emoji} ${ref.nome}`, input),
    el("button", { type: "submit", class: "primary" }, "Salvar"),
    r ? el("button", { type: "button", class: "link", onclick: () => removerRefeicao(r) }, "Remover refeição") : "",
    el("button", { type: "button", class: "link",
      onclick: () => { estado.editando = null; renderCardapio(); } }, "Cancelar"));
  setTimeout(() => input.focus(), 0);
  return form;
}

async function salvarRefeicao(dataStr, tipo, texto) {
  const descricao = texto.trim();
  const atual = estado.refeicoes[chaveRef(dataStr, tipo)];

  if (!descricao) {                       // campo vazio = limpar a refeição
    if (atual) return removerRefeicao(atual);
    estado.editando = null;
    return renderCardapio();
  }

  // upsert = "insere, ou atualiza se já existir" (a chave única é casa + data + tipo)
  const { data, error } = await db.from("refeicoes")
    .upsert({ household_id: estado.householdId, data: dataStr, tipo, descricao },
            { onConflict: "household_id,data,tipo" })
    .select("id, data, tipo, descricao").single();
  if (error) return mostrarMensagem(traduzirErro(error));

  estado.refeicoes[chaveRef(dataStr, tipo)] = data;
  estado.editando = null;
  renderCardapio();
}

async function removerRefeicao(r) {
  const { error } = await db.from("refeicoes").delete().eq("id", r.id);
  if (error) return mostrarMensagem(traduzirErro(error));
  delete estado.refeicoes[chaveRef(r.data, r.tipo)];
  estado.editando = null;
  renderCardapio();
}

// Copia a semana anterior só para os espaços que estão vazios nesta semana
async function copiarSemanaAnterior() {
  if (!confirm("Copiar o cardápio da semana anterior para os espaços vazios desta semana?")) return;
  const dias = datasDaSemana();
  const anteriores = dias.map((d) => { const x = new Date(d); x.setDate(x.getDate() - 7); return dataLocal(x); });

  const { data, error } = await db.from("refeicoes")
    .select("data, tipo, descricao")
    .gte("data", anteriores[0]).lte("data", anteriores[6]);
  if (error) return mostrarMensagem(traduzirErro(error));

  const linhas = data
    .map((r) => ({ i: anteriores.indexOf(r.data), r }))
    .filter(({ i }) => i >= 0)
    .map(({ i, r }) => ({ household_id: estado.householdId, data: dataLocal(dias[i]), tipo: r.tipo, descricao: r.descricao }))
    .filter((l) => !estado.refeicoes[chaveRef(l.data, l.tipo)]);

  if (linhas.length === 0) {
    return mostrarMensagem("Nada para copiar: a semana anterior está vazia ou esta já está preenchida.", "ok");
  }
  const { error: erro2 } = await db.from("refeicoes")
    .upsert(linhas, { onConflict: "household_id,data,tipo", ignoreDuplicates: true });
  if (erro2) return mostrarMensagem(traduzirErro(erro2));

  await carregarCardapio();
  mostrarMensagem(`${linhas.length} refeição(ões) copiada(s).`, "ok");
}

function mudarSemana(delta) {
  estado.semanaOffset = delta === 0 ? 0 : estado.semanaOffset + delta;
  if (delta === 0) estado.diaCardapio = new Date().getDay();
  carregarCardapio();
}
$("cardapio-ant").addEventListener("click", () => mudarSemana(-1));
$("cardapio-prox").addEventListener("click", () => mudarSemana(+1));
$("cardapio-hoje").addEventListener("click", () => mudarSemana(0));
$("cardapio-copiar").addEventListener("click", copiarSemanaAnterior);

// ---------- início ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
carregarEstado();
