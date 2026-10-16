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
    
    if (voices.length === 0) return;

    voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${voice.name} (${voice.lang})`;
        
        if (voice.lang.toLowerCase().includes('fr')) {
            option.selected = true;
        }
        
        voiceSelect.appendChild(option);
    });
}

loadVoices();
if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
}
setTimeout(loadVoices, 500);

// Mise à jour des affichages de curseurs voix
rateSlider.addEventListener('input', () => rateValue.textContent = rateSlider.value);
pitchSlider.addEventListener('input', () => pitchValue.textContent = pitchSlider.value);
volumeSlider.addEventListener('input', () => volumeValue.textContent = Math.round(volumeSlider.value * 100));

// Gestion de l'historique (LocalStorage)
function saveToHistory(text) {
    if (!text.trim()) return;
    let history = JSON.parse(localStorage.getItem('tts_history')) || [];
    if (history[0] !== text) {
        history.unshift(text);
        if (history.length > 5) history.pop();
        localStorage.setItem('tts_history', JSON.stringify(history));
        displayHistory();
    }
}

function displayHistory() {
    let history = JSON.parse(localStorage.getItem('tts_history')) || [];
    historyList.innerHTML = '';
    
    if (history.length === 0) {
        const li = document.createElement('li');
        li.textContent = "Aucun historique pour l'instant";
        li.style.color = "#888";
        li.style.cursor = "default";
        historyList.appendChild(li);
        return;
    }

    history.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        li.addEventListener('click', () => {
            textInput.value = item;
        });
        historyList.appendChild(li);
    });
}

displayHistory();

clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('tts_history');
    displayHistory();
});

// Découpage intelligent par phrases/ponctuation sous la limite de 250 caractères
function getSmartChunks(text, maxLength = 250) {
    const sentences = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];
    let chunks = [];
    let currentChunk = "";

    sentences.forEach(sentence => {
        if ((currentChunk + sentence).length <= maxLength) {
            currentChunk += sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            
            if (sentence.length > maxLength) {
                let subParts = sentence.split(/([,;])/);
                let subChunk = "";
                subParts.forEach(part => {
                    if ((subChunk + part).length <= maxLength) {
                        subChunk += part;
                    } else {
                        if (subChunk) chunks.push(subChunk.trim());
                        subChunk = part;
                    }
                });
                if (subChunk) currentChunk = subChunk;
                else currentChunk = "";
            } else {
                currentChunk = sentence;
            }
        }
    });
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

// Fonction pour lire un bloc avec l'API native du navigateur
function playSpecificText(textToSpeak) {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const selectedIndex = voiceSelect.value;

    if (voices[selectedIndex]) {
        utterance.voice = voices[selectedIndex];
    }

    utterance.rate = parseFloat(rateSlider.value);
    utterance.pitch = parseFloat(pitchSlider.value);
    utterance.volume = parseFloat(volumeSlider.value);

    utterance.onend = () => {
        saveToHistory(textToSpeak);
    };

    window.speechSynthesis.speak(utterance);
}

// Fonction pour ouvrir le flux audio dans un nouvel onglet (permettant le clic droit / enregistrer sous)
function openAudioTab(textToSpeak) {
    const encodedText = encodeURIComponent(textToSpeak);
    // Utilisation d'un lien direct alternatif et stable pour l'ouverture dans un onglet
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=fr&client=tw-ob`;
    window.open(audioUrl, '_blank');
}

// Bouton pour générer les blocs avec écoute et ouverture du lien audio
splitBtn.addEventListener('click', () => {
    const fullText = textInput.value.trim();
    if (fullText === "") {
        alert("Veuillez entrer du texte à découper !");
        return;
    }

    blocksContainer.innerHTML = '';
    const chunks = getSmartChunks(fullText, 250);

    chunks.forEach((chunk, index) => {
        const card = document.createElement('div');
        card.className = 'text-block-card';

        const p = document.createElement('p');
        p.textContent = `Bloc ${index + 1} : "${chunk}"`;

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '5px';

        const playBtn = document.createElement('button');
        playBtn.textContent = `Écouter (${index + 1})`;
        playBtn.style.backgroundColor = '#27ae60';
        playBtn.addEventListener('click', () => {
            playSpecificText(chunk);
        });

        const downloadBtnBlock = document.createElement('button');
        downloadBtnBlock.textContent = `Télécharger MP3 (${index + 1})`;
        downloadBtnBlock.style.backgroundColor = '#2980b9';
        downloadBtnBlock.addEventListener('click', () => {
            openAudioTab(chunk);
        });

        btnGroup.appendChild(playBtn);
        btnGroup.appendChild(downloadBtnBlock);

        card.appendChild(p);
        card.appendChild(btnGroup);
        blocksContainer.appendChild(card);
    });
});

stopBtn.addEventListener('click', () => {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
});