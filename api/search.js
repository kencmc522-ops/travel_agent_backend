
// V4.14 - Fix Failed to fetch + Fix 3 items
const CACHE = globalThis.__TB_V4_15_CACHE__ || (globalThis.__TB_V4_15_CACHE__ = new Map());

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  const region = (req.query.region || '釜山').toString().trim();
  const type = (req.query.type || 'all').toString();
  const platforms = (req.query.platforms || 'google,instagram,threads,xiaohongshu').toString();
  const budget = parseInt(req.query.budget || '10000');
  const famousOnly = (req.query.famousOnly||'false').toString() !== 'true' ? false : true;
  const minReviews = parseInt(req.query.minReviews||'20');
  let weights = {};
  try{ weights = JSON.parse(req.query.weights || '{}'); }catch(e){ weights={}; }
  if(Object.keys(weights).length===0){ weights = {google:25, instagram:20, threads:15, xiaohongshu:20, dazhong:10, tiktok:5, tabelog:5}; }
  try{
    const data=await doFetch(region,type,platforms,budget,weights,famousOnly,minReviews);
    return res.status(200).json({...data, _cache:'MISS', _ver:'V4.15 4+4+7動態'});
  }catch(e){
    console.error('V4.15 error', e);
    return res.status(500).json({error:e.message, stack:e.stack, note:'Check Vercel Logs'});
  }
}

