document.addEventListener('DOMContentLoaded', () => {

    /* =====================================================
       Réglages
       ===================================================== */
    const OPENAI_MODEL = 'gpt-4o-mini-tts';
    const ELEVEN_MODEL = 'eleven_multilingual_v2';
    const CHARS_PER_SECOND = 15;          // débit moyen d'une voix française à vitesse 1
    const HISTORY_MAX = 20;

    const OPENAI_VOICES = [
        ['marin', 'Marin (recommandée)'], ['cedar', 'Cedar (recommandée)'],
        ['alloy', 'Alloy'], ['ash', 'Ash'], ['ballad', 'Ballad'], ['coral', 'Coral'],
        ['echo', 'Echo'], ['fable', 'Fable'], ['nova', 'Nova'], ['onyx', 'Onyx'],
        ['sage', 'Sage'], ['shimmer', 'Shimmer'], ['verse', 'Verse'],
    ];
    // Voix de secours si la liste ElevenLabs ne peut pas être chargée
    const ELEVEN_FALLBACK = [
        ['JBFqnCBsd6RMkjVDRZzb', 'George'],
        ['21m00Tcm4TlvDq8ikWAM', 'Rachel'],
    ];

    const STORE = {
        settings: 'voixoff-reglages',
        history: 'voixoff-historique',
        key: engine => `voixoff-cle-${engine}`,
    };

    /* =====================================================
       Éléments
       ===================================================== */
    const $ = id => document.getElementById(id);
    const el = {
        text: $('text-input'), file: $('file-input'),
        statChars: $('stat-chars'), statWords: $('stat-words'), statDuration: $('stat-duration'),
        engine: $('engine-select'), apiKey: $('api-key'), keyProvider: $('key-provider'),
        keyToggle: $('key-toggle'), keyForget: $('key-forget'),
        voice: $('voice-select'), voicePreview: $('voice-preview'), instructions: $('instructions'),
        rate: $('rate-slider'), rateValue: $('rate-value'),
        pitch: $('pitch-slider'), pitchValue: $('pitch-value'),
        stability: $('stability-slider'), stabilityValue: $('stability-value'),
        volume: $('volume-slider'), volumeValue: $('volume-value'),
        blockSize: $('block-size'), blockSizeValue: $('block-size-value'),
        split: $('split-btn'), playAll: $('play-all-btn'), pause: $('pause-btn'), stop: $('stop-btn'),
        generateAll: $('generate-all-btn'), downloadAll: $('download-all-btn'),
        progress: $('progress'), progressBar: $('progress-bar'), progressLabel: $('progress-label'),
        blocks: $('blocks-container'), blockCount: $('block-count'),
        history: $('history-list'), historyCount: $('history-count'), clearHistory: $('clear-history-btn'),
        theme: $('theme-btn'), toasts: $('toasts'),
    };

    /* =====================================================
       Stockage local (protégé : navigation privée, etc.)
       ===================================================== */
    const storage = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignoré */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch { /* ignoré */ }
        },
    };

    let settings = Object.assign({
        engine: 'browser', voices: {}, rate: 1, pitch: 1, volume: 1,
        stability: 0.5, blockSize: 180, instructions: '', theme: null,
    }, storage.get(STORE.settings, {}));

    const saveSettings = () => storage.set(STORE.settings, settings);

    /* =====================================================
       Notifications
       ===================================================== */
    function toast(message, type = '') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = message;
        el.toasts.appendChild(t);
        setTimeout(() => t.remove(), type === 'error' ? 6000 : 3000);
    }

    /* =====================================================
       Thème clair / sombre
       ===================================================== */
    function applyTheme() {
        if (settings.theme) document.documentElement.dataset.theme = settings.theme;
        else delete document.documentElement.dataset.theme;
    }
    el.theme.addEventListener('click', () => {
        const isDark = settings.theme
            ? settings.theme === 'dark'
            : window.matchMedia('(prefers-color-scheme: dark)').matches;
        settings.theme = isDark ? 'light' : 'dark';
        applyTheme();
        saveSettings();
    });

    /* =====================================================
       Statistiques du texte
       ===================================================== */
    const formatDuration = seconds => {
        seconds = Math.round(seconds);
        if (seconds < 60) return `${seconds} s`;
        return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`;
    };
    const estimate = text => text.length / (CHARS_PER_SECOND * parseFloat(el.rate.value));

    function updateStats() {
        const text = el.text.value;
        el.statChars.textContent = text.length.toLocaleString('fr-FR');
        el.statWords.textContent = (text.trim() ? text.trim().split(/\s+/).length : 0).toLocaleString('fr-FR');
        el.statDuration.textContent = formatDuration(estimate(text));
    }
    el.text.addEventListener('input', updateStats);

    el.file.addEventListener('change', () => {
        const file = el.file.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            el.text.value = reader.result;
            updateStats();
            toast(`« ${file.name} » importé`);
        };
        reader.onerror = () => toast("Impossible de lire ce fichier.", 'error');
        reader.readAsText(file, 'UTF-8');
        el.file.value = '';
    });

    /* =====================================================
       Moteur, clé API et voix
       ===================================================== */
    const engine = () => el.engine.value;
    const isOnline = () => engine() !== 'browser';
    const getKey = () => el.apiKey.value.trim();

    let browserVoices = [];
    let elevenVoices = null; // liste chargée depuis l'API

    function fillVoices(list, saved) {
        el.voice.innerHTML = '';
        list.forEach(([value, label]) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            el.voice.appendChild(o);
        });
        if (saved && list.some(([v]) => v === saved)) el.voice.value = saved;
    }

    function loadBrowserVoices() {
        browserVoices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
        if (engine() !== 'browser') return;
        const sorted = [...browserVoices].sort((a, b) =>
            (b.lang.startsWith('fr') - a.lang.startsWith('fr')) || a.lang.localeCompare(b.lang));
        fillVoices(sorted.map(v => [v.voiceURI, `${v.name} (${v.lang})`]), settings.voices.browser);
        if (!settings.voices.browser && sorted[0]) el.voice.value = sorted[0].voiceURI;
    }

    async function loadElevenVoices() {
        if (engine() !== 'elevenlabs') return;
        fillVoices(elevenVoices || ELEVEN_FALLBACK, settings.voices.elevenlabs);
        if (!getKey() || elevenVoices) return;
        try {
            const res = await fetch('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': getKey() },
            });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            elevenVoices = (data.voices || []).map(v => [v.voice_id, v.name]);
            if (elevenVoices.length && engine() === 'elevenlabs') {
                fillVoices(elevenVoices, settings.voices.elevenlabs);
            }
        } catch {
            // la clé n'a peut-être pas le droit de lister les voix : on garde la liste de secours
        }
    }

    function refreshVoices() {
        if (engine() === 'browser') loadBrowserVoices();
        else if (engine() === 'openai') fillVoices(OPENAI_VOICES, settings.voices.openai);
        else loadElevenVoices();
    }

    function applyEngine() {
        const e = engine();
        document.body.dataset.engine = e;
        el.apiKey.value = isOnline() ? storage.get(STORE.key(e), '') : '';
        el.keyProvider.textContent = e === 'openai' ? 'OpenAI' : e === 'elevenlabs' ? 'ElevenLabs' : '';
        el.apiKey.placeholder = e === 'openai' ? 'sk-…' : 'Colle ta clé ElevenLabs';
        refreshVoices();
        updateButtons();
        blocks.forEach(renderBlockStatus);
    }

    el.engine.addEventListener('change', () => {
        stopAll();
        settings.engine = engine();
        saveSettings();
        applyEngine();
    });

    el.apiKey.addEventListener('change', () => {
        if (!isOnline()) return;
        const key = getKey();
        if (key) storage.set(STORE.key(engine()), key);
        else storage.remove(STORE.key(engine()));
        if (engine() === 'elevenlabs') { elevenVoices = null; loadElevenVoices(); }
        toast(key ? 'Clé enregistrée sur cet appareil' : 'Clé supprimée');
    });

    el.keyToggle.addEventListener('click', () => {
        const hidden = el.apiKey.type === 'password';
        el.apiKey.type = hidden ? 'text' : 'password';
        el.keyToggle.textContent = hidden ? 'Masquer' : 'Voir';
    });

    el.keyForget.addEventListener('click', () => {
        storage.remove(STORE.key(engine()));
        el.apiKey.value = '';
        toast('Clé supprimée de cet appareil');
    });

    el.voice.addEventListener('change', () => {
        settings.voices[engine()] = el.voice.value;
        saveSettings();
    });

    if (window.speechSynthesis && 'onvoiceschanged' in speechSynthesis) {
        speechSynthesis.onvoiceschanged = loadBrowserVoices;
    }

    /* =====================================================
       Curseurs
       ===================================================== */
    function bindSlider(input, output, key, format) {
        input.value = settings[key];
        const show = () => { output.textContent = format(parseFloat(input.value)); };
        show();
        input.addEventListener('input', () => {
            settings[key] = parseFloat(input.value);
            show();
            saveSettings();
            if (key === 'volume') player.volume = settings.volume;
            if (key === 'rate') { updateStats(); blocks.forEach(renderBlockMeta); }
        });
    }

    el.instructions.value = settings.instructions;
    el.instructions.addEventListener('change', () => {
        settings.instructions = el.instructions.value.trim();
        saveSettings();
    });

    /* =====================================================
       Découpage en blocs
       ===================================================== */
    function splitLong(piece, max) {
        if (piece.length <= max) return [piece];
        const out = [];
        let current = '';
        piece.split(/(?<=[,;:])\s+|\s+/).forEach(part => {
            const candidate = current ? `${current} ${part}` : part;
            if (candidate.length <= max) current = candidate;
            else {
                if (current) out.push(current);
                current = part;
            }
        });
        if (current) out.push(current);
        return out;
    }

    function splitIntoBlocks(text, max) {
        const result = [];
        text.split(/\n+/).map(p => p.trim()).filter(Boolean).forEach(paragraph => {
            if (paragraph.length <= max) { result.push(paragraph); return; }
            const sentences = paragraph.match(/[^.!?…]+[.!?…]+["'»”)]*|[^.!?…]+$/g) || [paragraph];
            let current = '';
            sentences.map(s => s.trim()).filter(Boolean).forEach(sentence => {
                const candidate = current ? `${current} ${sentence}` : sentence;
                if (candidate.length <= max) current = candidate;
                else {
                    if (current) result.push(current);
                    const pieces = splitLong(sentence, max);
                    current = pieces.pop();
                    result.push(...pieces);
                }
            });
            if (current) result.push(current);
        });
        return result;
    }

    /* =====================================================
       Blocs : données et affichage
       ===================================================== */
    let blocks = [];   // { text, audio: {sig, blob, url} | null, pending, error, el }
    let nextId = 1;

    function clearAudio(block) {
        if (block.audio) URL.revokeObjectURL(block.audio.url);
        block.audio = null;
        block.error = null;
    }

    function setBlocks(texts) {
        stopAll();
        blocks.forEach(clearAudio);
        blocks = texts.map(text => ({ id: nextId++, text, audio: null, pending: null, error: null }));
        renderBlocks();
    }

    function renderBlocks() {
        el.blocks.innerHTML = '';
        if (!blocks.length) {
            el.blocks.innerHTML = '<div class="empty">Écris un texte puis clique sur <b>Découper en blocs</b>.<br>Tu peux modifier chaque bloc en cliquant sur son texte.</div>';
        }
        blocks.forEach((block, i) => el.blocks.appendChild(buildBlock(block, i)));
        el.blockCount.textContent = blocks.length;
        updateButtons();
    }

    function buildBlock(block, index) {
        const card = document.createElement('article');
        card.className = 'block';
        block.el = card;

        const head = document.createElement('div');
        head.className = 'block-head';
        const left = document.createElement('div');
        const num = document.createElement('span');
        num.className = 'block-num';
        num.textContent = `Bloc ${index + 1}`;
        const meta = document.createElement('span');
        meta.className = 'block-meta';
        left.append(num, ' · ', meta);
        const status = document.createElement('span');
        status.className = 'status';
        head.append(left, status);

        const text = document.createElement('p');
        text.className = 'block-text';
        text.textContent = block.text;
        text.title = 'Clique pour modifier';
        try { text.contentEditable = 'plaintext-only'; } catch { text.contentEditable = 'true'; }
        text.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
            if (e.key === 'Escape') { text.textContent = block.text; text.blur(); }
        });
        text.addEventListener('blur', () => {
            const value = text.textContent.replace(/\s+/g, ' ').trim();
            if (!value) { text.textContent = block.text; return; }
            if (value !== block.text) {
                block.text = value;
                clearAudio(block);
                renderBlockMeta(block);
                renderBlockStatus(block);
                toast(`Bloc ${blocks.indexOf(block) + 1} modifié`);
            }
        });

        const actions = document.createElement('div');
        actions.className = 'block-actions';

        const play = button('▶ Écouter', 'success small', () => playFrom(blocks.indexOf(block), false));
        const download = button('⬇ MP3', 'ghost small online-only', () => downloadBlock(block));
        const copy = button('Copier', 'ghost small', async () => {
            try {
                await navigator.clipboard.writeText(block.text);
                toast('Texte copié');
            } catch { toast('Copie impossible', 'error'); }
        });
        const remove = button('Supprimer', 'ghost small', () => {
            stopAll();
            clearAudio(block);
            blocks = blocks.filter(b => b !== block);
            renderBlocks();
        });

        actions.append(play, download, copy, remove);
        card.append(head, text, actions);

        block.metaEl = meta;
        block.statusEl = status;
        renderBlockMeta(block);
        renderBlockStatus(block);
        return card;
    }

    function button(label, className, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    }

    function renderBlockMeta(block) {
        if (block.metaEl) {
            block.metaEl.textContent = `${block.text.length} car. · ≈ ${formatDuration(estimate(block.text))}`;
        }
    }

    function renderBlockStatus(block) {
        const s = block.statusEl;
        if (!s) return;
        s.className = 'status';
        if (!isOnline()) { s.hidden = true; return; }
        s.hidden = false;
        if (block.pending) { s.textContent = 'Génération…'; s.classList.add('loading'); }
        else if (block.error) { s.textContent = 'Erreur'; s.classList.add('error'); s.title = block.error; }
        else if (block.audio && block.audio.sig === signature(block)) { s.textContent = 'MP3 prêt'; s.classList.add('ready'); }
        else { s.textContent = 'Pas encore généré'; }
    }

    function updateButtons() {
        const has = blocks.length > 0;
        el.playAll.disabled = !has;
        el.pause.disabled = !has;
        el.generateAll.disabled = !has;
        el.downloadAll.disabled = !has;
    }

    el.split.addEventListener('click', () => {
        const text = el.text.value.trim();
        if (!text) { toast("Écris d'abord un texte.", 'error'); el.text.focus(); return; }
        addToHistory(text);
        setBlocks(splitIntoBlocks(text, settings.blockSize));
        toast(`${blocks.length} bloc${blocks.length > 1 ? 's' : ''} créé${blocks.length > 1 ? 's' : ''}`);
    });

    /* =====================================================
       Synthèse en ligne (OpenAI / ElevenLabs)
       ===================================================== */
    // Empreinte des réglages : si elle change, l'audio doit être régénéré
    function signature(block) {
        const e = engine();
        const parts = [e, el.voice.value, block.text, settings.rate];
        if (e === 'openai') parts.push(settings.instructions);
        if (e === 'elevenlabs') parts.push(settings.stability);
        return JSON.stringify(parts);
    }

    async function requestAudio(text) {
        const key = getKey();
        if (!key) throw new Error('Ajoute ta clé API dans « La voix ».');
        const e = engine();
        let res;
        try {
            if (e === 'openai') {
                const body = {
                    model: OPENAI_MODEL,
                    input: text,
                    voice: el.voice.value,
                    response_format: 'mp3',
                    speed: settings.rate,
                };
                if (settings.instructions) body.instructions = settings.instructions;
                res = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else {
                res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(el.voice.value)}?output_format=mp3_44100_128`, {
                    method: 'POST',
                    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
                    body: JSON.stringify({
                        text,
                        model_id: ELEVEN_MODEL,
                        voice_settings: {
                            stability: settings.stability,
                            similarity_boost: 0.75,
                            speed: Math.min(1.2, Math.max(0.7, settings.rate)),
                        },
                    }),
                });
            }
        } catch {
            throw new Error('Connexion au service impossible. Vérifie ta connexion internet.');
        }

        if (!res.ok) {
            let detail = '';
            try {
                const data = await res.json();
                detail = data?.error?.message || data?.detail?.message || data?.detail || '';
                if (typeof detail !== 'string') detail = JSON.stringify(detail);
            } catch { /* réponse non JSON */ }
            if (res.status === 401) throw new Error('Clé API refusée. Vérifie qu’elle est correcte.');
            if (res.status === 429) throw new Error('Limite ou crédit atteint chez le fournisseur. ' + detail);
            if (res.status === 402) throw new Error('Crédit insuffisant sur ton compte. ' + detail);
            throw new Error(`Erreur ${res.status}. ${detail}`.trim());
        }
        return res.blob();
    }

    // Renvoie l'audio du bloc, en le générant si besoin (une seule requête à la fois par bloc)
    function ensureAudio(block) {
        const sig = signature(block);
        if (block.audio && block.audio.sig === sig) return Promise.resolve(block.audio);
        if (block.pending && block.pending.sig === sig) return block.pending.promise;

        const promise = (async () => {
            try {
                const blob = await requestAudio(block.text);
                if (block.audio) URL.revokeObjectURL(block.audio.url);
                block.audio = { sig, blob: new Blob([blob], { type: 'audio/mpeg' }), url: '' };
                block.audio.url = URL.createObjectURL(block.audio.blob);
                block.error = null;
                return block.audio;
            } catch (err) {
                block.error = err.message;
                throw err;
            } finally {
                block.pending = null;
                renderBlockStatus(block);
            }
        })();
        block.pending = { sig, promise };
        block.error = null;
        renderBlockStatus(block);
        return promise;
    }

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function downloadBlock(block) {
        const n = blocks.indexOf(block) + 1;
        try {
            const audio = await ensureAudio(block);
            saveBlob(audio.blob, `voix-off-bloc-${String(n).padStart(2, '0')}.mp3`);
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    function showProgress(done, total, label) {
        el.progress.hidden = false;
        el.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
        el.progressLabel.textContent = `${label} ${done}/${total}`;
    }
    const hideProgress = () => { el.progress.hidden = true; };

    async function generateAll() {
        const list = [...blocks];
        let done = 0;
        showProgress(0, list.length, 'Génération');
        for (const block of list) {
            await ensureAudio(block); // s'arrête à la première erreur
            done++;
            showProgress(done, list.length, 'Génération');
        }
        return list;
    }

    el.generateAll.addEventListener('click', async () => {
        el.generateAll.disabled = el.downloadAll.disabled = true;
        try {
            await generateAll();
            toast('Tous les MP3 sont prêts', 'success');
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            hideProgress();
            updateButtons();
        }
    });

    el.downloadAll.addEventListener('click', async () => {
        el.generateAll.disabled = el.downloadAll.disabled = true;
        try {
            const list = await generateAll();
            // Les MP3 de même format s'enchaînent bout à bout sans problème
            const full = new Blob(list.map(b => b.audio.blob), { type: 'audio/mpeg' });
            saveBlob(full, 'voix-off-complete.mp3');
            toast('MP3 complet téléchargé', 'success');
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            hideProgress();
            updateButtons();
        }
    });

    /* =====================================================
       Lecture (un bloc ou tout à la suite)
       ===================================================== */
    const player = new Audio();
    player.volume = settings.volume;

    let session = 0;        // change à chaque Stop pour annuler la lecture en cours
    let paused = false;

    function markPlaying(index) {
        blocks.forEach((b, i) => b.el && b.el.classList.toggle('playing', i === index));
        const current = blocks[index];
        if (current && current.el) current.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function stopAll() {
        session++;
        paused = false;
        el.pause.textContent = '⏸ Pause';
        if (window.speechSynthesis) speechSynthesis.cancel();
        player.pause();
        player.removeAttribute('src');
        markPlaying(-1);
    }

    function speakBrowser(text) {
        return new Promise((resolve, reject) => {
            if (!window.speechSynthesis) { reject(new Error("Ce navigateur ne sait pas lire à voix haute.")); return; }
            const u = new SpeechSynthesisUtterance(text);
            const voice = browserVoices.find(v => v.voiceURI === el.voice.value);
            if (voice) { u.voice = voice; u.lang = voice.lang; }
            u.rate = settings.rate;
            u.pitch = settings.pitch;
            u.volume = settings.volume;
            u.onend = () => resolve();
            u.onerror = e => (e.error === 'canceled' || e.error === 'interrupted') ? resolve() : reject(new Error('Erreur de lecture : ' + e.error));
            speechSynthesis.speak(u);
        });
    }

    function playUrl(url) {
        return new Promise((resolve, reject) => {
            player.src = url;
            player.volume = settings.volume;
            player.onended = () => resolve();
            player.onerror = () => reject(new Error('Lecture du MP3 impossible.'));
            player.play().catch(reject);
        });
    }

    async function playFrom(start, continuous) {
        stopAll();
        const mySession = session;
        await new Promise(r => setTimeout(r, 60)); // Chrome ignore parfois speak() juste après cancel()

        for (let i = start; i < blocks.length; i++) {
            if (mySession !== session) return;
            const block = blocks[i];
            markPlaying(i);
            try {
                if (isOnline()) {
                    const audio = await ensureAudio(block);
                    // on prépare le bloc suivant pendant la lecture
                    if (continuous && blocks[i + 1]) ensureAudio(blocks[i + 1]).catch(() => {});
                    if (mySession !== session) return;
                    await playUrl(audio.url);
                } else {
                    await speakBrowser(block.text);
                }
            } catch (err) {
                if (mySession === session) { toast(err.message, 'error'); markPlaying(-1); }
                return;
            }
            if (!continuous) break;
        }
        if (mySession === session) markPlaying(-1);
    }

    el.playAll.addEventListener('click', () => playFrom(0, true));
    el.stop.addEventListener('click', stopAll);

    el.pause.addEventListener('click', () => {
        if (!paused) {
            if (isOnline()) player.pause(); else if (window.speechSynthesis) speechSynthesis.pause();
            paused = true;
            el.pause.textContent = '▶ Reprendre';
        } else {
            if (isOnline()) player.play().catch(() => {}); else if (window.speechSynthesis) speechSynthesis.resume();
            paused = false;
            el.pause.textContent = '⏸ Pause';
        }
    });

    el.voicePreview.addEventListener('click', async () => {
        const sample = 'Bonjour, voici un aperçu de cette voix pour ta voix off.';
        stopAll();
        const mySession = session;
        try {
            if (isOnline()) {
                el.voicePreview.disabled = true;
                const blob = await requestAudio(sample);
                if (mySession !== session) return;
                const url = URL.createObjectURL(blob);
                await playUrl(url);
                URL.revokeObjectURL(url);
            } else {
                await speakBrowser(sample);
            }
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            el.voicePreview.disabled = false;
        }
    });

    /* =====================================================
       Historique
       ===================================================== */
    function renderHistory() {
        const items = storage.get(STORE.history, []);
        el.history.innerHTML = '';
        items.forEach(text => {
            const li = document.createElement('li');
            li.textContent = text;
            li.title = text.slice(0, 300);
            li.addEventListener('click', () => {
                el.text.value = text;
                updateStats();
                el.text.focus();
                toast('Texte rechargé');
            });
            el.history.appendChild(li);
        });
        el.historyCount.textContent = items.length;
    }

    function addToHistory(text) {
        const items = storage.get(STORE.history, []).filter(t => t !== text);
        items.unshift(text);
        storage.set(STORE.history, items.slice(0, HISTORY_MAX));
        renderHistory();
    }

    el.clearHistory.addEventListener('click', () => {
        storage.set(STORE.history, []);
        renderHistory();
    });

    /* =====================================================
       Démarrage
       ===================================================== */
    applyTheme();
    bindSlider(el.rate, el.rateValue, 'rate', v => `${v.toFixed(1)}×`);
    bindSlider(el.pitch, el.pitchValue, 'pitch', v => v.toFixed(1));
    bindSlider(el.stability, el.stabilityValue, 'stability', v => `${Math.round(v * 100)} %`);
    bindSlider(el.volume, el.volumeValue, 'volume', v => `${Math.round(v * 100)} %`);
    bindSlider(el.blockSize, el.blockSizeValue, 'blockSize', v => String(v));

    el.engine.value = settings.engine;
    applyEngine();
    renderHistory();
    updateStats();
    renderBlocks();
});
