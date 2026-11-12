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
    .select("papel, households(nome, codigo_convite)")
    .eq("user_id", session.user.id)
    .limit(1);

  if (error) { mostrarMensagem(traduzirErro(error)); return mostrarTela("auth"); }
  if (!data || data.length === 0) return mostrarTela("house");

  const casa = data[0].households;
  $("house-name").textContent = casa.nome;
  $("invite-code").textContent = casa.codigo_convite;
  mostrarTela("app");
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

// ---------- início ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
carregarEstado();
