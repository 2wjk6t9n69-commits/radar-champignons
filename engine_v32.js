/* Radar Champignon — Moteur V31
 * Conservative ecological scoring engine.
 * Unknown data reduce confidence; they do not become zero.
 */
const SPECIES = {
  cepe: {
    name:'Cèpe de Bordeaux', scientific:'Boletus edulis', months:[6,11],
    hosts:{chene:1, chataignier:1, hetre:.95, sapin:.8, epicea:.8, pin:.55, feuillus:.65, coniferes:.6},
    ph:[4.5,7.0], soil:'acidic_to_neutral',
    climate:{tempOpt:[10,18], tempTol:[6,24], rainLagDays:26, tempLagDays:20, rain7:[15,90], rain14:[30,150]},
    weights:{habitat:.28, soil:.14, season:.12, climate:.36, trend:.10},
    evidence:'medium'
  },
  girolle: {
    name:'Girolle / Chanterelle', scientific:'Cantharellus cibarius', months:[6,11],
    hosts:{chene:1, chataignier:.95, hetre:.9, bouleau:.8, pin:.8, sapin:.75, epicea:.75, feuillus:.75, coniferes:.7},
    ph:[4.0,5.8], soil:'acidic',
    climate:{tempOpt:[10,21], tempTol:[6,25], rainLagDays:21, tempLagDays:14, rain7:[15,110], rain14:[30,180]},
    weights:{habitat:.30, soil:.16, season:.14, climate:.30, trend:.10},
    evidence:'medium'
  },
  trompette: {
    name:'Trompette de la mort', scientific:'Craterellus cornucopioides', months:[7,12],
    hosts:{hetre:1, chene:.95, chataignier:.8, feuillus:.85, coniferes:.45},
    ph:[4.2,6.5], soil:'acidic',
    climate:{tempOpt:[9,19], tempTol:[5,23], rainLagDays:21, tempLagDays:14, rain7:[20,120], rain14:[40,200]},
    weights:{habitat:.30, soil:.14, season:.16, climate:.30, trend:.10},
    evidence:'low-medium'
  },
  pied: {
    name:'Pied de mouton', scientific:'Hydnum repandum', months:[7,12],
    hosts:{hetre:.95, chene:.9, chataignier:.9, sapin:.8, epicea:.8, pin:.65, feuillus:.8, coniferes:.75},
    ph:[4.8,7.2], soil:'mesotrophic',
    climate:{tempOpt:[8,18], tempTol:[4,23], rainLagDays:21, tempLagDays:14, rain7:[15,100], rain14:[30,180]},
    weights:{habitat:.30, soil:.12, season:.16, climate:.32, trend:.10},
    evidence:'medium'
  },
  morille: {
    name:'Morille', scientific:'Morchella spp.', months:[3,5],
    hosts:{frene:1, orme:1, peuplier:.9, pommier:.8, poirier:.8, noisetier:.65, chene:.5, feuillus:.65},
    ph:[6.3,8.2], soil:'calcareous',
    climate:{tempOpt:[8,16], tempTol:[4,21], rainLagDays:30, tempLagDays:14, rain7:[10,80], rain14:[25,130]},
    weights:{habitat:.28, soil:.24, season:.20, climate:.20, trend:.08},
    evidence:'low-medium'
  },
  oronge: {
    name:'Oronge', scientific:'Amanita caesarea', months:[6,10],
    hosts:{chene:1, chataignier:1, hetre:.55, feuillus:.75},
    ph:[4.8,7.0], soil:'siliceous_well_drained',
    climate:{tempOpt:[18,27], tempTol:[14,31], rainLagDays:21, tempLagDays:14, rain7:[10,80], rain14:[20,130]},
    weights:{habitat:.30, soil:.16, season:.16, climate:.30, trend:.08},
    evidence:'medium'
  }
};

