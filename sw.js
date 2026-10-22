/**
 * Service worker do Yugi-Uno (app instalável / PWA). Registrado por src/pwa/sw-register.js.
 *
 * O que ele faz:
 *   - Guarda o "esqueleto" do jogo (index.html, o JS/CSS do build, manifesto, ícones) na instalação, pra o app abrir
 *     mesmo sem internet (o Player vs CPU roda todo no aparelho; o online precisa de rede de qualquer jeito).
 *   - Página e arquivos sem hash: REDE PRIMEIRO, cache só de reserva. Online, todo mundo roda sempre a versão
 *     publicada (a rede do jogo recusa versões de protocolo diferentes, então ninguém pode ficar preso numa velha).
 *   - Arquivos com hash do build (assets/index-XXXXXXXX.js/.css): nunca mudam, então CACHE PRIMEIRO.
 *   - Fonte do Google: devolve a guardada e atualiza por trás (stale-while-revalidate).
 *   - Música (<audio> pede faixas de bytes, "Range"): vem da rede; na 1ª vez, o arquivo inteiro é guardado por trás
 *     e, sem internet, cada faixa pedida é cortada da cópia guardada (resposta 206) — a música toca offline.
 *   - Tudo de fora (Trystero, sinalização): passa direto, sem cache.
 *
 * BUILD e PRECACHE são preenchidos pelo plugin `pwaServiceWorker` do vite.config.js a cada `npm run build`: o arquivo
 * muda a cada versão publicada e é isso que faz o navegador instalar o service worker novo (e o jogo avisar
 * "nova versão disponível"). Fora do build (servidor de desenvolvimento) fica 'dev' com a lista vazia.
 */
const BUILD = '64515393843b';
const PRECACHE = ["./index.html","./assets/index-ClT0FPM7.js","./assets/index-bwMeuUBV.css"];

const SHELL_PREFIX = 'yugi-shell-';
const SHELL = `${SHELL_PREFIX}${BUILD}`;
const RUNTIME = 'yugi-runtime-v1';
const FONTS = 'yugi-fonts-v1';
const MEDIA = 'yugi-media-v1';
// Áudio guardado inteiro pra tocar sem internet (os <audio> pedem por faixas de bytes)
const MEDIA_PATH = /\/assets\/audio\//;
// Sempre no esqueleto, com ou sem build (caminhos relativos ao sw.js, que fica na raiz do jogo)
const CORE = [
    './',
    './manifest.webmanifest',
    './assets/icons/app/icon-192.png',
    './assets/icons/app/icon-512.png',
    './assets/icons/app/favicon-32.png'
];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
// Arquivo com hash do Vite (nome-XXXXXXXX.ext): conteúdo imutável
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/;
// Sem rede na navegação: espera no máximo isto antes de abrir a versão guardada (rede ruim ≠ sem rede)
const NAV_TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL);
        // Um por um: um arquivo que falhar não derruba a instalação inteira (addAll é tudo ou nada)
        await Promise.all(CORE.concat(PRECACHE).map((url) => cache.add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn(`[SW] Não guardou ${url}:`, err && err.message))));
        // A versão nova assume já: as páginas abertas continuam com o código que carregaram, e a próxima abertura
        // (ou o botão "atualizar") pega a nova
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== SHELL).map((n) => caches.delete(n)));
        await self.clients.claim();
        console.log(`[SW] Versão ${BUILD} ativa.`);
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (req.headers.has('range')) {
        if (url.origin === self.location.origin && MEDIA_PATH.test(url.pathname)) event.respondWith(mediaRange(req));
        return;
    }
    if (FONT_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(req, FONTS));
        return;
    }
    if (url.origin !== self.location.origin) return;
    if (req.mode === 'navigate') {
        event.respondWith(navigation(req));
        return;
    }
    if (HASHED.test(url.pathname)) {
        event.respondWith(cacheFirst(req));
        return;
    }
    event.respondWith(networkFirst(req, req));
});

/** Página: rede primeiro (com tempo máximo); sem rede, o index.html guardado — inclusive com ?room=... na URL. */
async function navigation(req) {
    const key = new URL('./', self.location.href).href;
    try {
        const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
        if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(key, copy)).catch(() => undefined);
        }
        return res;
    } catch (err) {
        const cached = await caches.match(key);
        if (cached) return cached;
        throw err;
    }
}

async function networkFirst(req, key) {
    try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME).then((cache) => cache.put(key, copy)).catch(() => undefined);
        }
        return res;
    } catch (err) {
        const cached = await caches.match(key);
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirst(req) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(req, copy)).catch(() => undefined);
    }
    return res;
}

async function staleWhileRevalidate(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const fresh = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => undefined);
        return res;
    }).catch(() => cached || Response.error());
    return cached || fresh;
}

/** Faixa de bytes de um áudio: da rede (guardando o arquivo inteiro uma vez, por trás); sem rede, da cópia guardada. */
async function mediaRange(req) {
    try {
        const res = await fetch(req);
        caches.open(MEDIA).then(async (cache) => {
            if (!(await cache.match(req.url))) await cache.add(req.url);
        }).catch(() => undefined);
        return res;
    } catch (err) {
        const full = await caches.match(req.url, { cacheName: MEDIA });
        if (!full) throw err;
        return sliceRange(req.headers.get('range'), full);
    }
}

/** Resposta 206 com o pedaço `range` ("bytes=início-fim", "bytes=início-" ou "bytes=-últimos") de um arquivo inteiro. */
async function sliceRange(range, full) {
    const body = await full.arrayBuffer();
    const total = body.byteLength;
    const m = /bytes=(\d*)-(\d*)/.exec(range || '');
    let start = 0;
    let end = total - 1;
    if (m && m[1] !== '') {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(Number(m[2]), total - 1);
    } else if (m && m[2] !== '') {
        start = Math.max(0, total - Number(m[2]));
    }
    if (start >= total) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    return new Response(body.slice(start, end + 1), {
        status: 206,
        headers: {
            'Content-Type': full.headers.get('Content-Type') || 'audio/ogg',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
        }
    });
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
