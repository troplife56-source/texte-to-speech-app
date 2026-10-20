document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('text-input');
    const voiceSelect = document.getElementById('voice-select');
    const rateSlider = document.getElementById('rate-slider');
    const rateValue = document.getElementById('rate-value');
    const pitchSlider = document.getElementById('pitch-slider');
    const pitchValue = document.getElementById('pitch-value');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const splitBtn = document.getElementById('split-btn');
    const stopBtn = document.getElementById('stop-btn');
    const blocksContainer = document.getElementById('blocks-container');
    const historyList = document.getElementById('history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    let voices = [];

    function loadVoices() {
        voices = window.speechSynthesis.getVoices();
        voiceSelect.innerHTML = '';
        voices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.lang.includes('fr')) {
                option.selected = true;
            }
            voiceSelect.appendChild(option);
        });
    }

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    rateSlider.addEventListener('input', () => rateValue.textContent = rateSlider.value);
    pitchSlider.addEventListener('input', () => pitchValue.textContent = pitchSlider.value);
    volumeSlider.addEventListener('input', () => volumeValue.textContent = Math.round(volumeSlider.value * 100));

    splitBtn.addEventListener('click', () => {
        const text = textInput.value.trim();
        if (!text) {
            alert("Écris d'abord un texte !");
            return;
        }

        addToHistory(text);
        blocksContainer.innerHTML = '';

        let rawBlocks = text.split(/\n+/).filter(b => b.trim().length > 0);
        let finalBlocks = [];

        rawBlocks.forEach(paragraph => {
            if (paragraph.length > 180) {
                let sentences = paragraph.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [paragraph];
                let currentChunk = "";
                
                sentences.forEach(sentence => {
                    if ((currentChunk + " " + sentence).length < 180) {
                        currentChunk += (currentChunk ? " " : "") + sentence.trim();
                    } else {
                        if (currentChunk) finalBlocks.push(currentChunk);
                        currentChunk = sentence.trim();
                    }
                });
                if (currentChunk) finalBlocks.push(currentChunk);
            } else {
                finalBlocks.push(paragraph.trim());
            }
        });

        finalBlocks.forEach((blockText, index) => {
            const blockDiv = document.createElement('div');
            blockDiv.className = 'voice-block';
            blockDiv.style.cssText = "background: #1e293b; padding: 12px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #334155; display: flex; flex-direction: column; gap: 8px;";

            const p = document.createElement('p');
            p.textContent = `Bloc ${index + 1} : "${blockText}"`;
            p.style.cssText = "margin: 0; color: #f8fafc; font-size: 0.9rem; word-break: break-word;";

            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = "display: flex; gap: 10px;";

            const playBtn = document.createElement('button');
            playBtn.textContent = `Écouter (${index + 1})`;
            playBtn.style.cssText = "background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; flex: 1;";

            const downloadBtn = document.createElement('button');
            downloadBtn.textContent = `Télécharger Audio (${index + 1})`;
            downloadBtn.style.cssText = "background: #38bdf8; color: #0f172a; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; flex: 1;";

            playBtn.addEventListener('click', () => {
                speakText(blockText);
            });

            downloadBtn.addEventListener('click', () => {
                downloadBlockAudio(blockText, index + 1);
            });

            btnGroup.appendChild(playBtn);
            btnGroup.appendChild(downloadBtn);
            blockDiv.appendChild(p);
            blockDiv.appendChild(btnGroup);
            blocksContainer.appendChild(blockDiv);
        });
    });

    function speakText(text) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const selectedVoiceIndex = voiceSelect.value;
        if (voices[selectedVoiceIndex]) {
            utterance.voice = voices[selectedVoiceIndex];
        }
        utterance.rate = parseFloat(rateSlider.value);
        utterance.pitch = parseFloat(pitchSlider.value);
        utterance.volume = parseFloat(volumeSlider.value);
        window.speechSynthesis.speak(utterance);
    }

    // Téléchargement optimisé pour smartphone (format universel WAV)
    function downloadBlockAudio(text, blockNum) {
        window.speechSynthesis.cancel();
        
        if (!window.AudioContext && !window.webkitAudioContext) {
            alert("L'enregistrement audio n'est pas supporté par ce navigateur.");
            return;
        }

        try {
            const utterance = new SpeechSynthesisUtterance(text);
            const selectedVoiceIndex = voiceSelect.value;
            if (voices[selectedVoiceIndex]) {
                utterance.voice = voices[selectedVoiceIndex];
            }
            utterance.rate = parseFloat(rateSlider.value);
            utterance.pitch = parseFloat(pitchSlider.value);
            utterance.volume = parseFloat(volumeSlider.value);

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const dest = audioCtx.createMediaStreamDestination();
            
            let recorder;
            let chunks = [];

            // On essaie de forcer un format audio compatible (audio/wav ou audio/webm de repli)
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/wav')) {
                mimeType = 'audio/wav';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            }

            try {
                recorder = new MediaRecorder(dest.stream, { mimeType: mimeType });
            } catch (e) {
                recorder = new MediaRecorder(dest.stream);
            }

            recorder.ondataavailable = e => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                // Si le navigateur a sorti du webm, on le renomme en .wav pour forcer la lecture universelle, 
                // ou on garde l'extension adaptée.
                const extension = recorder.mimeType.includes('mp4') ? 'm4a' : 'wav';
                a.download = `voix-off-bloc-${blockNum}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };

            recorder.start();
            window.speechSynthesis.speak(utterance);

            utterance.onend = () => {
                setTimeout(() => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                    if (audioCtx.state !== 'closed') {
                        audioCtx.close();
                    }
                }, 500);
            };

            utterance.onerror = () => {
                if (recorder.state === 'recording') recorder.stop();
                alert("Erreur lors de la génération de l'audio.");
            };

        } catch (err) {
            console.error(err);
            alert("Impossible de télécharger ce bloc.");
        }
    }

    stopBtn.addEventListener('click', () => {
        window.speechSynthesis.cancel();
    });

    function addToHistory(text) {
        const li = document.createElement('li');
        li.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
        li.style.cssText = "cursor: pointer; padding: 4px 0; color: #94a3b8; font-size: 0.85rem;";
        li.addEventListener('click', () => {
            textInput.value = text;
        });
        historyList.appendChild(li);
    }

    clearHistoryBtn.addEventListener('click', () => {
        historyList.innerHTML = '';
    });
});
