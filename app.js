// ============================================================
// Casa em Ordem — v2.0.0
// ============================================================
const APP_VERSION = "2.0.0";
const HASH_INICIAL = location.hash;   // guardado antes de o Supabase limpar a URL

if (SUPABASE_URL.includes("COLE_AQUI") || SUPABASE_KEY.includes("COLE_AQUI")) {
  document.body.innerHTML = "<p style='padding:24px'>Configure o arquivo <b>config.js</b> com a URL e a chave do Supabase.</p>";
  throw new Error("config.js não configurado");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
let modoCadastro = false;

// Tudo o que o app guarda na memória enquanto está aberto
const estado = {
  householdId: null, userId: null, casa: null, meuPapel: null,
  recuperando: HASH_INICIAL.includes("type=recovery"),
  carregado: {},
  categorias: [], itens: [], itemEditando: null, catEditando: null,
  membros: [], tarefas: [], diaSelecionado: new Date().getDay(), tarefaEditando: null,
  refeicoes: {}, semanaOffset: 0, diaCardapio: new Date().getDay(), editando: null,
  convidados: [], convidadoEditando: null,
};

// ============================================================
// UTILIDADES
// ============================================================
function mostrarMensagem(texto, tipo = "erro") {
  const el = $("msg");
  el.textContent = texto;          // textContent (não innerHTML) evita injeção de HTML
  el.className = "msg " + tipo;
  clearTimeout(mostrarMensagem.timer);
  mostrarMensagem.timer = setTimeout(() => el.classList.add("hidden"), tipo === "erro" ? 6000 : 4000);
}

const REGRAS_ERRO = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar (veja a caixa de entrada)."],
  [/user already registered/i, "Este e-mail já está cadastrado."],
  [/signups? not allowed/i, "Os cadastros novos estão fechados. Peça para abrirem temporariamente."],
  [/password should be at least|password.*characters/i, "A senha é curta demais. Use pelo menos 8 caracteres."],
  [/weak.password|password is known to be weak/i, "Senha fraca. Misture letras, números e símbolos."],
  [/different from the old password/i, "A nova senha precisa ser diferente da atual."],
  [/rate limit|only request this after|too many/i, "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."],
  [/jwt expired|auth session missing|invalid jwt/i, "Sua sessão expirou. Entre novamente."],
  [/row-level security|permission denied/i, "Você não tem permissão para fazer isso."],
  [/duplicate key/i, "Já existe um registro com esse nome."],
];

function traduzirErro(e) {
  const m = ((e && (e.message || e.error_description)) || String(e || "")).trim();
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
    return "Sem conexão com a internet. Verifique o sinal e tente de novo.";
  }
  for (const [regra, texto] of REGRAS_ERRO) if (regra.test(m)) return texto;
  return m || "Algo deu errado. Tente de novo.";
}

function mostrarTela(nome) {
  for (const v of ["auth", "esqueci", "reset", "erro", "house", "app"]) {
    $("view-" + v).classList.toggle("hidden", v !== nome);
  }
  window.scrollTo(0, 0);
}

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

// Blocos cinzas pulsando enquanto os dados chegam
function esqueleto(container, n = 3) {
  container.replaceChildren(...Array.from({ length: n }, () => el("div", { class: "esqueleto" })));
}

async function nomeDoUsuario() {
  const { data: { user } } = await db.auth.getUser();
  return (user.user_metadata && user.user_metadata.nome) || user.email.split("@")[0];
}

// Datas locais (AAAA-MM-DD é o formato do tipo "date" do banco)
function dataLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ddmm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

// ============================================================
// QUAL TELA MOSTRAR
// ============================================================
async function carregarEstado() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return mostrarTela("auth");
  if (estado.recuperando) return mostrarTela("reset");

  // O RLS garante que só voltam as casas das quais o usuário é membro
  const { data, error } = await db
    .from("household_members")
    .select("household_id, papel, households(id, nome, codigo_convite)")
    .eq("user_id", session.user.id)
    .limit(1);

  if (error) {
    $("erro-texto").textContent = traduzirErro(error);
    return mostrarTela("erro");
  }
  if (!data || data.length === 0) return mostrarTela("house");

  estado.householdId = data[0].household_id;
  estado.userId = session.user.id;
  estado.meuPapel = data[0].papel;
  estado.casa = { nome: data[0].households.nome, codigo: data[0].households.codigo_convite };
  renderCasa();
  mostrarTela("app");
  recarregarTudo();
}