async function doFetch(region,type,platforms,budget,weights,famousOnly,minReviews){

  const COUNTRY_TO_LOCAL = {
    'KR':'ko','JP':'ja','TH':'th','TW':'zh-TW','HK':'zh-TW','CN':'zh-CN',
    'VN':'vi','MY':'ms','SG':'en','ID':'id','PH':'en','KH':'km','LA':'lo','MM':'my',
    'FR':'fr','DE':'de','IT':'it','ES':'es','GB':'en','US':'en','AU':'en','NZ':'en','CA':'en',
    'PT':'pt','NL':'nl','BE':'fr','CH':'de','AT':'de','GR':'el','TR':'tr','RU':'ru',
    'IN':'en','AE':'ar','SA':'ar','EG':'ar','MA':'ar','BR':'pt','MX':'es','AR':'es'
  };
  function getLocalLang(countryCode, region){
    if(!countryCode) return 'ko';
    return COUNTRY_TO_LOCAL[countryCode] || 'en';
  }

  const KEY=(process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
  if(!KEY) throw new Error('Missing GOOGLE_MAPS_API_KEY - 請去Vercel Settings加入');
  const CSE_ID = (process.env.GOOGLE_CSE_ID || process.env.CSE_ID || "f55d56371ad6b4791").trim();
  const CSE_KEY = (process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_MAPS_API_KEY || "").trim();

  let lat=35.1731,lng=129.0714,formatted=region;
  try{
    const geoUrl=`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&language=zh-TW&key=${KEY}`;
    let geo=await fetch(geoUrl).then(r=>r.json());
    let countryCode='';
    if(geo.status==='OK' && geo.results[0]){ lat=geo.results[0].geometry.location.lat; lng=geo.results[0].geometry.location.lng; formatted=geo.results[0].formatted_address; const comps=geo.results[0].address_components||[]; const countryComp=comps.find(c=>c.types.includes('country')); countryCode=countryComp?.short_name||''; }
  }catch(e){}

  async function fetchFamous(placeType){
    let all=[];
    const queries = placeType==='tourist_attraction' ? [`${region} 著名景點`,`${region} 人氣景點`,`${region} 旅遊景點`] : [`${region} 著名餐廳`,`${region} 人氣美食`,`${region} 美食`];
    for(const q of queries){
      try{
        const url=`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&language=zh-TW&key=${KEY}`;
        let r=await fetch(url).then(x=>x.json());
        if(r.status==='OK') all.push(...(r.results||[]));
      }catch(e){}
    }
    if(all.length<10){
      try{
        const url=`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20000&type=${placeType}&rankby=prominence&language=zh-TW&key=${KEY}`;
        let r=await fetch(url).then(x=>x.json());
        if(r.status==='OK') all.push(...(r.results||[]));
      }catch(e){}
    }
    const seen=new Set(); return all.filter(p=>{ if(seen.has(p.place_id)) return false; seen.add(p.place_id); return true; });
  }

  let attractionRaw=[], restaurantRaw=[];
  if(type==='all' || type==='attraction') attractionRaw=await fetchFamous('tourist_attraction');
  if(type==='all' || type==='restaurant') restaurantRaw=await fetchFamous('restaurant');

  function filterFamous(arr){ return arr.filter(p=>{ const rt=p.user_ratings_total||0; const rating=p.rating||0; const blacklist=['碼頭','埠頭','停車場','管理處','부두','주차장','센터']; if(blacklist.some(b=>(p.name||'').includes(b))) return false; return rt>=20 && rating>=3.8; }).sort((a,b)=> (b.user_ratings_total||0)-(a.user_ratings_total||0)).slice(0,20); }

  if(famousOnly){ attractionRaw=filterFamous(attractionRaw); restaurantRaw=filterFamous(restaurantRaw); } else { attractionRaw=attractionRaw.filter(p=> (p.user_ratings_total||0)>=minReviews).slice(0,20); restaurantRaw=restaurantRaw.filter(p=> (p.user_ratings_total||0)>=minReviews).slice(0,20); }

  async function getSocialMentions(placeName){
    if(!CSE_ID || !CSE_KEY) return {ig: 25, xhs: 18, threads: 6, dazhong: 8, tiktok: 7, tabelog: 4, isReal:false, note:'未設定CSE_ID/KEY 用估算'};
    async function cseSearch(q){ try{ const url = `https://www.googleapis.com/customsearch/v1?key=${CSE_KEY}&cx=${CSE_ID}&q=${encodeURIComponent(q)}&num=1`; const r = await fetch(url).then(x=>x.json()); if(r.error){ console.log('CSE error', r.error.message); return 0; } const totalStr = r.searchInformation?.totalResults || "0"; return parseInt(totalStr,10) || 0; }catch(e){ return 0; } }
    try{
      const q1 = `${placeName} ${region} site:instagram.com`;
      const q2 = `${placeName} ${region} site:xiaohongshu.com`;
      const [igTotal, xhsTotal] = await Promise.all([cseSearch(q1), cseSearch(q2)]);
      const base = Math.max(igTotal, xhsTotal, 20);
      return { ig: igTotal, xhs: xhsTotal, threads: Math.floor(base*0.15), dazhong: Math.floor(base*0.25), tiktok: Math.floor(base*0.2), tabelog: Math.floor(base*0.1), isReal: igTotal>0 || xhsTotal>0, note: (igTotal>0||xhsTotal>0) ? `真搜免費 IG:${igTotal} XHS:${xhsTotal}` : 'CSE回0' };
    }catch(e){ return {ig: 20, xhs: 15, threads: 5, dazhong: 8, tiktok: 6, tabelog: 3, isReal:false, note:'CSE失敗'}; }
  }

  function calcScores(place, details, platformList, budget, kind, social){
    const rt = details.user_ratings_total||place.user_ratings_total||0;
    const rating = details.rating||place.rating||4.3;
    const reviews = details.reviews||[];
    const hasPos = reviews.filter(r=>r.rating>=4).length;
    const hasNeg = reviews.filter(r=>r.rating<=2).length;
    let viral = Math.min(10, (Math.log10(rt+1)*2 + rating));
    let crossScoreWeighted=0, crossCount=0; let detailParts=[];
    const isRestaurant = kind==='restaurant';
    const isJapan = ['東京','大阪','京都','福岡','北海道','沖繩','名古屋','札幌'].some(k=>region.includes(k));
    if(platformList.includes('instagram')){ const w=(weights.instagram||20)/100; const s=Math.min(1.5, (social.ig||0)/40+0.5); crossScoreWeighted+=w*s; crossCount+=w*s; detailParts.push(`IG${Math.round(w*100)}% ${social.ig}${social.isReal?'✓':''}`); }
    if(platformList.includes('xiaohongshu')){ const w=(weights.xiaohongshu||20)/100; const s=Math.min(1.5, (social.xhs||0)/40+0.5); crossScoreWeighted+=w*s; crossCount+=w*s; detailParts.push(`小紅書${Math.round(w*100)}% ${social.xhs}${social.isReal?'✓':''}`); }
    if(platformList.includes('threads')){ const w=(weights.threads||15)/100; crossScoreWeighted+=w*0.8; crossCount+=w*0.8; detailParts.push(`Threads${Math.round(w*100)}%`); }
    if(platformList.includes('google')){ const w=(weights.google||25)/100; crossScoreWeighted+=w*1; crossCount+=w*1; detailParts.push(`Google${Math.round(w*100)}%`); }
    const crossRaw = Math.min(10, crossScoreWeighted*6 + crossCount*1.5 + 2);
    const cross = parseFloat(crossRaw.toFixed(1));
    let real=5; if(hasPos>=1 && hasNeg>=1) real=9; else if(hasPos>=1) real=6;
    const dist=7.5; const final=parseFloat((viral*0.4 + cross*0.25 + real*0.2 + dist*0.15).toFixed(1));
    return {viral:{score:viral}, cross:{score:cross, detail:detailParts.join(' ') + (social.isReal?' [真搜]':' [估算]')}, real:{score:real}, dist:{score:dist}, final, social, tag:famousOnly?'著名':'全部'};
  }


  async function enrich(places, kind, countryCode){
    const localLang = getLocalLang(countryCode, region);
    // 4+4+7 logic: zh-TW 4 + en 4 + local 7 (dynamic)
    // Google Details max 5 per call, so local 7 needs 2 calls with different sort
    async function fetchReviewsForLang(lang, extraCalls){
      let results=[];
      try{
        const url=`https://maps.googleapis.com/maps/api/place/details/json?place_id=PLACEHOLDER&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=${lang}&key=${KEY}`;
        // This inner will be replaced per place
        return [];
      }catch(e){return []}
    }

    const enriched = await Promise.all(places.map(async (p)=>{
      let d={}; 
      let zhReviews=[], enReviews=[], localReviews=[];
      let photos=null, url='', geometry=null;
      try{
        // zh-TW 1 call
        const zhUrl=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=zh-TW&key=${KEY}`;
        const zhDet=await fetch(zhUrl).then(r=>r.json()).then(j=>j.result||{});
        zhReviews = (zhDet.reviews||[]).slice(0,4);
        d = zhDet;
        photos = zhDet.photos||null; url = zhDet.url||''; geometry = zhDet.geometry||null;

        // en 1 call
        const enUrl=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=en&key=${KEY}`;
        const enDet=await fetch(enUrl).then(r=>r.json()).then(j=>j.result||{});
        enReviews = (enDet.reviews||[]).slice(0,4);
        if(!photos) photos = enDet.photos||photos;
        if(!url) url = enDet.url||url;
        if(!geometry) geometry = enDet.geometry||geometry;

        // local 7 - need 2 calls to try get 7 (most_relevant + newest)
        let localAll=[];
        const localUrl1=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=${localLang}&key=${KEY}`;
        const localDet1=await fetch(localUrl1).then(r=>r.json()).then(j=>j.result||{});
        localAll.push(...(localDet1.reviews||[]));
        if(!photos) photos = localDet1.photos||photos;
        if(!url) url = localDet1.url||url;
        if(!geometry) geometry = localDet1.geometry||geometry;

        // second call for local to try get different reviews (Google may return same 5, but we try)
        try{
          const localUrl2=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=${localLang}&key=${KEY}&reviews_sort=newest`;
          const localDet2=await fetch(localUrl2).then(r=>r.json()).then(j=>j.result||{});
          localAll.push(...(localDet2.reviews||[]));
        }catch(e){}

        // dedup localAll by author+text and take 7
        const seenLocal=new Set(); let localDedup=[];
        for(const r of localAll){ const k=(r.author_name||'')+(r.text||'').slice(0,20); if(!seenLocal.has(k)){ seenLocal.add(k); localDedup.push(r);} if(localDedup.length>=7) break; }
        localReviews = localDedup.slice(0,7);

      }catch(e){ console.error('details error', p.place_id, e); }

      // Combine with priority: zh-TW 4 + en 4 + local 7, but dedup by author prefer zh-TW
      const authorMap=new Map();
      // Insert in priority order zh-TW highest
      for(const r of zhReviews){ const k=r.author_name||'anon'; if(!authorMap.has(k)) authorMap.set(k,{...r, _lang:'zh-TW'}); }
      for(const r of enReviews){ const k=r.author_name||'anon'; if(!authorMap.has(k)) authorMap.set(k,{...r, _lang:'en'}); }
      for(const r of localReviews){ const k=r.author_name||'anon'; if(!authorMap.has(k)) authorMap.set(k,{...r, _lang:localLang}); }

      let allReviews = Array.from(authorMap.values());
      // If still less than 15, fill with remaining local
      if(allReviews.length<15){
        for(const r of [...zhReviews, ...enReviews, ...localReviews]){
          const k=r.author_name||'anon';
          if(allReviews.length>=15) break;
          if(!authorMap.has(k)) { allReviews.push(r); authorMap.set(k,true); }
        }
      }

      const social = await getSocialMentions(p.name);
      const scores = calcScores(p, {...d, reviews: allReviews}, platforms.split(','), budget, kind, social);
      const allSortedDesc = [...allReviews].sort((a,b)=>b.rating-a.rating);
      const allSortedAsc = [...allReviews].sort((a,b)=>a.rating-b.rating);
      let pos = allSortedDesc.filter(r=>r.rating>=4).slice(0,3);
      let negReal = allReviews.filter(r=>r.rating<=2);
      let neuRaw = allReviews.filter(r=>r.rating===3);
      let negCombined = [...negReal, ...neuRaw, ...allSortedAsc.filter(r=>r.rating>=4)];
      const seenNeg=new Set(); let neg=[]; for(const r of negCombined){ const k=(r.author_name||'')+(r.text||'').slice(0,15); if(!seenNeg.has(k)){ seenNeg.add(k); neg.push(r);} if(neg.length>=3) break; }
      const negMeta = {hasRealNeg: negReal.length, hasNeu: neuRaw.length, totalReviews: allReviews.length, localLang, countryCode, formula: `zh-TW 4 + en 4 + ${localLang} 7 (動態) 去重優先zh-TW`, note: `當地語言 ${localLang} ${localReviews.length}條 | 總基數 ${allReviews.length}`};
      const posFinal = pos.map(r=>({text:(r.text||'推薦').slice(0,120), author:r.author_name||'匿名', rating:r.rating, source:`Google真評論 [${r._lang||'zh-TW'}]`, isReal:true, url: url||''}));
      const negFinal = neg.map(r=>({text:(r.text||'有待改善').slice(0,120), author:r.author_name||'匿名', rating:r.rating, source: r.rating===3?`中性3★算入反面 [${r._lang||localLang}]`: r.rating>=4?`最低分正評★${r.rating}轉入反面 [${r._lang||localLang}]`:`Google真負評 [${r._lang||localLang}]`, isReal:true, url: url||''}));
      return {id: `gmaps_${p.place_id}_${kind}`, name: p.name, rating: d.rating||p.rating||4.3, ratings_total: d.user_ratings_total||p.user_ratings_total||0, formatted_address: d.formatted_address||p.formatted_address||'', image: photos && photos[0] ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${photos[0].photo_reference}&key=${KEY}` : `https://picsum.photos/seed/${p.place_id}/600/400`, reviews:{positive: posFinal, negative: negFinal, negMeta, social, allReviewsMeta: {zh: zhReviews.length, en: enReviews.length, local: localReviews.length, localLang}}, scores, geometry: geometry||p.geometry, url: url||''};
    })); return enriched;
  }


  const attractions = await enrich(attractionRaw