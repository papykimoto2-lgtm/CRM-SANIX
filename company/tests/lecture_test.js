// Lecture vocale et taille du texte (téléphone). node lecture_test.js
const { launch, newPage, ok } = require("./harness.js");
const STUB = `window.__SPOKEN=[];window.__CANCEL=0;
window.SpeechSynthesisUtterance=function(t){this.text=t};
Object.defineProperty(window,"speechSynthesis",{value:{getVoices:()=>[{lang:"fr-FR",name:"Français"}],speak:(u)=>{window.__SPOKEN.push(u.text);setTimeout(()=>u.onend&&u.onend(),5)},cancel:()=>{window.__CANCEL++}},configurable:true});`;
(async () => {
  const { server, browser } = await launch(4179);
  try {
    const { page, errors } = await newPage(browser, { w: 390, h: 844, mobile: true, init: STUB });
    await page.goto("http://localhost:4179/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    console.log("▶ Taille du texte");
    ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--txt").trim())) === "1.15", "téléphone : taille 115 % par défaut");
    await page.click("#txt-size"); await page.waitForTimeout(100);
    ok((await page.locator("#txt-size").innerText()).includes("130"), "le bouton Aa passe à 130 %");
    ok((await page.evaluate(() => getComputedStyle(document.querySelector("#main")).zoom)) === "1", "Bureau 3D : taille inchangée")
    await page.reload(); await page.waitForSelector("#app:not([hidden])");
    ok((await page.locator("#txt-size").innerText()).includes("130"), "la taille est mémorisée après rechargement");
    console.log("▶ Lecture vocale");
    await page.click("#tabs button[data-id=valid]"); await page.waitForTimeout(400);
    ok(parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector("#main")).zoom)) === 1.3, "les autres onglets sont agrandis (zoom 1,3)");
    ok((await page.evaluate(() => document.querySelector("#main").scrollWidth <= innerWidth + 1)), "pas de défilement horizontal à 130 %");
    await page.locator("#main [data-lire=card]").first().click(); await page.waitForTimeout(200);
    const spoken = await page.evaluate(() => window.__SPOKEN.join(" "));
    ok(spoken.length > 20 && !/[🔊✔✖]/u.test(spoken) && !/Approuver|Refuser/.test(spoken), "la carte est lue, sans boutons ni émojis (" + spoken.slice(0, 50) + "…)");
    await page.locator("#main [data-lire=tout]").first().click(); await page.waitForTimeout(200);
    ok((await page.evaluate(() => window.__SPOKEN.length)) > 1, "« Tout écouter » lit toutes les cartes");
    await page.click("#tabs button[data-id=exec]"); await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__CANCEL)) > 0, "la lecture s'arrête au changement d'onglet");
    ok(errors.length === 0, "aucune erreur (" + errors.join(" | ") + ")");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