function recarregarTudo() {
  carregarEstoque();
  carregarTarefas();
  carregarCardapio();
  carregarConvidados();
}

function limparEstadoDados() {
  Object.assign(estado, {
    householdId: null, userId: null, casa: null, meuPapel: null, carregado: {},
    categorias: [], itens: [], itemEditando: null, catEditando: null,
    membros: [], tarefas: [], tarefaEditando: null,
    refeicoes: {}, editando: null, semanaOffset: 0,
    convidados: [], convidadoEditando: null,
  });
  fecharFormItem(); fecharFormTarefa(); fecharFormConvidado();
}

$("erro-tentar").addEventListener("click", carregarEstado);
$("erro-sair").addEventListener("click", () => sair());

// ============================================================
// LOGIN / CADASTRO / RECUPERAR SENHA
// ============================================================
function alternarModo(cadastro) {
  modoCadastro = cadastro;
  $("auth-titulo").textContent = cadastro ? "Criar conta" : "Entrar";
  $("auth-botao").textContent = cadastro ? "Cadastrar" : "Entrar";
  $("auth-alternar").textContent = cadastro ? "Já tem conta? Entrar" : "Não tem conta? Cadastre-se";
  $("label-nome").classList.toggle("hidden", !cadastro);
  $("dica-senha").classList.toggle("hidden", !cadastro);
  $("auth-esqueci").classList.toggle("hidden", cadastro);
  $("nome").required = cadastro;
  // senha mínima só vale para contas novas (contas antigas podem ter menos)
  if (cadastro) $("senha").setAttribute("minlength", "8"); else $("senha").removeAttribute("minlength");
  $("senha").autocomplete = cadastro ? "new-password" : "current-password";
}

$("auth-alternar").addEventListener("click", () => alternarModo(!modoCadastro));

$("auth-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("auth-botao");
  botao.disabled = true;
  try {
    const email = $("email").value.trim();
    const senha = $("senha").value;

    if (modoCadastro) {
      const { data, error } = await db.auth.signUp({
        email, password: senha, options: { data: { nome: $("nome").value.trim() } },
      });
      if (error) return mostrarMensagem(traduzirErro(error));
      if (!data.session) {
        alternarModo(false);
        return mostrarMensagem("Cadastro feito! Confirme seu e-mail e depois entre.", "ok");
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password: senha });
      if (error) return mostrarMensagem(traduzirErro(error));
    }
    $("senha").value = "";
    await carregarEstado();
  } finally {
    botao.disabled = false;
  }
});

$("auth-esqueci").addEventListener("click", () => {
  $("esqueci-email").value = $("email").value;
  mostrarTela("esqueci");
});
$("esqueci-voltar").addEventListener("click", () => mostrarTela("auth"));

$("form-esqueci").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("esqueci-botao");
  botao.disabled = true;
  try {
    // redirectTo precisa estar na lista de "Redirect URLs" do Supabase
    const { error } = await db.auth.resetPasswordForEmail($("esqueci-email").value.trim(), {
      redirectTo: location.origin + location.pathname,
    });
    if (error) return mostrarMensagem(traduzirErro(error));
    mostrarMensagem("Se esse e-mail estiver cadastrado, o link chega em instantes. Confira também o spam.", "ok");
    mostrarTela("auth");
  } finally {
    botao.disabled = false;
  }
});

// O link do e-mail traz o usuário de volta ao app já com uma sessão de recuperação
db.auth.onAuthStateChange((evento) => {
  if (evento === "PASSWORD_RECOVERY") { estado.recuperando = true; mostrarTela("reset"); }
});

function limparHash() { history.replaceState(null, "", location.pathname + location.search); }

$("form-reset").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nova = $("reset-senha").value;
  if (nova !== $("reset-senha2").value) return mostrarMensagem("As duas senhas não são iguais.");
  const botao = $("reset-botao");
  botao.disabled = true;
  try {
    const { error } = await db.auth.updateUser({ password: nova });
    if (error) return mostrarMensagem(traduzirErro(error));
    estado.recuperando = false;
    limparHash();
    $("form-reset").reset();
    mostrarMensagem("Senha alterada com sucesso!", "ok");
    await carregarEstado();
  } finally {
    botao.disabled = false;
  }
});
$("reset-cancelar").addEventListener("click", async () => {
  estado.recuperando = false;
  limparHash();
  $("form-reset").reset();
  await carregarEstado();
});

// ============================================================
// CRIAR CASA / ENTRAR COM CÓDIGO
// ============================================================
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

