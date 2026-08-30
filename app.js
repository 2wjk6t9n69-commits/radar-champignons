/* Radar Champignon — app shell
 * Carte Leaflet/OSM + météo Open-Meteo (gratuite, sans clé) + moteur V32 local.
 */
(function(){
  'use strict';

  const DECISION_COLORS = {
    'prioritaire': '#8fae5b',
    'très favorable': '#6a8f4f',
    'favorable': '#a8c98f',
    'à surveiller': '#d1813f',
    'à éviter': '#c23b22',
    'hors saison': '#7a4b32',
    'insuffisant': '#5a5248'
  };

  const state = {
    marker: null,
    lastLatLng: null,
    weather: null,
    weatherLoading: false,
    results: {},           // species id -> result
    activeSpecies: null,
    hosts: new Set(),
    formation: '',
    phTouched: false,
    moistureTouched: false,
    drainage: ''
  };

  // ---------- Map ----------
  const map = L.map('map', { zoomControl:false, attributionControl:true })
    .setView([46.6, 2.4], 6); // France, vue large par défaut

  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.control.attribution({ position:'bottomleft', prefix:false })
    .addAttribution('© OpenStreetMap · météo © Open-Meteo').addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; contributeurs OpenStreetMap'
  }).addTo(map);

  const radarIcon = L.divIcon({
    className: '',
    html: '<div class="radar-marker"><div class="ping"></div><div class="dot"></div></div>',
    iconSize: [26,26],
    iconAnchor: [13,13]
  });

  map.on('click', (e) => selectSector(e.latlng));

  // ---------- UI refs ----------
  const sheet = document.getElementById('sheet');
  const sheetHandle = document.getElementById('sheet-handle');
  const emptyState = document.getElementById('sheet-empty-state');
  const content = document.getElementById('sheet-content');
  const sheetTitle = document.getElementById('sheet-title');
  const sheetCoords = document.getElementById('sheet-coords');
  const speciesRow = document.getElementById('species-row');
  const detail = document.getElementById('detail');
  const toast = document.getElementById('toast');

  function openSheet(){ sheet.classList.add('open'); }
  sheetHandle.addEventListener('click', () => sheet.classList.toggle('open'));

  function showToast(msg, ms=2600){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>toast.classList.remove('show'), ms);
  }

  // ---------- Inputs panel ----------
  const inputsToggle = document.getElementById('inputs-toggle');
  const inputsPanel = document.getElementById('inputs-panel');
  const inputsCaret = document.getElementById('inputs-caret');
  inputsToggle.addEventListener('click', () => {
    inputsPanel.classList.toggle('open');
    inputsCaret.textContent = inputsPanel.classList.contains('open') ? '▴' : '▾';
  });

  document.getElementById('host-chips').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const v = btn.dataset.v;
    if(state.hosts.has(v)){ state.hosts.delete(v); btn.classList.remove('active'); }
    else { state.hosts.add(v); btn.classList.add('active'); }
    rescoreAll();
  });

  document.getElementById('formation-chips').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const v = btn.dataset.v;
    const already = btn.classList.contains('active');
    document.querySelectorAll('#formation-chips button').forEach(b=>b.classList.remove('active'));
    state.formation = already ? '' : v;
    if(!already) btn.classList.add('active');
    rescoreAll();
  });

  const phRange = document.getElementById('ph-range');
  const phValue = document.getElementById('ph-value');
  phRange.addEventListener('input', ()=>{
    state.phTouched = true;
    phValue.textContent = (phRange.value/10).toFixed(1);
    rescoreAll();
  });

  const moistureRange = document.getElementById('moisture-range');
  const moistureValue = document.getElementById('moisture-value');
  moistureRange.addEventListener('input', ()=>{
    state.moistureTouched = true;
    moistureValue.textContent = moistureRange.value + ' %';
    rescoreAll();
  });

  document.getElementById('drainage-select').addEventListener('change', (e)=>{
    state.drainage = e.target.value;
    rescoreAll();
  });

  // ---------- Locate ----------
  document.getElementById('locate-btn').addEventListener('click', () => {
    if(!navigator.geolocation){ showToast('Géolocalisation indisponible'); return; }
    showToast('Recherche de la position…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setView(ll, 14);
        selectSector(ll);
      },
      () => showToast('Position indisponible — vérifie les autorisations'),
      { enableHighAccuracy:true, timeout:10000 }
    );
  });

  document.getElementById('help-btn').addEventListener('click', () => {
    showToast('Le score note la compatibilité écologique, pas une garantie de récolte.', 4200);
  });

  // ---------- Weather (Open-Meteo, gratuit, sans clé) ----------
  async function fetchWeather(lat, lng){
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&hourly=temperature_2m,precipitation,soil_moisture_0_to_7cm&past_days=35&forecast_days=10&timezone=auto`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('meteo http ' + res.status);
    const data = await res.json();
    const h = data.hourly;
    if(!h || !h.time) throw new Error('reponse meteo incomplete');

    // Regrouper par jour (moyenne temp / somme pluie / moyenne humidité sol)
    const byDay = new Map();
    for(let i=0;i<h.time.length;i++){
      const day = h.time[i].slice(0,10);
      if(!byDay.has(day)) byDay.set(day, { temp:[], rain:[], soil:[] });
      const bucket = byDay.get(day);
      const t = h.temperature_2m ? h.temperature_2m[i] : null;
      const p = h.precipitation ? h.precipitation[i] : null;
      const s = h.soil_moisture_0_to_7cm ? h.soil_moisture_0_to_7cm[i] : null;
      if(Number.isFinite(t)) bucket.temp.push(t);
      if(Number.isFinite(p)) bucket.rain.push(p);
      if(Number.isFinite(s)) bucket.soil.push(s);
    }
    const days = [...byDay.keys()].sort();
    const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
    const sum = a => a.length ? a.reduce((x,y)=>x+y,0) : null;

    const temp = days.map(d => avg(byDay.get(d).temp));
    const rain = days.map(d => sum(byDay.get(d).rain));
    const soil = days.map(d => avg(byDay.get(d).soil));

    const futureSoilSlice = soil.slice(-10, -7).filter(v=>v!=null);
    const futureRainSlice = rain.slice(-10, -7).filter(v=>v!=null);

    return {
      temp, rain, soil,
      futureSoilMoisture: futureSoilSlice.length ? avg(futureSoilSlice) : null,
      futureRain: futureRainSlice.length ? sum(futureRainSlice) : null
    };
  }

  // ---------- Sector selection ----------
  async function selectSector(latlng){
    state.lastLatLng = latlng;
    if(state.marker) map.removeLayer(state.marker);
    state.marker = L.marker(latlng, { icon: radarIcon }).addTo(map);

    emptyState.style.display = 'none';
    content.style.display = 'block';
    openSheet();
    sheetTitle.textContent = 'Récupération de la météo…';
    sheetCoords.textContent = formatCoords(latlng);
    speciesRow.innerHTML = '';
    detail.innerHTML = loadingRow();

    try{
      state.weatherLoading = true;
      state.weather = await fetchWeather(latlng.lat, latlng.lng);
      state.weatherLoading = false;
      sheetTitle.textContent = 'Secteur analysé';
      rescoreAll();
    }catch(err){
      state.weatherLoading = false;
      sheetTitle.textContent = 'Secteur (météo indisponible)';
      showToast('Météo indisponible pour ce point — score basé sur habitat/sol/saison');
      rescoreAll();
    }
  }

  function loadingRow(){
    return '<div style="padding:24px 0;color:rgba(246,242,231,.5);font-size:13px;">Analyse en cours…</div>';
  }

  function currentForestSoil(){
    const forest = {
      essence: [...state.hosts].join(' '),
      formation: state.formation
    };
    const soil = {};
    if(state.phTouched) soil.ph = phRange.value/10;
    if(state.moistureTouched) soil.moisture = moistureRange.value/100;
    if(state.drainage) soil.drainage = state.drainage;
    return { forest, soil };
  }

  function rescoreAll(){
    if(!state.lastLatLng || !window.RadarChampignon) return;
    const { forest, soil } = currentForestSoil();
    const results = {};
    for(const id of Object.keys(RadarChampignon.SPECIES)){
      try{
        results[id] = RadarChampignon.scoreSector({
          species: id,
          date: new Date(),
          forest, soil,
          weather: state.weather || {},
          dataQuality: state.weather ? 1 : 0.7
        });
      }catch(err){ /* espèce ignorée si erreur inattendue */ }
    }
    state.results = results;
    const order = Object.keys(results).sort((a,b)=>{
      const sa = results[a].score, sb = results[b].score;
      if(sa==null) return 1; if(sb==null) return -1;
      return sb - sa;
    });
    if(!state.activeSpecies || !results[state.activeSpecies]) state.activeSpecies = order[0];
    renderSpeciesRow(order);
    renderDetail(state.activeSpecies);
  }

  function renderSpeciesRow(order){
    speciesRow.innerHTML = '';
    for(const id of order){
      const r = state.results[id];
      const chip = document.createElement('div');
      chip.className = 'species-chip' + (id===state.activeSpecies ? ' active' : '');
      chip.innerHTML = `
        <div class="sp-name">${r.species}</div>
        <div class="sp-score-row">
          <div class="sp-dot" style="background:${DECISION_COLORS[r.decision]||'#5a5248'}"></div>
          <div class="sp-score-num">${r.score==null ? '—' : r.score}</div>
        </div>
        <div class="sp-decision-tiny">${r.decision}</div>
      `;
      chip.addEventListener('click', () => {
        state.activeSpecies = id;
        renderSpeciesRow(order);
        renderDetail(id);
      });
      speciesRow.appendChild(chip);
    }
  }

  function gaugeSvg(score, color){
    const r = 40, c = 2*Math.PI*r;
    const pct = Math.max(0, Math.min(100, score||0))/100;
    const offset = c*(1-pct);
    return `
      <svg width="96" height="96" viewBox="0 0 96 96" style="transform:rotate(-90deg)">
        <circle cx="48" cy="48" r="${r}" fill="none" stroke="rgba(246,242,231,.09)" stroke-width="8"/>
        <circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="8"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
      </svg>`;
  }

  function renderDetail(id){
    const r = state.results[id];
    if(!r){ detail.innerHTML=''; return; }
    const color = DECISION_COLORS[r.decision] || '#5a5248';
    detail.innerHTML = `
      <div class="gauge-row">
        <div class="gauge-wrap">
          ${gaugeSvg(r.score, color)}
          <div class="gauge-center">
            <div class="gauge-score">${r.score==null?'—':r.score}</div>
            <div class="gauge-label">score /100</div>
          </div>
        </div>
        <div class="decision-block">
          <span class="decision-pill" style="background:${color}22;color:${color};border:1px solid ${color}55;">${r.decision}</span>
          <div class="confidence-line">Confiance ${r.confidence}%</div>
          <div class="confidence-track"><div class="confidence-fill" style="width:${r.confidence}%;background:${color};"></div></div>
        </div>
      </div>
      <ul class="reasons">
        ${r.reasons.map(x=>`<li>${x}</li>`).join('')}
      </ul>
      <p class="warning-note">${r.warning}</p>
    `;
  }

  function formatCoords(ll){
    return `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  }

  // ---------- Install hint (PWA) ----------
  const installHint = document.getElementById('install-hint');
  document.getElementById('install-dismiss').addEventListener('click', () => {
    installHint.classList.remove('show');
    localStorage.setItem('radarchampi_install_dismissed', '1');
  });
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if(!localStorage.getItem('radarchampi_install_dismissed')) installHint.classList.add('show');
  });
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isIOS && !isStandalone && !localStorage.getItem('radarchampi_install_dismissed')){
    setTimeout(()=>installHint.classList.add('show'), 1500);
  }

  // ---------- Service worker ----------
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
  }

})();
