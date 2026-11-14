// Service worker: rede primeiro, cache se estiver offline.
// Não interfere nas chamadas ao Supabase (outro domínio).
// A versão nova NÃO assume sozinha: o app mostra "Nova versão disponível"
// e só troca quando a pessoa toca em "Atualizar".
const CACHE = "casa-em-ordem-v3";
const ARQUIVOS = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
