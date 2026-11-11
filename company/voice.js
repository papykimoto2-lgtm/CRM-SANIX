// Assistant vocal du bureau du Président — Web Speech API, sans service tiers ni clé API.
let recognition = null;
let listening = false;
let speechEnabled = false;
let observer = null;
let lastSeen = "";
let lastSpoken = "";

const $ = (s) => document.querySelector(s);
const status = (message) => { const el = $("#voice-status"); if (el) el.textContent = message; };

function latestDirectorText() {
  const messages = [...document.querySelectorAll("#msgs .msg.d")];
  const last = messages.at(-1);
  if (!last) return "";
  const copy = last.cloneNode(true);
  copy.querySelectorAll("small").forEach((el) => el.remove());
  return copy.textContent.trim();
}

function speak(text) {
  if (!speechEnabled || !text || text === lastSpoken || !("speechSynthesis" in window)) return;
  lastSpoken = text;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = 1;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((v) => /^fr(-|_)/i.test(v.lang) && /français|french|france/i.test(v.name + " " + v.lang))
    || voices.find((v) => /^fr(-|_)/i.test(v.lang)) || null;
  utterance.onstart = () => status("Lecture de la réponse du directeur…");
  utterance.onend = () => status("Lecture vocale prête");
  utterance.onerror = () => status("Lecture vocale indisponible sur cet appareil");
  window.speechSynthesis.speak(utterance);
}

function initRecognition() {
  const API = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!API) return null;
  const r = new API();
  r.lang = "fr-FR";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onstart = () => { listening = true; updateMic(); status("Je vous écoute…"); };
  r.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;
    const input = $("#exec-t");
    if (input) {
      input.value = [input.value.trim(), transcript].filter(Boolean).join(input.value.trim() ? " " : "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
    status("Texte dicté. Relisez puis appuyez sur Envoyer.");
  };
  r.onerror = (event) => {
    const messages = { "not-allowed": "Autorisez le microphone dans le navigateur.", "no-speech": "Aucune parole détectée. Réessayez.", "audio-capture": "Microphone introuvable." };
    status(messages[event.error] || "La dictée vocale a échoué.");
  };
  r.onend = () => { listening = false; updateMic(); };
  return r;
}

function updateMic() {
  const button = $("#exec-mic");
  if (!button) return;
  button.textContent = listening ? "⏹ Arrêter" : "🎙️ Dicter";
  button.setAttribute("aria-pressed", String(listening));
  button.classList.toggle("listening", listening);
}

export function initVoice() {
  const mic = $("#exec-mic");
  const voice = $("#exec-voice");
  if (!mic || !voice) return;

  if (!observer) {
    const box = $("#msgs");
    lastSeen = latestDirectorText();
    if (box && "MutationObserver" in window) {
      observer = new MutationObserver(() => {
        const text = latestDirectorText();
        if (text && text !== lastSeen) { lastSeen = text; speak(text); }
      });
      observer.observe(box, { childList: true, subtree: true, characterData: true });
    }
  }

  if (!mic.dataset.bound) {
    mic.dataset.bound = "1";
    mic.addEventListener("click", () => {
      if (listening) { recognition?.stop(); return; }
      if (!recognition) recognition = initRecognition();
      if (!recognition) { status("La dictée vocale n'est pas prise en charge. Utilisez Chrome ou Edge."); return; }
      try { recognition.start(); } catch { status("Le microphone est déjà actif. Réessayez dans un instant."); }
    });
  }

  if (!voice.dataset.bound) {
    voice.dataset.bound = "1";
    voice.addEventListener("click", () => {
      speechEnabled = !speechEnabled;
      voice.setAttribute("aria-pressed", String(speechEnabled));
      voice.textContent = speechEnabled ? "🔊 Lecture vocale activée" : "🔇 Lecture vocale désactivée";
      voice.classList.toggle("active", speechEnabled);
      if (!speechEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
      status(speechEnabled ? "Les nouvelles réponses seront lues à voix haute." : "Lecture vocale désactivée");
    });
  }
  updateMic();
}