const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const mean=a=>a&&a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function normText(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function monthScore(month,range){const [a,b]=range;if(month>=a&&month<=b)return 100; const before=a===1?12:a-1; const after=b===12?1:b+1; if(month===before||month===after)return 45; return 0;}
function rangeScore(v,opt,tol){
  if(v==null)return {score:null,known:false};
  if(v>=opt[0]&&v<=opt[1])return {score:100,known:true};
  if(v>=tol[0]&&v<=tol[1]){
    const edge=v<opt[0]?opt[0]-v:v-opt[1], span=v<opt[0]?opt[0]-tol[0]:tol[1]-opt[1];
    return {score:clamp(75-(edge/Math.max(span,1))*55),known:true};
  }
  return {score:15,known:true};
}
function avgWindow(arr,n,fromEnd=0){if(!Array.isArray(arr)||!arr.length)return null;const end=arr.length-fromEnd;const a=arr.slice(Math.max(0,end-n),end).filter(v=>Number.isFinite(+v)).map(Number);return mean(a);}
function sumWindow(arr,n,fromEnd=0){if(!Array.isArray(arr)||!arr.length)return null;const end=arr.length-fromEnd;const a=arr.slice(Math.max(0,end-n),end).filter(v=>Number.isFinite(+v)).map(Number);return a.length?a.reduce((s,x)=>s+x,0):null;}
function hostScore(profile, forest){
  const t=normText([forest.essence,forest.formation,forest.species].join(' '));
  if(!t)return {score:null,known:false,label:'non renseigné'};
  let best=0,label='';
  for(const [k,w] of Object.entries(profile.hosts)){if(t.includes(k)&&w>best){best=w;label=k;}}
  if(best>0)return {score:Math.round(55+30*best),known:true,label};
  if(t.includes('feuillus'))return {score:55,known:true,label:'feuillus'};
  if(t.includes('conifer'))return {score:45,known:true,label:'conifères'};
  return {score:25,known:true,label:'essence non prioritaire'};
}
function soilScore(profile, soil){
  if(!soil)return {score:null,known:false,details:{}};
  const known=[];let s=[];
  if(Number.isFinite(+soil.ph)){const ph=+soil.ph;const [a,b]=profile.ph;let q=ph>=a&&ph<=b?100:clamp(100-Math.min(Math.abs(ph-a),Math.abs(ph-b))*35,0,100);s.push(q);known.push('pH');}
  if(Number.isFinite(+soil.moisture)){const m=+soil.moisture;let q=m>=.18&&m<=.42?100:m>=.12&&m<=.5?65:25;s.push(q);known.push('humidité');}
  if(soil.drainage){const d=normText(soil.drainage);let q=100;if(profile.soil==='siliceous_well_drained'&&!d.includes('drain'))q=45;s.push(q);known.push('drainage');}
  if(!s.length)return {score:null,known:false,details:{}};
  return {score:mean(s),known:true,details:{known}};
}
function climateScore(profile, weather){
  if(!weather)return {score:null,known:false,trend:null,details:{}};
  const parts=[];
  const temp=weather.temp20!=null?weather.temp20:avgWindow(weather.temp,profile.climate.tempLagDays,weather.temp?.length>30?10:0);
  const rain=weather.rain26!=null?weather.rain26:sumWindow(weather.rain,profile.climate.rainLagDays,weather.rain?.length>30?10:0);
  const r7=weather.rain7!=null?weather.rain7:sumWindow(weather.rain,7,weather.rain?.length>30?10:0);
  const r14=weather.rain14!=null?weather.rain14:sumWindow(weather.rain,14,weather.rain?.length>30?10:0);
  const soil=weather.soilMoisture!=null?weather.soilMoisture:avgWindow(weather.soil,7,weather.soil?.length>30?10:0);
  if(temp!=null){parts.push(rangeScore(temp,profile.climate.tempOpt,profile.climate.tempTol).score);}
  if(rain!=null){const [a,b]=[profile.climate.rain14[0]*2,profile.climate.rain14[1]*2.2];parts.push(rain>=a&&rain<=b?100:rain<a?clamp(100-(a-rain)*3,15,95):clamp(100-(rain-b)*1.2,20,95));}
  if(r7!=null){const [a,b]=profile.climate.rain7;parts.push(r7>=a&&r7<=b?100:r7<a?clamp(100-(a-r7)*4,10,90):clamp(100-(r7-b)*1.5,20,90));}
  if(soil!=null){parts.push(soil>=.18&&soil<=.42?100:soil>=.12&&soil<=.5?65:20);}
  if(!parts.length)return {score:null,known:false,trend:null,details:{}};
  const futureSoil=weather.futureSoilMoisture;
  const futureRain=weather.futureRain;
  let trend=0;
  if(futureSoil!=null&&soil!=null)trend+=(futureSoil-soil)*200;
  if(futureRain!=null)trend+=(futureRain/5-r7/7)*.6;
  return {score:mean(parts),known:true,trend:clamp(50+trend,0,100),details:{temp,rainLag:rain,rain7:r7,rain14:r14,soil,futureSoil,futureRain}};
}
function scoreSector(input){
  const p=SPECIES[input.species]; if(!p)throw new Error('Unknown species');
  const now=new Date(input.date||Date.now());
  const components={};
  components.habitat=hostScore(p,input.forest||{});
  components.soil=soilScore(p,input.soil||{});
  components.season={score:monthScore(now.getMonth()+1,p.months),known:true};
  components.climate=climateScore(p,input.weather||{});
  components.trend=components.climate.trend==null?{score:null,known:false}:{score:components.climate.trend,known:true};
  const weighted=[];let weightKnown=0,totalWeight=0;
  for(const [k,w] of Object.entries(p.weights)){totalWeight+=w;if(components[k].known){weighted.push(components[k].score*w);weightKnown+=w;}}
  let raw=weightKnown?weighted.reduce((a,b)=>a+b,0)/weightKnown:null;
  // Do not allow missing/poor habitat evidence to be hidden by weather.
  if(raw!=null && components.habitat.known && components.habitat.score<35) raw=Math.min(raw,55);
  if(raw!=null && components.soil.known && components.soil.score<25) raw=Math.min(raw,60);
  const completeness=weightKnown/totalWeight;
  const dataQuality=input.dataQuality==null?1:clamp(input.dataQuality,0,1);
  const criticalPenalty=(components.habitat.known?1:.72)*(components.soil.known?1:.82);
  const confidence=clamp(100*(.55*completeness+.30*dataQuality+.15*(p.evidence==='medium'?1:.7))*criticalPenalty);
  // Penalize missing critical information only through confidence, not score.
  let score=raw==null?null:Math.round(clamp(raw));
  const inSeason=components.season.score>0;
  if(score!=null&&!inSeason)score=Math.min(score,45);
  let decision='insuffisant';
  if(!inSeason) decision='hors saison';
  else if(score!=null&&confidence>=75&&score>=85)decision='prioritaire';
  else if(score!=null&&confidence>=65&&score>=75)decision='très favorable';
  else if(score!=null&&confidence>=55&&score>=65)decision='favorable';
  else if(score!=null&&confidence>=50)decision='à surveiller';
  else if(score!=null)decision='à éviter';
  const reasons=[];
  if(components.season.score===100) reasons.push('saison favorable');
  else if(components.season.score===45) reasons.push('entrée/sortie de saison');
  else reasons.push('hors saison');
  if(components.habitat.known) reasons.push('habitat '+(components.habitat.score>=75?'compatible':components.habitat.score>=50?'partiellement compatible':'peu compatible'));
  if(components.soil.known) reasons.push('sol '+(components.soil.score>=75?'favorable':components.soil.score>=50?'compatible':'défavorable'));
  if(components.climate.known) reasons.push('météo récente intégrée');
  if(components.trend.known) reasons.push(components.trend.score>=60?'tendance favorable':components.trend.score<=40?'tendance défavorable':'tendance stable');
  return {species:p.name,score,confidence:Math.round(confidence),decision,reasons,components,warning:'Le score classe la compatibilité environnementale; il ne garantit pas la présence de champignons.'};
}

// Terrain observations: never directly change coefficients from one observation.
function observationFeatures(o){return {species:o.species,result:o.result,quantity:o.quantity||0,lat:o.lat,lng:o.lng,date:o.date,confidence:o.confidence||'certain',note:o.note||'',conditions:o.conditions||{}};}
function aggregateObservations(observations){
  const groups={};
  for(const o of observations||[]){if(!o.species)continue;const g=groups[o.species]||(groups[o.species]={n:0,found:0,totalQty:0,highConfidence:0});g.n++;if(o.result==='found'||o.result==='trouve')g.found++;g.totalQty+=Number(o.quantity||o.qty||0);if((o.confidence||'')==='certain')g.highConfidence++;}
  for(const g of Object.values(groups)){g.foundRate=g.n?g.found/g.n:0;g.meanQuantity=g.n?g.totalQty/g.n:0;g.confidence=Math.min(100,30+g.n*2+g.highConfidence*1.5);}
  return groups;
}
const RadarChampignon={SPECIES,scoreSector,aggregateObservations,observationFeatures};
if(typeof module!=='undefined'&&module.exports){module.exports=RadarChampignon;}
if(typeof window!=='undefined'){window.RadarChampignon=RadarChampignon;}
