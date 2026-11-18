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

// ───────────── Lecture à voix haute d'un contenu (validations, fenêtres) ─────────────
let lectureBtn = null;
const VOIX = () => { const v = window.speechSynthesis.getVoices(); return v.find((x) => /^fr(-|_)/i.test(x.lang) && /français|french|france/i.test(x.name + " " + x.lang)) || v.find((x) => /^fr(-|_)/i.test(x.lang)) || null; };

/** Texte propre pour la voix : sans émojis ni symboles, découpé en phrases de taille raisonnable (Android coupe les longs textes). */
export function decouperPourLecture(text, max = 220) {
  const propre = String(text || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ").replace(/[•→←↑↓✔✖✕▶■|]/g, " ").replace(/\s+/g, " ").trim();
  const phrases = propre.match(/[^.!?;:]+[.!?;:]?/g) ?? [];
  const out = []; let cur = "";
  for (const ph of phrases) {
    if ((cur + ph).length > max && cur) { out.push(cur.trim()); cur = ""; }
    if (ph.length > max) { for (let i = 0; i < ph.length; i += max) out.push(ph.slice(i, i + max).trim()); } else cur += ph + " ";
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export function arreterLecture() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (lectureBtn) { lectureBtn.textContent = lectureBtn.dataset.libelle || "🔊 Écouter"; lectureBtn.setAttribute("aria-pressed", "false"); lectureBtn = null; }
}

export function lire(text, bouton = null) {
  if (!("speechSynthesis" in window)) { status("Lecture vocale non prise en charge sur cet appareil"); return false; }
  arreterLecture();
  const morceaux = decouperPourLecture(text);
  if (!morceaux.length) return false;
  if (bouton) { lectureBtn = bouton; bouton.dataset.libelle = bouton.dataset.libelle || bouton.textContent; bouton.textContent = "⏹ Arrêter"; bouton.setAttribute("aria-pressed", "true"); }
  const voix = VOIX();
  morceaux.forEach((m, i) => {
    const u = new SpeechSynthesisUtterance(m);
    u.lang = "fr-FR"; u.rate = 1; if (voix) u.voice = voix;
    if (i === morceaux.length - 1) { u.onend = () => { if (lectureBtn === bouton) arreterLecture(); }; }
    u.onerror = (e) => { if (e.error !== "canceled" && e.error !== "interrupted" && lectureBtn === bouton) arreterLecture(); };
    window.speechSynthesis.speak(u);
  });
  return true;
}

/** Texte lisible d'un conteneur : sans les boutons ni les zones marquées .no-lire. */
function texteDe(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll("button, script, style, .no-lire, iframe").forEach((n) => n.remove());
  c.querySelectorAll("div, p, pre, li, h2, h3, h4").forEach((n) => n.append(". "));
  c.querySelectorAll("b, span, small, td").forEach((n) => n.append(" "));
  return c.textContent.replace(/\s+/g, " ").trim();
}

let lectureInit = false;
/** Boutons [data-lire] : « card » = la carte ou la fenêtre contenant le bouton ; « tout » = toutes les cartes de la zone. */
export function initLecture() {
  if (lectureInit) return; lectureInit = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-lire]");
    if (!b) return;
    e.preventDefault();
    if (b.getAttribute("aria-pressed") === "true") { arreterLecture(); return; }
    let txt = "";
    if (b.dataset.lire === "tout") txt = [...(b.closest("section, #modal-box") ?? document).querySelectorAll(".card")].map(texteDe).join(". ");
    else txt = texteDe(b.closest(".card, #modal-box") ?? b.parentElement);
    lire(txt, b);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") arreterLecture(); });
}
