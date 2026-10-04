const MIME_BY_EXTENSION = Object.freeze({
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg; codecs="opus"',
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    flac: 'audio/flac',
    caf: 'audio/x-caf'
});

let probe = null;

function extensionOf(url) {
    const path = String(url).split(/[?#]/)[0];
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * Filtra as fontes que o navegador diz conseguir tocar, mantendo a ordem de preferência do autor.
 * Extensões desconhecidas passam (o erro de carregamento cai para a próxima fonte).
 * @param {string|string[]} sources
 * @returns {string[]}
 */
export function rankSources(sources) {
    const list = Array.isArray(sources) ? sources : [sources];
    if (!probe) probe = document.createElement('audio');

    const playable = [];
    for (let i = 0; i < list.length; i++) {
        const url = list[i];
        if (typeof url !== 'string' || url.length === 0) continue;
        const mime = MIME_BY_EXTENSION[extensionOf(url)];
        if (!mime || probe.canPlayType(mime) !== '') playable.push(url);
    }
    return playable;
}