// ============================================================
// SAIR / ABAS / CÓDIGO
// ============================================================
async function sair() {
  await db.auth.signOut();
  limparEstadoDados();
  await carregarEstado();
}
$("sair-1").addEventListener("click", sair);
$("sair-2").addEventListener("click", sair);

async function copiarCodigo() {
  if (!estado.casa) return;
  try {
    await navigator.clipboard.writeText(estado.casa.codigo);
    mostrarMensagem("Código copiado!", "ok");
  } catch {
    mostrarMensagem("Não consegui copiar. Anote o código: " + estado.casa.codigo);
  }
}
$("copiar-codigo").addEventListener("click", copiarCodigo);
$("casa-copiar").addEventListener("click", copiarCodigo);

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("hidden", p.id !== "panel-" + btn.dataset.tab);
    });
    if (btn.dataset.tab === "casa") renderCasa();
    window.scrollTo(0, 0);
  });
});

// ============================================================
// MÓDULO: ESTOQUE
// ============================================================
const CATEGORIAS_PADRAO = ["Limpeza", "Higiene", "Comida", "Outros"];

async function carregarEstoque() {
  if (!estado.carregado.estoque) esqueleto($("estoque-lista"));
  const [cat, itens] = await Promise.all([
    db.from("categorias_estoque").select("id, nome").order("nome"),
    db.from("itens_estoque")
      .select("id, categoria_id, nome, quantidade, unidade, quantidade_minima")
      .order("nome"),
  ]);
  if (cat.error || itens.error) {
    $("estoque-lista").replaceChildren(el("p", { class: "vazio" }, "Não foi possível carregar o estoque."));
    return mostrarMensagem(traduzirErro(cat.error || itens.error));
  }

  // Primeira vez numa casa vazia: cria as categorias iniciais
  if (cat.data.length === 0 && itens.data.length === 0) {
    const { error } = await db.from("categorias_estoque").upsert(
      CATEGORIAS_PADRAO.map((nome) => ({ household_id: estado.householdId, nome })),
      { onConflict: "household_id,nome", ignoreDuplicates: true }
    );
    if (error) return mostrarMensagem(traduzirErro(error));
    const novo = await db.from("categorias_estoque").select("id, nome").order("nome");
    if (!novo.error) cat.data = novo.data;
  }

  estado.categorias = cat.data;
  estado.itens = itens.data;
  estado.carregado.estoque = true;
  preencherSelectCategorias();
  renderEstoque();
  renderCategorias();
}

function preencherSelectCategorias() {
  const sel = $("item-categoria");
  const atual = sel.value;
  sel.replaceChildren(
    ...estado.categorias.map((c) => el("option", { value: c.id }, c.nome)),
    el("option", { value: "" }, "Sem categoria"),
    el("option", { value: "__nova__" }, "➕ Nova categoria…")
  );
  if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
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

  const info = el("div", { class: "item-info clicavel", onclick: () => abrirFormItem(item) },
    el("strong", {}, item.nome),
    el("small", {}, `mín. ${item.quantidade_minima} ${item.unidade}`, el("span", { class: "dica" }, " · editar")));
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
  renderCategorias();
}

// Um só formulário para criar e para editar
function abrirFormItem(item = null) {
  estado.itemEditando = item ? item.id : null;
  $("item-form-titulo").textContent = item ? "Editar produto" : "Novo produto";
  $("item-salvar").textContent = item ? "Salvar alterações" : "Salvar produto";
  preencherSelectCategorias();
  $("item-nome").value = item ? item.nome : "";
  const sel = $("item-categoria");
  sel.value = item ? (item.categoria_id || "") : (estado.categorias[0] ? estado.categorias[0].id : "");
  $("label-nova-cat").classList.add("hidden");
  $("item-nova-categoria").value = "";
  $("item-qtd").value = item ? item.quantidade : 1;
  $("item-unidade").value = item ? item.unidade : "un";
  $("item-min").value = item ? item.quantidade_minima : 1;
  $("form-item").classList.remove("hidden");
  $("form-item").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("item-nome").focus();
}
function fecharFormItem() {
  $("form-item").reset();
  $("form-item").classList.add("hidden");
  $("label-nova-cat").classList.add("hidden");
  estado.itemEditando = null;
}

