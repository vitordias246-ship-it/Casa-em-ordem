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
const estado = { householdId: null, categorias: [], itens: [] };

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
  $("house-name").textContent = casa.nome;
  $("invite-code").textContent = casa.codigo_convite;
  mostrarTela("app");
  carregarEstoque();
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

// ---------- início ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
carregarEstado();
