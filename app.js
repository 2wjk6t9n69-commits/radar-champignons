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
    drainage: '',
    obsFormOpen: false
  };

  // ---------- Observations terrain (stockage local, sur cet appareil) ----------
  const OBS_KEY = 'radarchampi_observations_v1';
  const NEARBY_RADIUS_M = 300;

  function loadObservations(){
    try{ return JSON.parse(localStorage.getItem(OBS_KEY) || '[]'); }
    catch(e){ return []; }
  }
  function saveObservations(list){
    localStorage.setItem(OBS_KEY, JSON.stringify(list));
  }
  function addObservation(obs){
    const list = loadObservations();
    list.push(obs);
    saveObservations(list);
  }
  function deleteObservation(id){
    saveObservations(loadObservations().filter(o => o.id !== id));
    refreshObsMarkers();
    renderObsSection();
    if(document.getElementById('history-panel').classList.contains('open')) renderHistoryPanel();
  }
  window.__deleteObs = deleteObservation; // utilisé par les popups Leaflet (HTML string)

  function distanceMeters(lat1, lng1, lat2, lng2){
    const R = 6371000, toRad = d => d*Math.PI/180;
    const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  function nearbyObservations(lat, lng, radius=NEARBY_RADIUS_M, species=null){
    return loadObservations()
      .filter(o => (!species || o.species===species) && distanceMeters(lat,lng,o.lat,o.lng) <= radius)
      .sort((a,b) => new Date(b.date) - new Date(a.date));
  }
  function speciesNameById(id){
    return (window.RadarChampignon && RadarChampignon.SPECIES[id]) ? RadarChampignon.SPECIES[id].name : id;
  }

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

  const obsLayer = L.layerGroup().addTo(map);
  function refreshObsMarkers(){
    obsLayer.clearLayers();
    for(const o of loadObservations()){
      const icon = L.divIcon({
        className:'',
        html:`<div class="obs-marker ${o.result==='found'?'found':'rien'}"></div>`,
        iconSize:[16,16], iconAnchor:[8,8]
      });
      const dateStr = new Date(o.date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
      const popupHtml = `
        <div class="obs-popup">
          <b>${speciesNameById(o.species)} — ${o.result==='found' ? ('trouvé' + (o.quantity ? ' ×'+o.quantity : '')) : 'rien trouvé'}</b>
          <div class="op-date">${dateStr}</div>
          ${o.note ? `<div>${escapeHtml(o.note)}</div>` : ''}
        </div>`;
      L.marker([o.lat, o.lng], { icon }).addTo(obsLayer).bindPopup(popupHtml);
    }
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  refreshObsMarkers();

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
    document.getElementById('sheet-nav-links').innerHTML = navLinksHtml(latlng.lat, latlng.lng);
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
    renderObsSection();
  }

  function renderSpeciesRow(order){
    speciesRow.innerHTML = '';
    for(const id of order){
      const r = state.results[id];
      const foundNearby = state.lastLatLng
        ? nearbyObservations(state.lastLatLng.lat, state.lastLatLng.lng, NEARBY_RADIUS_M, id).some(o=>o.result==='found')
        : false;
      const chip = document.createElement('div');
      chip.className = 'species-chip' + (id===state.activeSpecies ? ' active' : '');
      chip.innerHTML = `
        ${foundNearby ? `<div class="chip-badge" title="Déjà trouvé à proximité"></div>` : ''}
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

  function navLinksHtml(lat, lng){
    const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
    const waze = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    return `
      <a class="nav-link-btn" href="${gmaps}" target="_blank" rel="noopener">📍 Itinéraire Maps</a>
      <a class="nav-link-btn" href="${waze}" target="_blank" rel="noopener">🚗 Waze</a>
    `;
  }

  // ---------- Section "retour de terrain" (dans la fiche espèce) ----------
  const obsSection = document.getElementById('obs-section');
  let obsDraft = { result:'found', quantity:'', confidence:'certain', note:'' };

  function renderObsSection(){
    if(!state.lastLatLng || !state.activeSpecies){ obsSection.innerHTML=''; return; }
    const spName = speciesNameById(state.activeSpecies);
    const nearby = nearbyObservations(state.lastLatLng.lat, state.lastLatLng.lng, NEARBY_RADIUS_M, state.activeSpecies);
    const agg = RadarChampignon.aggregateObservations(nearby)[state.activeSpecies];

    let html = `<div class="obs-heading">
        <h3>Retour de terrain — ${spName}</h3>
        <button class="obs-add-btn ${state.obsFormOpen?'secondary':''}" id="obs-toggle-btn">
          ${state.obsFormOpen ? 'Annuler' : '+ Observation'}
        </button>
      </div>`;

    if(state.obsFormOpen){
      html += `
        <div class="obs-form">
          <div class="obs-result-toggle">
            <button data-r="found" class="${obsDraft.result==='found'?'active':''}" id="obs-r-found">🍄 Trouvé</button>
            <button data-r="rien" class="${obsDraft.result==='rien'?'active':''}" id="obs-r-rien">Rien trouvé</button>
          </div>
          ${obsDraft.result==='found' ? `
          <div class="obs-form-row">
            <label>Quantité (approx.)</label>
            <input type="number" min="0" id="obs-qty" value="${obsDraft.quantity}" placeholder="ex. 4">
          </div>` : ''}
          <div class="obs-form-row">
            <label>Fiabilité</label>
            <select id="obs-confidence">
              <option value="certain" ${obsDraft.confidence==='certain'?'selected':''}>Certaine (identification sûre)</option>
              <option value="probable" ${obsDraft.confidence==='probable'?'selected':''}>Probable</option>
              <option value="incertaine" ${obsDraft.confidence==='incertaine'?'selected':''}>Incertaine</option>
            </select>
          </div>
          <div class="obs-form-row">
            <label>Note (optionnel)</label>
            <textarea id="obs-note" rows="2" placeholder="ex. sous les chênes, versant nord…">${obsDraft.note}</textarea>
          </div>
          <div class="obs-form-actions">
            <button class="obs-cancel-btn" id="obs-cancel-btn">Annuler</button>
            <button class="obs-save-btn" id="obs-save-btn">Enregistrer</button>
          </div>
        </div>`;
    }

    if(nearby.length){
      html += `<div class="obs-nearby-summary">
        <span><b>${nearby.length}</b> observation${nearby.length>1?'s':''} à ${NEARBY_RADIUS_M} m</span>
        <span><b>${Math.round((agg?.foundRate||0)*100)}%</b> de réussite</span>
      </div>`;
      html += `<div class="obs-nearby-list">` + nearby.map(o => `
        <div class="obs-item">
          <div class="obs-dot" style="background:${o.result==='found' ? '#8fae5b' : '#7a4b32'}"></div>
          <div class="obs-body">
            <div class="obs-line1">${o.result==='found' ? ('Trouvé' + (o.quantity?` ×${o.quantity}`:'')) : 'Rien trouvé'}</div>
            <div class="obs-line2">${new Date(o.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})} · ${Math.round(distanceMeters(state.lastLatLng.lat,state.lastLatLng.lng,o.lat,o.lng))} m · ${o.confidence}</div>
            ${o.note ? `<div class="obs-note">${escapeHtml(o.note)}</div>` : ''}
          </div>
          <button class="obs-del" data-id="${o.id}" title="Supprimer">✕</button>
        </div>
      `).join('') + `</div>`;
    } else if(!state.obsFormOpen){
      html += `<div class="obs-empty">Aucune observation enregistrée à moins de ${NEARBY_RADIUS_M} m pour cette espèce. Les observations restent séparées du score prédit — elles ne le modifient jamais automatiquement.</div>`;
    }

    obsSection.innerHTML = html;
    wireObsSection();
  }

  function wireObsSection(){
    const toggleBtn = document.getElementById('obs-toggle-btn');
    if(toggleBtn) toggleBtn.addEventListener('click', () => {
      state.obsFormOpen = !state.obsFormOpen;
      renderObsSection();
    });
    const rFound = document.getElementById('obs-r-found');
    const rRien = document.getElementById('obs-r-rien');
    if(rFound) rFound.addEventListener('click', () => { obsDraft.result='found'; renderObsSection(); });
    if(rRien) rRien.addEventListener('click', () => { obsDraft.result='rien'; renderObsSection(); });
    const qty = document.getElementById('obs-qty');
    if(qty) qty.addEventListener('input', e => obsDraft.quantity = e.target.value);
    const conf = document.getElementById('obs-confidence');
    if(conf) conf.addEventListener('change', e => obsDraft.confidence = e.target.value);
    const note = document.getElementById('obs-note');
    if(note) note.addEventListener('input', e => obsDraft.note = e.target.value);
    const cancelBtn = document.getElementById('obs-cancel-btn');
    if(cancelBtn) cancelBtn.addEventListener('click', () => { state.obsFormOpen=false; obsDraft={result:'found',quantity:'',confidence:'certain',note:''}; renderObsSection(); });
    const saveBtn = document.getElementById('obs-save-btn');
    if(saveBtn) saveBtn.addEventListener('click', () => {
      addObservation({
        id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
        species: state.activeSpecies,
        result: obsDraft.result,
        quantity: obsDraft.result==='found' ? Number(obsDraft.quantity||0) : 0,
        confidence: obsDraft.confidence,
        note: obsDraft.note.trim(),
        lat: state.lastLatLng.lat,
        lng: state.lastLatLng.lng,
        date: new Date().toISOString()
      });
      state.obsFormOpen = false;
      obsDraft = { result:'found', quantity:'', confidence:'certain', note:'' };
      refreshObsMarkers();
      renderSpeciesRow(Object.keys(state.results).sort((a,b)=>{
        const sa=state.results[a].score, sb=state.results[b].score;
        if(sa==null) return 1; if(sb==null) return -1; return sb-sa;
      }));
      renderObsSection();
      showToast('Observation enregistrée');
    });
    obsSection.querySelectorAll('.obs-del').forEach(btn => {
      btn.addEventListener('click', () => deleteObservation(btn.dataset.id));
    });
  }

  // ---------- Panneau historique complet ----------
  const historyPanel = document.getElementById('history-panel');
  document.getElementById('history-btn').addEventListener('click', () => {
    renderHistoryPanel();
    historyPanel.classList.add('open');
  });
  document.getElementById('history-close').addEventListener('click', () => historyPanel.classList.remove('open'));

  function renderHistoryPanel(){
    const all = loadObservations().sort((a,b)=> new Date(b.date)-new Date(a.date));
    const summaryEl = document.getElementById('history-summary');
    const listEl = document.getElementById('history-list');

    const bySpecies = RadarChampignon.aggregateObservations(all);
    summaryEl.innerHTML = Object.keys(bySpecies).length
      ? Object.entries(bySpecies).map(([id,g]) =>
          `<span class="hs-pill">${speciesNameById(id)} · ${g.n} · ${Math.round(g.foundRate*100)}%</span>`
        ).join('')
      : '';

    if(!all.length){
      listEl.innerHTML = `<div class="obs-empty">Aucune observation enregistrée pour l'instant. Touche un point sur la carte, choisis une espèce, puis « + Observation ».</div>`;
      return;
    }
    listEl.innerHTML = all.map(o => `
      <div class="obs-item">
        <div class="obs-dot" style="background:${o.result==='found' ? '#8fae5b' : '#7a4b32'}"></div>
        <div class="obs-body">
          <div class="obs-line1">${speciesNameById(o.species)} — ${o.result==='found' ? ('trouvé'+(o.quantity?` ×${o.quantity}`:'')) : 'rien trouvé'}</div>
          <div class="obs-line2">${new Date(o.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})} · ${o.lat.toFixed(4)}, ${o.lng.toFixed(4)} · ${o.confidence}</div>
          ${o.note ? `<div class="obs-note">${escapeHtml(o.note)}</div>` : ''}
        </div>
        <button class="obs-del" data-id="${o.id}" title="Supprimer">✕</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.obs-del').forEach(btn => {
      btn.addEventListener('click', () => deleteObservation(btn.dataset.id));
    });
  }

  document.getElementById('history-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(loadObservations(), null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'observations-radar-champignon.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('history-import-file').addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const imported = JSON.parse(reader.result);
        if(!Array.isArray(imported)) throw new Error('format invalide');
        const existing = loadObservations();
        const ids = new Set(existing.map(o=>o.id));
        const merged = existing.concat(imported.filter(o => o && o.id && !ids.has(o.id)));
        saveObservations(merged);
        refreshObsMarkers();
        renderHistoryPanel();
        renderObsSection();
        showToast('Import réussi');
      }catch(err){ showToast('Fichier invalide'); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('history-clear').addEventListener('click', () => {
    if(!loadObservations().length) return;
    if(confirm('Supprimer définitivement toutes les observations enregistrées sur cet appareil ?')){
      saveObservations([]);
      refreshObsMarkers();
      renderHistoryPanel();
      renderObsSection();
      showToast('Historique effacé');
    }
  });

  // ---------- Scan des meilleurs secteurs (forêts réelles OpenStreetMap) ----------
  const scanPanel = document.getElementById('scan-panel');
  const scanStatus = document.getElementById('scan-status');
  const scanList = document.getElementById('scan-list');
  const scanLayer = L.layerGroup().addTo(map);
  const targetIcon = L.divIcon({ className:'', html:'<div class="target-marker"></div>', iconSize:[20,20], iconAnchor:[10,10] });
  const SCAN_RADIUS_M = 2500;
  const SCAN_MAX_SECTORS = 10;

  document.getElementById('scan-close').addEventListener('click', () => scanPanel.classList.remove('open'));

  document.getElementById('scan-btn').addEventListener('click', () => {
    if(!navigator.geolocation){ showToast('Géolocalisation indisponible'); return; }
    scanPanel.classList.add('open');
    scanList.innerHTML = '';
    scanStatus.textContent = 'Localisation…';
    navigator.geolocation.getCurrentPosition(
      (pos) => runSectorScan({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { scanStatus.textContent = 'Position indisponible — vérifie les autorisations de localisation.'; },
      { enableHighAccuracy:true, timeout:10000 }
    );
  });

  async function fetchForestPatches(lat, lng, radius){
    const q = `[out:json][timeout:25];(
      way["natural"="wood"](around:${radius},${lat},${lng});
      way["landuse"="forest"](around:${radius},${lat},${lng});
      relation["natural"="wood"](around:${radius},${lat},${lng});
      relation["landuse"="forest"](around:${radius},${lat},${lng});
    );out center tags;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method:'POST', body:'data=' + encodeURIComponent(q)
    });
    if(!res.ok) throw new Error('overpass http ' + res.status);
    const data = await res.json();
    const seen = new Set();
    const patches = [];
    for(const el of (data.elements||[])){
      const c = el.center || (el.lat!=null ? {lat:el.lat, lon:el.lon} : null);
      if(!c) continue;
      const key = c.lat.toFixed(4)+','+c.lon.toFixed(4);
      if(seen.has(key)) continue;
      seen.add(key);
      const tags = el.tags || {};
      patches.push({
        lat:c.lat, lng:c.lon,
        name: tags.name || null,
        leafType: tags.leaf_type || tags.wood || null,
        species: tags['species:fr'] || tags.genus || null
      });
    }
    return patches;
  }

  function leafTypeToForest(leafType){
    const t = (leafType||'').toLowerCase();
    if(t.includes('broadleav') || t.includes('feuillus')) return { essence:'feuillus', formation:'feuillus' };
    if(t.includes('conif') || t.includes('needle')) return { essence:'coniferes', formation:'coniferes' };
    if(t.includes('mixed') || t.includes('mixte')) return { essence:'feuillus coniferes', formation:'mixte' };
    return { essence:'', formation:'' };
  }

  async function runSectorScan(userLl){
    try{
      scanStatus.textContent = 'Recherche des zones boisées à proximité (OpenStreetMap)…';
      let patches = await fetchForestPatches(userLl.lat, userLl.lng, SCAN_RADIUS_M);
      if(!patches.length){
        scanStatus.textContent = `Aucune zone boisée référencée sur OpenStreetMap dans un rayon de ${(SCAN_RADIUS_M/1000).toFixed(1)} km. Essaie depuis un point plus proche d'une forêt, ou touche directement la carte pour analyser un point précis.`;
        scanLayer.clearLayers();
        return;
      }
      patches = patches
        .map(p => ({...p, dist: distanceMeters(userLl.lat, userLl.lng, p.lat, p.lng)}))
        .sort((a,b) => a.dist - b.dist)
        .slice(0, SCAN_MAX_SECTORS);

      scanStatus.textContent = 'Météo du secteur…';
      let weather = null;
      try{ weather = await fetchWeather(userLl.lat, userLl.lng); }
      catch(e){ /* on continue sans météo, confiance réduite automatiquement par le moteur */ }

      scanStatus.textContent = 'Analyse écologique de chaque zone…';
      const scored = patches.map(p => {
        const { essence, formation } = leafTypeToForest(p.leafType);
        const forest = { essence: (p.species ? p.species+' ' : '') + essence, formation };
        const perSpecies = {};
        for(const id of Object.keys(RadarChampignon.SPECIES)){
          try{
            perSpecies[id] = RadarChampignon.scoreSector({
              species:id, date:new Date(), forest, soil:{}, weather: weather||{},
              dataQuality: weather ? 0.85 : 0.55 // habitat approximatif (OSM), sol inconnu
            });
          }catch(e){}
        }
        const ranked = Object.entries(perSpecies)
          .filter(([,r]) => r.score!=null)
          .sort((a,b) => b[1].score - a[1].score);
        return { ...p, perSpecies, ranked, best: ranked[0] ? ranked[0][1] : null, bestId: ranked[0] ? ranked[0][0] : null };
      })
      .filter(s => s.best)
      .sort((a,b) => b.best.score - a.best.score);

      scanStatus.textContent = scored.length
        ? `${scored.length} secteur${scored.length>1?'s':''} boisé${scored.length>1?'s':''} trouvé${scored.length>1?'s':''} — classés par meilleur score.`
        : `Zones boisées trouvées mais scores indisponibles (météo indisponible et habitat insuffisant).`;

      renderScanList(scored);
      renderScanMarkers(scored);
    }catch(err){
      scanStatus.textContent = 'Le service de données OpenStreetMap (Overpass) est indisponible pour le moment — réessaie dans une minute, ou touche directement la carte pour analyser un point précis.';
      scanLayer.clearLayers();
    }
  }

  function renderScanMarkers(scored){
    scanLayer.clearLayers();
    scored.forEach((s, i) => {
      const m = L.marker([s.lat, s.lng], { icon: targetIcon }).addTo(scanLayer);
      m.bindTooltip(`#${i+1} · ${s.best.species} ${s.best.score}`, { direction:'top', offset:[0,-10] });
      m.on('click', () => {
        scanPanel.classList.remove('open');
        map.setView([s.lat, s.lng], 15);
        selectSector({ lat:s.lat, lng:s.lng });
      });
    });
  }

  function renderScanList(scored){
    if(!scored.length){ scanList.innerHTML = ''; return; }
    scanList.innerHTML = scored.map((s, i) => {
      const color = DECISION_COLORS[s.best.decision] || '#5a5248';
      const topThree = s.ranked.slice(0,3)
        .map(([,r]) => `<span class="sector-species-pill">${r.species} · ${r.score}</span>`).join('');
      return `
        <div class="sector-card">
          <div class="sector-card-top">
            <div>
              <div class="sector-rank">Secteur #${i+1} · ${Math.round(s.dist)} m</div>
              <div class="sector-name">${s.name || 'Zone boisée'}</div>
              <div class="sector-meta">${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</div>
            </div>
            <div class="sector-score-badge" style="background:${color}22;color:${color};border:1px solid ${color}55;">
              <div class="num">${s.best.score}</div>
              <div class="lbl">${s.best.species}</div>
            </div>
          </div>
          <div class="sector-species-list">${topThree}</div>
          <div class="sector-actions">
            <button class="sector-view-btn" data-lat="${s.lat}" data-lng="${s.lng}">Voir l'analyse complète</button>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking" target="_blank" rel="noopener" class="nav-link-btn">📍 Maps</a>
            <a href="https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes" target="_blank" rel="noopener" class="nav-link-btn">🚗 Waze</a>
          </div>
        </div>`;
    }).join('');
    scanList.querySelectorAll('.sector-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = Number(btn.dataset.lat), lng = Number(btn.dataset.lng);
        scanPanel.classList.remove('open');
        map.setView([lat, lng], 15);
        selectSector({ lat, lng });
      });
    });
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