$("estoque-novo").addEventListener("click", () => {
  if ($("form-item").classList.contains("hidden") || estado.itemEditando) abrirFormItem();
  else fecharFormItem();
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

    const campos = {
      categoria_id: categoriaId || null,
      nome: $("item-nome").value.trim(),
      quantidade: Number($("item-qtd").value),
      unidade: $("item-unidade").value,
      quantidade_minima: Number($("item-min").value),
    };
    if (!campos.nome) return mostrarMensagem("Digite o nome do produto.");

    const { error } = estado.itemEditando
      ? await db.from("itens_estoque").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", estado.itemEditando)
      : await db.from("itens_estoque").insert({ household_id: estado.householdId, ...campos });
    if (error) return mostrarMensagem(traduzirErro(error));

    fecharFormItem();
    await carregarEstoque();
  } finally {
    botao.disabled = false;
  }
});

// ---------- gerenciar categorias (painel Casa) ----------
function renderCategorias() {
  const box = $("casa-categorias");
  box.replaceChildren();
  if (estado.categorias.length === 0) {
    box.append(el("p", { class: "vazio" }, "Nenhuma categoria ainda."));
    return;
  }
  for (const c of estado.categorias) {
    const qtd = estado.itens.filter((i) => i.categoria_id === c.id).length;
    if (estado.catEditando === c.id) {
      const input = el("input", { type: "text", maxlength: "40", value: c.nome, required: "" });
      box.append(el("form", { class: "cat-linha",
        onsubmit: (ev) => { ev.preventDefault(); renomearCategoria(c, input.value); } },
        input,
        el("button", { type: "submit", class: "chip" }, "Salvar"),
        el("button", { type: "button", class: "chip",
          onclick: () => { estado.catEditando = null; renderCategorias(); } }, "Cancelar")));
      setTimeout(() => input.focus(), 0);
    } else {
      box.append(el("div", { class: "cat-linha" },
        el("span", { class: "cat-nome" }, c.nome, el("small", {}, ` · ${qtd} produto(s)`)),
        el("button", { type: "button", class: "excluir", "aria-label": "Renomear categoria",
          onclick: () => { estado.catEditando = c.id; renderCategorias(); } }, "✏️"),
        el("button", { type: "button", class: "excluir", "aria-label": "Excluir categoria",
          onclick: () => excluirCategoria(c, qtd) }, "🗑")));
    }
  }
}

async function renomearCategoria(c, nome) {
  nome = nome.trim();
  if (!nome) return mostrarMensagem("Digite um nome para a categoria.");
  if (nome !== c.nome) {
    const { error } = await db.from("categorias_estoque").update({ nome }).eq("id", c.id);
    if (error) return mostrarMensagem(traduzirErro(error));
  }
  estado.catEditando = null;
  await carregarEstoque();
}

async function excluirCategoria(c, qtd) {
  const aviso = qtd > 0
    ? `Excluir a categoria "${c.nome}"? Os ${qtd} produto(s) dela não serão apagados: ficam em "Sem categoria".`
    : `Excluir a categoria "${c.nome}"?`;
  if (!confirm(aviso)) return;
  const { error } = await db.from("categorias_estoque").delete().eq("id", c.id);
  if (error) return mostrarMensagem(traduzirErro(error));
  await carregarEstoque();
}

$("form-nova-categoria").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nome = $("nova-categoria-nome").value.trim();
  if (!nome) return;
  const { error } = await db.from("categorias_estoque").insert({ household_id: estado.householdId, nome });
  if (error) return mostrarMensagem(traduzirErro(error));
  $("nova-categoria-nome").value = "";
  await carregarEstoque();
});

// ============================================================
// MÓDULO: TAREFAS DA SEMANA
// ============================================================
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

const SELECT_MEMBROS = "user_id, nome_exibicao, papel, entrou_em";

async function carregarTarefas() {
  if (!estado.carregado.tarefas) esqueleto($("tarefas-lista"));
  const [mem, tar] = await Promise.all([
    db.from("household_members").select(SELECT_MEMBROS).eq("household_id", estado.householdId).order("entrou_em"),
    db.from("tarefas").select("id, titulo, dia_semana, responsavel_id, concluida_em").order("criada_em"),
  ]);
  if (mem.error || tar.error) {
    $("tarefas-lista").replaceChildren(el("p", { class: "vazio" }, "Não foi possível carregar as tarefas."));
    return mostrarMensagem(traduzirErro(mem.error || tar.error));
  }
  estado.membros = mem.data;
  estado.tarefas = tar.data;
  estado.carregado.tarefas = true;
  preencherResponsaveis();
  renderDias();
  renderTarefas();
  renderCasa();
}

async function recarregarMembros() {
  const { data, error } = await db.from("household_members").select(SELECT_MEMBROS)
    .eq("household_id", estado.householdId).order("entrou_em");
  if (error) return mostrarMensagem(traduzirErro(error));
  estado.membros = data;
  preencherResponsaveis();
  renderTarefas();
  renderCasa();
}

function preencherResponsaveis() {
  const sel = $("tarefa-responsavel");
  const atual = sel.value;
  sel.replaceChildren(
    el("option", { value: "" }, "Qualquer um"),
    ...estado.membros.map((m) => el("option", { value: m.user_id }, m.nome_exibicao || "Membro"))
  );
  if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
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
  const ordenadas = [...doDia].sort((a, b) => Number(tarefaFeita(a)) - Number(tarefaFeita(b)));
  for (const t of ordenadas) lista.append(cartaoTarefa(t));
}

function cartaoTarefa(t) {
  const feita = tarefaFeita(t);
  return el("div", { class: feita ? "tarefa feita" : "tarefa" },
    el("button", { type: "button", class: "check-redondo",
      "aria-label": feita ? "Marcar como pendente" : "Marcar como feita",
      onclick: () => alternarTarefa(t.id) }, feita ? "✓" : ""),
    el("div", { class: "tarefa-info clicavel", onclick: () => abrirFormTarefa(t) },
      el("span", { class: "tarefa-titulo" }, t.titulo),
      el("small", {}, t.responsavel_id ? "👤 " + nomeMembro(t.responsavel_id) : "👥 Qualquer um",
        el("span", { class: "dica" }, " · editar"))),
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

// ----- formulário (criar = vários dias; editar = uma tarefa) -----
function montarDiasDoForm() {
  $("tarefa-dias").replaceChildren(
    ...DIAS.map((nome, i) =>
      el("label", { class: "dia-check" }, el("input", { type: "checkbox", value: String(i) }), el("span", {}, nome)))
  );
  $("tarefa-dia").replaceChildren(...DIAS_LONGO.map((nome, i) => el("option", { value: String(i) }, nome)));
}

function abrirFormTarefa(t = null) {
  estado.tarefaEditando = t ? t.id : null;
  $("tarefa-form-titulo").textContent = t ? "Editar tarefa" : "Nova tarefa";
  $("tarefa-salvar").textContent = t ? "Salvar alterações" : "Salvar tarefa";
  $("tarefa-titulo").value = t ? t.titulo : "";
  $("tarefa-responsavel").value = t && t.responsavel_id ? t.responsavel_id : "";
  $("fieldset-dias").classList.toggle("hidden", !!t);
  $("label-tarefa-dia").classList.toggle("hidden", !t);
  if (t) $("tarefa-dia").value = String(t.dia_semana);
  document.querySelectorAll("#tarefa-dias input").forEach((c) => {
    c.checked = !t && Number(c.value) === estado.diaSelecionado;   // já marca o dia da tela
  });
  $("form-tarefa").classList.remove("hidden");
  $("form-tarefa").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("tarefa-titulo").focus();
}
function fecharFormTarefa() {
  $("form-tarefa").reset();
  $("form-tarefa").classList.add("hidden");
  estado.tarefaEditando = null;
}

$("tarefa-nova").addEventListener("click", () => {
  if ($("form-tarefa").classList.contains("hidden") || estado.tarefaEditando) abrirFormTarefa();
  else fecharFormTarefa();
});
$("tarefa-cancelar").addEventListener("click", fecharFormTarefa);

$("form-tarefa").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("tarefa-salvar");
  botao.disabled = true;
  try {
    const titulo = $("tarefa-titulo").value.trim();
    if (!titulo) return mostrarMensagem("Digite o nome da tarefa.");
    const responsavel = $("tarefa-responsavel").value || null;

    if (estado.tarefaEditando) {
      const { error } = await db.from("tarefas")
        .update({ titulo, responsavel_id: responsavel, dia_semana: Number($("tarefa-dia").value) })
        .eq("id", estado.tarefaEditando);
      if (error) return mostrarMensagem(traduzirErro(error));
    } else {
      const dias = [...document.querySelectorAll("#tarefa-dias input:checked")].map((c) => Number(c.value));
      if (dias.length === 0) return mostrarMensagem("Escolha pelo menos um dia.");
      // uma linha por dia escolhido (ex.: "Lavar louça" de segunda a sexta = 5 linhas)
      const linhas = dias.map((d) => ({
        household_id: estado.householdId, titulo, dia_semana: d, responsavel_id: responsavel,
      }));
      const { error } = await db.from("tarefas").insert(linhas);
      if (error) return mostrarMensagem(traduzirErro(error));
    }
    fecharFormTarefa();
    await carregarTarefas();
  } finally {
    botao.disabled = false;
  }
});

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

async function carregarCardapio() {
  if (!estado.carregado.cardapio) esqueleto($("cardapio-lista"), 4);
  const dias = datasDaSemana();
  const { data, error } = await db.from("refeicoes")
    .select("id, data, tipo, descricao")
    .gte("data", dataLocal(dias[0]))
    .lte("data", dataLocal(dias[6]));
  if (error) {
    $("cardapio-lista").replaceChildren(el("p", { class: "vazio" }, "Não foi possível carregar o cardápio."));
    return mostrarMensagem(traduzirErro(error));
  }
  estado.refeicoes = {};
  for (const r of data) estado.refeicoes[chaveRef(r.data, r.tipo)] = r;
  estado.editando = null;
  estado.carregado.cardapio = true;
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
  $("cardapio-lista").replaceChildren(...REFEICOES.map((ref) => cartaoRefeicao(ref, dataStr)));
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

  // upsert = "insere, ou atualiza se já existir" (chave única: casa + data + tipo)
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
  estado.carregado.cardapio = false;
  carregarCardapio();
}
$("cardapio-ant").addEventListener("click", () => mudarSemana(-1));
$("cardapio-prox").addEventListener("click", () => mudarSemana(+1));
$("cardapio-hoje").addEventListener("click", () => mudarSemana(0));
$("cardapio-copiar").addEventListener("click", copiarSemanaAnterior);

// ============================================================
// MÓDULO: CONVIDADOS
// ============================================================
function dataDe(str) {                       // "2026-11-14" -> Date ao meio-dia local
  const [ano, mes, dia] = str.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 12);
}
function diasAte(str) {
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  return Math.round((dataDe(str) - hoje) / 86400000);
}
function rotuloData(str) {
  const n = diasAte(str);
  const d = dataDe(str);
  const base = `${DIAS[d.getDay()]}, ${ddmm(d)}`;
  if (n === 0) return `${base} · hoje`;
  if (n === 1) return `${base} · amanhã`;
  if (n > 1) return `${base} · em ${n} dias`;
  if (n === -1) return `${base} · ontem`;
  return `${base} · há ${-n} dias`;
}

async function carregarConvidados() {
  if (!estado.carregado.convidados) esqueleto($("convidados-lista"));
  const { data, error } = await db.from("convidados").select("id, nome, data_visita, observacoes");
  if (error) {
    $("convidados-lista").replaceChildren(el("p", { class: "vazio" }, "Não foi possível carregar os convidados."));
    return mostrarMensagem(traduzirErro(error));
  }
  estado.convidados = data;
  estado.carregado.convidados = true;
  renderConvidados();
}

function renderConvidados() {
  const lista = $("convidados-lista");
  lista.replaceChildren();

  if (estado.convidados.length === 0) {
    lista.append(el("p", { class: "vazio" }, "Nenhum convidado cadastrado. Toque em “+ Convidado” para começar."));
    return;
  }

  const proximos = estado.convidados
    .filter((c) => c.data_visita && diasAte(c.data_visita) >= 0)
    .sort((a, b) => a.data_visita.localeCompare(b.data_visita));
  const semData = estado.convidados.filter((c) => !c.data_visita);
  const passados = estado.convidados
    .filter((c) => c.data_visita && diasAte(c.data_visita) < 0)
    .sort((a, b) => b.data_visita.localeCompare(a.data_visita));

  if (proximos.length) {
    lista.append(el("h3", { class: "grupo" }, "Próximas visitas"), ...proximos.map((c) => cartaoConvidado(c)));
  }
  if (semData.length) {
    lista.append(el("h3", { class: "grupo" }, "Sem data definida"), ...semData.map((c) => cartaoConvidado(c)));
  }
  if (passados.length) {
    lista.append(el("details", { class: "passados" },
      el("summary", {}, `Visitas anteriores (${passados.length})`),
      ...passados.map((c) => cartaoConvidado(c))));
  }
}

function cartaoConvidado(c) {
  const futuro = !c.data_visita || diasAte(c.data_visita) >= 0;
  const info = el("div", { class: "item-info" }, el("strong", {}, c.nome));
  if (c.data_visita) info.append(el("small", {}, "📅 " + rotuloData(c.data_visita)));
  if (c.observacoes) info.append(el("small", {}, "📝 " + c.observacoes));

  return el("div", { class: "item convidado" + (futuro ? "" : " passado") },
    info,
    el("div", { class: "item-ctrl" },
      el("button", { type: "button", class: "excluir", "aria-label": "Editar convidado",
        onclick: () => abrirFormConvidado(c) }, "✏️"),
      el("button", { type: "button", class: "excluir", "aria-label": "Excluir convidado",
        onclick: () => excluirConvidado(c.id) }, "🗑")));
}

function abrirFormConvidado(c = null) {
  estado.convidadoEditando = c ? c.id : null;
  $("convidado-form-titulo").textContent = c ? "Editar convidado" : "Novo convidado";
  $("convidado-nome").value = c ? c.nome : "";
  $("convidado-data").value = c && c.data_visita ? c.data_visita : "";
  $("convidado-obs").value = c && c.observacoes ? c.observacoes : "";
  $("form-convidado").classList.remove("hidden");
  $("form-convidado").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("convidado-nome").focus();
}
function fecharFormConvidado() {
  $("form-convidado").reset();
  $("form-convidado").classList.add("hidden");
  estado.convidadoEditando = null;
}

async function excluirConvidado(id) {
  const c = estado.convidados.find((x) => x.id === id);
  if (!c || !confirm(`Excluir "${c.nome}" da lista de convidados?`)) return;
  const { error } = await db.from("convidados").delete().eq("id", id);
  if (error) return mostrarMensagem(traduzirErro(error));
  estado.convidados = estado.convidados.filter((x) => x.id !== id);
  renderConvidados();
}

$("convidado-novo").addEventListener("click", () => {
  if ($("form-convidado").classList.contains("hidden") || estado.convidadoEditando) abrirFormConvidado();
  else fecharFormConvidado();
});
$("convidado-cancelar").addEventListener("click", fecharFormConvidado);

$("form-convidado").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const botao = $("convidado-salvar");
  botao.disabled = true;
  try {
    const campos = {
      nome: $("convidado-nome").value.trim(),
      data_visita: $("convidado-data").value || null,
      observacoes: $("convidado-obs").value.trim() || null,
    };
    if (!campos.nome) return mostrarMensagem("Digite o nome do convidado.");

    const { error } = estado.convidadoEditando
      ? await db.from("convidados").update(campos).eq("id", estado.convidadoEditando)
      : await db.from("convidados").insert({ household_id: estado.householdId, ...campos });
    if (error) return mostrarMensagem(traduzirErro(error));

    fecharFormConvidado();
    await carregarConvidados();
  } finally {
    botao.disabled = false;
  }
});

// ============================================================
// PAINEL CASA: membros, nome, código, backup, sair
// ============================================================
function renderCasa() {
  if (!estado.casa) return;
  $("house-name").textContent = estado.casa.nome;
  $("invite-code").textContent = estado.casa.codigo;
  $("casa-codigo-txt").textContent = estado.casa.codigo;
  $("casa-novo-codigo").classList.toggle("hidden", estado.meuPapel !== "admin");
  $("app-versao").textContent = APP_VERSION;
  $("casa-qtd-membros").textContent = String(estado.membros.length);

  $("casa-membros").replaceChildren(
    ...estado.membros.map((m) =>
      el("div", { class: "membro" },
        el("span", {}, (m.nome_exibicao || "Membro") + (m.user_id === estado.userId ? " (você)" : "")),
        m.papel === "admin" ? el("span", { class: "badge-admin" }, "admin") : ""))
  );

  const eu = estado.membros.find((m) => m.user_id === estado.userId);
  if (eu && document.activeElement !== $("meu-nome")) $("meu-nome").value = eu.nome_exibicao || "";
  renderCategorias();
}

$("form-nome").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const { error } = await db.rpc("set_display_name", {
    p_household: estado.householdId, p_nome: $("meu-nome").value.trim(),
  });
  if (error) return mostrarMensagem(traduzirErro(error));
  mostrarMensagem("Nome atualizado!", "ok");
  await recarregarMembros();
});

$("casa-novo-codigo").addEventListener("click", async () => {
  if (!confirm("O código atual vai parar de funcionar. Quem já está na casa continua nela. Gerar um novo código?")) return;
  const { data, error } = await db.rpc("regenerate_invite_code", { p_household: estado.householdId });
  if (error) return mostrarMensagem(traduzirErro(error));
  estado.casa.codigo = data;
  renderCasa();
  mostrarMensagem("Novo código gerado!", "ok");
});

$("btn-senha").addEventListener("click", () => mostrarTela("reset"));

async function sairDaCasa() {
  const sozinho = estado.membros.length <= 1;
  const aviso = sozinho
    ? "Você é a ÚNICA pessoa nesta casa. Sair vai APAGAR a casa e todos os dados dela (estoque, tarefas, cardápio e convidados). Exporte um backup antes se quiser guardar. Apagar mesmo?"
    : "Sair desta casa? Você perde o acesso aos dados dela (os outros continuam com tudo).";
  if (!confirm(aviso)) return;
  const { error } = await db.rpc("leave_household", { p_household: estado.householdId });
  if (error) return mostrarMensagem(traduzirErro(error));
  limparEstadoDados();
  mostrarMensagem("Você saiu da casa.", "ok");
  await carregarEstado();
}
$("btn-sair-casa").addEventListener("click", sairDaCasa);

// ---------- backup ----------
async function exportarBackup() {
  mostrarMensagem("Gerando backup…", "ok");
  const tabelas = ["categorias_estoque", "itens_estoque", "tarefas", "refeicoes", "convidados"];
  const resultados = await Promise.all(tabelas.map((t) => db.from(t).select("*")));
  const falha = resultados.find((r) => r.error);
  if (falha) return mostrarMensagem(traduzirErro(falha.error));

  const backup = {
    app: "Casa em Ordem", versao: APP_VERSION, exportado_em: new Date().toISOString(),
    casa: { nome: estado.casa.nome },
    membros: estado.membros.map((m) => ({ nome: m.nome_exibicao, papel: m.papel })),
  };
  tabelas.forEach((t, i) => { backup[t] = resultados[i].data; });

  const nomeArquivo = `casa-em-ordem-backup-${dataLocal()}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const arquivo = new File([blob], nomeArquivo, { type: "application/json" });

  // No celular, abre a folha de compartilhamento (salvar em Arquivos, enviar por WhatsApp...)
  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: "Backup Casa em Ordem" });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;   // a pessoa fechou a folha
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomeArquivo;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
$("btn-backup").addEventListener("click", exportarBackup);

// ============================================================
// SEM INTERNET + NOVA VERSÃO
// ============================================================
function atualizarFaixaOffline() { $("offline-bar").classList.toggle("hidden", navigator.onLine); }
window.addEventListener("offline", atualizarFaixaOffline);
window.addEventListener("online", () => {
  atualizarFaixaOffline();
  if (estado.householdId) recarregarTudo();
  else carregarEstado();
});

let swRegistro = null;
let atualizando = false;

function avisarNovaVersao() { $("update-bar").classList.remove("hidden"); }

async function iniciarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistro = await navigator.serviceWorker.register("sw.js");
  } catch { return; }

  // já havia uma versão instalada e outra esperando
  if (swRegistro.waiting && navigator.serviceWorker.controller) avisarNovaVersao();

  swRegistro.addEventListener("updatefound", () => {
    const novo = swRegistro.installing;
    if (!novo) return;
    novo.addEventListener("statechange", () => {
      if (novo.state === "installed" && navigator.serviceWorker.controller) avisarNovaVersao();
    });
  });

  // só recarrega quando a pessoa tocou em "Atualizar"
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (atualizando) location.reload();
  });

  // procura versão nova sempre que o app volta para a tela
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") swRegistro.update().catch(() => {});
  });
}

$("update-btn").addEventListener("click", () => {
  atualizando = true;
  if (swRegistro && swRegistro.waiting) swRegistro.waiting.postMessage("SKIP_WAITING");
  else location.reload();
});

$("verificar-update").addEventListener("click", async () => {
  if (!swRegistro) return mostrarMensagem("Este navegador não suporta atualização automática. Recarregue a página.");
  try { await swRegistro.update(); } catch { return mostrarMensagem(traduzirErro(new Error("Failed to fetch"))); }
  setTimeout(() => {
    if (swRegistro.waiting || swRegistro.installing) avisarNovaVersao();
    else mostrarMensagem(`Você já está na versão mais recente (v${APP_VERSION}).`, "ok");
  }, 1500);
});

// ============================================================
// INÍCIO
// ============================================================
montarDiasDoForm();
atualizarFaixaOffline();

if (/error_code=|error=access_denied/.test(HASH_INICIAL)) {
  limparHash();
  setTimeout(() => mostrarMensagem("Link inválido ou expirado. Peça um novo em “Esqueci minha senha”."), 300);
}

iniciarServiceWorker();
carregarEstado();
