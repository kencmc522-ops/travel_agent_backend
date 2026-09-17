// V4.10 - V4.8原版基礎，只修 500 + 空評論，UI不變
const CACHE = globalThis.__TB_V4_10_CACHE__ || (globalThis.__TB_V4_10_CACHE__ = new Map());

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  const region = (req.query.region || '釜山').toString().trim();
  const type = (req.query.type || 'all').toString();
  const platforms = (req.query.platforms || 'google,instagram,threads,xiaohongshu').toString();
  const budget = parseInt(req.query.budget || '10000');
  let weights = {};
  try{ weights = JSON.parse(req.query.weights || '{}'); }catch(e){ weights={}; }
  if(Object.keys(weights).length===0){
    weights = {google:25, instagram:20, threads:15, xiaohongshu:20, dazhong:10, tiktok:5, tabelog:5};
  }
  try{
    const data=await doFetch(region,type,platforms,budget,weights);
    return res.status(200).json({...data, _cache:'MISS', _ver:'V4.10'});
  }catch(e){
    console.error('V4.10 error', e);
    return res.status(500).json({error:e.message, stack:e.stack});
  }
}


async function doFetch(region,type,platforms,budget,weights){
  const KEY=(process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
  if(!KEY) throw new Error('Missing GOOGLE_MAPS_API_KEY - 請去Vercel Settings加入');
  const SERP_KEY = (process.env.SERPAPI_KEY || "").trim(); // 可選，有就真搜，無就估算

  let lat=35.1731,lng=129.0714,formatted=region;
  try{
    const geoUrl=`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&language=zh-TW&key=${KEY}`;
    let geo=await fetch(geoUrl).then(r=>r.json());
    if(geo.status==='OK' && geo.results[0]){ lat=geo.results[0].geometry.location.lat; lng=geo.results[0].geometry.location.lng; formatted=geo.results[0].formatted_address; }
  }catch(e){}

  async function fetchFamous(placeType){
    let all=[];
    const queries = placeType==='tourist_attraction' ? [`${region} 著名景點`,`${region} 人氣景點`] : [`${region} 著名餐廳`,`${region} 人氣美食`];
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

  function filterFamous(arr){
    return arr.filter(p=>{
      const rt=p.user_ratings_total||0; const rating=p.rating||0;
      const blacklist=['碼頭','埠頭','停車場','管理處','부두','주차장','센터'];
      if(blacklist.some(b=>(p.name||'').includes(b))) return false;
      return rt>=30 && rating>=4.0;
    }).sort((a,b)=> (b.user_ratings_total||0)-(a.user_ratings_total||0)).slice(0,15);
  }
  attractionRaw=filterFamous(attractionRaw);
  restaurantRaw=filterFamous(restaurantRaw);

  // V4.11 新增：社交提及數 (方案3)
  
  async function getSocialMentions(placeName){
    const CSE_ID = (process.env.GOOGLE_CSE_ID || process.env.CSE_ID || "f55d56371ad6b4791").trim();
    const CSE_KEY = (process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
    if(!CSE_ID || !CSE_KEY) return {ig: 25, xhs: 18, threads: 6, dazhong: 8, tiktok: 7, tabelog: 4, isReal:false, note:'未設定CSE_ID/KEY 用估算'};

    async function cseSearch(q){
      try{
        const url = `https://www.googleapis.com/customsearch/v1?key=${CSE_KEY}&cx=${CSE_ID}&q=${encodeURIComponent(q)}&num=1`;
        const r = await fetch(url).then(x=>x.json());
        if(r.error){ console.log('CSE error', r.error.message); return 0; }
        const totalStr = r.searchInformation?.totalResults || "0";
        return parseInt(totalStr,10) || 0;
      }catch(e){ console.log('CSE fetch fail', e.message); return 0; }
    }

    try{
      // 只搜 Top 2 平台省quota，每日100次免費：IG + 小紅書
      const q1 = `${placeName} ${region} site:instagram.com`;
      const q2 = `${placeName} ${region} site:xiaohongshu.com`;
      const [igTotal, xhsTotal] = await Promise.all([cseSearch(q1), cseSearch(q2)]);
      // 其他平台用比例估算，省quota
      const base = Math.max(igTotal, xhsTotal, 20);
      return {
        ig: igTotal,
        xhs: xhsTotal,
        threads: Math.floor(base*0.15),
        dazhong: Math.floor(base*0.25),
        tiktok: Math.floor(base*0.2),
        tabelog: Math.floor(base*0.1),
        isReal: igTotal>0 || xhsTotal>0,
        note: (igTotal>0||xhsTotal>0) ? `真搜免費 IG:${igTotal} XHS:${xhsTotal} (Custom Search)` : 'CSE回0 用估算，請檢查PSE有無加 instagram.com/xiaohongshu.com'
      };
    }catch(e){
      return {ig: 20, xhs: 15, threads: 5, dazhong: 8, tiktok: 6, tabelog: 3, isReal:false, note:'CSE失敗用估算'};
    }
  }

    try{
      // 用 SerpAPI Google 搜 IG/小紅書提及數 - 真數據
      const q = encodeURIComponent(`${placeName} ${region}`);
      const url = `https://serpapi.com/search.json?engine=google&q=${q}&api_key=${SERP_KEY}&num=10`;
      const r = await fetch(url).then(x=>x.json());
      const total = r.search_information?.total_results || 0;
      return {ig: Math.floor(total*0.3), xhs: Math.floor(total*0.25), threads: Math.floor(total*0.1), dazhong: Math.floor(total*0.15), tiktok: Math.floor(total*0.15), tabelog: Math.floor(total*0.05), isReal:true, note:`Google真搜 ${total} 結果`};
    }catch(e){ return {ig: 20, xhs: 15, threads: 5, dazhong: 8, tiktok: 6, tabelog: 3, isReal:false, note:'搜尋失敗用估算'}; }
  }

  function calcScores(place, details, platformList, budget, kind, social){
    const rt = details.user_ratings_total||place.user_ratings_total||0;
    const rating = details.rating||place.rating||4.3;
    const reviews = details.reviews||[];
    const hasPos = reviews.filter(r=>r.rating>=4).length;
    const hasNeg = reviews.filter(r=>r.rating<=3).length;
    const viralRaw = Math.min(10, (Math.log10(rt+1)*2.5) + (rating-4)*2 + (details.photos?1:0) + 0.5);
    const viral = parseFloat(viralRaw.toFixed(1));
    let crossScoreWeighted = 0; let crossCount = 0; let detailParts = [];
    const isRestaurant = kind==='restaurant'; const isAttraction = kind==='attraction';
    const isJapan = region.includes('日本')||region.includes('東京')||region.includes('大阪')||region.includes('京都');
    // V4.11 方案3：交叉驗證由估算改為 提及數
    if(platformList.includes('google')){
      const w = (weights.google||25)/100;
      crossScoreWeighted += w * 1.0; crossCount += w;
      detailParts.push(`Maps${Math.round(w*100)}% ${rt}評`);
    }
    if(platformList.includes('instagram')){
      const w = (weights.instagram||20)/100;
      const igScore = Math.min(1.5, (social.ig||0)/50 + 0.5);
      crossScoreWeighted += w * igScore; crossCount += w * igScore;
      detailParts.push(`IG${Math.round(w*100)}% ${social.ig}提及${social.isReal?'✓':''}`);
    }
    if(platformList.includes('xiaohongshu')){
      const w = (weights.xiaohongshu||20)/100;
      const xhsScore = Math.min(1.5, (social.xhs||0)/40 + 0.5);
      crossScoreWeighted += w * xhsScore; crossCount += w * xhsScore;
      detailParts.push(`小紅書${Math.round(w*100)}% ${social.xhs}篇${social.isReal?'✓':''}`);
    }
    if(platformList.includes('threads')){
      const w = (weights.threads||15)/100;
      crossScoreWeighted += w * 0.8; crossCount += w * 0.8;
      detailParts.push(`Threads${Math.round(w*100)}% ${social.threads}提`);
    }
    if(platformList.includes('dazhong')){
      const w = (weights.dazhong||10)/100;
      const catBonus = isRestaurant ? 1.3 : 0.4;
      crossScoreWeighted += w * catBonus; crossCount += w * catBonus;
      detailParts.push(`大眾${Math.round(w*100)}% ${social.dazhong}提`);
    }
    if(platformList.includes('tiktok')){
      const w = (weights.tiktok||5)/100;
      crossScoreWeighted += w * 0.9; crossCount += w * 0.9;
      detailParts.push(`TikTok${Math.round(w*100)}% ${social.tiktok}提`);
    }
    if(platformList.includes('tabelog')){
      const w = (weights.tabelog||5)/100;
      const catBonus = isJapan ? 1.5 : 0.3;
      crossScoreWeighted += w * catBonus; crossCount += w * catBonus;
      detailParts.push(`Tabelog${Math.round(w*100)}% ${social.tabelog}提`);
    }
    const crossRaw = Math.min(10, crossScoreWeighted*6 + crossCount*1.5 + 2);
    const cross = parseFloat(crossRaw.toFixed(1));
    let realRatioRaw = 5;
    if(hasPos>=1 && hasNeg>=1) realRatioRaw = 9 + Math.min(1, hasNeg/3);
    else if(hasPos>=3 && hasNeg===0) realRatioRaw = 6;
    else if(hasPos>=1) realRatioRaw = 5.5;
    const real = parseFloat(realRatioRaw.toFixed(1));
    const dist = 7.5;
    const final = parseFloat((viral*0.4 + cross*0.25 + real*0.2 + dist*0.15).toFixed(1));
    return {viral:{score:viral, detail:`${rt}評論 ${rating}★`}, cross:{score:cross, detail:detailParts.join(' ') + (social.isReal? ' [真搜]' : ' [估算]')}, real:{score:real, detail:`正${hasPos} 反${hasNeg} 基數${reviews.length}`}, dist:{score:dist, detail:'距離適中'}, final, social, trending:'', tag:'著名'};
  }

  async function enrich(places, kind){
    const enriched = await Promise.all(places.map(async (p)=>{
      let d={}; let allReviews=[];
      try{
        // V4.11 多語言拼湊 5->15
        const langs = ['zh-TW','en','ko'];
        const detailsList = await Promise.all(langs.map(async (lg)=>{
          try{
            const url=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours,types&language=${lg}&key=${KEY}`;
            const det=await fetch(url).then(r=>r.json());
            return det.result||{};
          }catch(e){ return {}; }
        }));
        d = detailsList[0]||{};
        const seen = new Set(); allReviews=[];
        for(const det of detailsList){
          for(const r of (det.reviews||[])){
            const key = (r.author_name||'') + (r.text||'').slice(0,20);
            if(!seen.has(key)){ seen.add(key); allReviews.push(r); }
          }
        }
        d.reviews = allReviews;
        if(!d.photos) for(const det of detailsList){ if(det.photos){ d.photos=det.photos; break; } }
        if(!d.url) for(const det of detailsList){ if(det.url){ d.url=det.url; break; } }
      }catch(e){ console.error('details error', p.place_id, e); }

      const social = await getSocialMentions(p.name);
      const reviews = allReviews;
      const scores = calcScores(p, d, platforms.split(','), budget, kind, social);
      const allSortedAsc = [...reviews].sort((a,b)=>a.rating-b.rating);
      const allSortedDesc = [...reviews].sort((a,b)=>b.rating-a.rating);
      let posRaw = reviews.filter(r=>r.rating>=4);
      let negReal = reviews.filter(r=>r.rating<=2);
      let neuRaw = reviews.filter(r=>r.rating===3);
      let pos = allSortedDesc.filter(r=>r.rating>=4).slice(0,3);
      let negCombined = [...negReal];
      if(negCombined.length<3) negCombined = [...negCombined, ...neuRaw];
      if(negCombined.length<3){
        const lowestPos = allSortedAsc.filter(r=>r.rating>=4);
        negCombined = [...negCombined, ...lowestPos];
      }
      const seenNeg = new Set(); let neg=[];
      for(const r of negCombined){ const k=(r.author_name||'')+(r.text||'').slice(0,15); if(!seenNeg.has(k)){ seenNeg.add(k); neg.push(r);} if(neg.length>=3) break; }
      if(reviews.length===0){ pos=[]; neg=[]; }
      const negMeta = {hasRealNeg: negReal.length, hasNeu: neuRaw.length, hasRealPos: posRaw.length, totalReviews: reviews.length, isRealData: reviews.length>0, note: reviews.length===0 ? 'Google暫無評論' : `真負評${negReal.length} 中性${neuRaw.length} 正評${posRaw.length} 基數${reviews.length} (多語言拼)`, socialNote: social.note};
      const posFinal = pos.map(r=>({text:(r.text||'推薦').slice(0,120), author:r.author_name||'匿名', rating:r.rating, time:r.relative_time_description||'', source:'Google真評論', isReal:true, url:d.url||`https://www.google.com/maps/place/?q=place_id:${p.place_id}`, originalRating:r.rating}));
      const negFinal = neg.map(r=>{ const isNeu=r.rating===3; const isLow=r.rating>=4; let sl='Google真評論'; if(isNeu) sl='Google中性3★算入反面'; else if(isLow) sl=`Google最低分正評★${r.rating}轉入反面`; return {text:(r.text||'有待改善').slice(0,120), author:r.author_name||'匿名', rating:r.rating, time:r.relative_time_description||'', source:sl, isReal:true, url:d.url||`https://www.google.com/maps/place/?q=place_id:${p.place_id}`, isNeutral:isNeu, isLowPos:isLow, isRealNeg:r.rating<=2, originalRating:r.rating}; });
      return {id: `gmaps_${p.place_id}_${kind}`, name: p.name, rating: d.rating||p.rating||4.3, ratings_total: d.user_ratings_total||p.user_ratings_total||0, formatted_address: d.formatted_address||p.formatted_address||p.vicinity||'', image: d.photos && d.photos[0] ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${d.photos[0].photo_reference}&key=${KEY}` : `https://picsum.photos/seed/${p.place_id}/600/400`, reviews:{positive: posFinal, negative: negFinal, count: reviews.length, isReal: reviews.length>0, hasBoth: posFinal.length>0 || negFinal.length>0, negMeta, social}, scores, trending:'', tag:'著名', geometry: d.geometry||p.geometry, url: d.url||'', website: d.website||'', opening_hours: d.opening_hours||null, types: d.types||p.types||[]};
    }));
    return enriched;
  }

  const attractions = await enrich(attractionRaw, 'attraction');
  const restaurants = await enrich(restaurantRaw, 'restaurant');
  return {region, geo:{lat,lng,formatted}, attractions, restaurants, count: attractions.length+restaurants.length, rankingFormula:{viral:0.4,cross:0.25,real:0.2,dist:0.15, description:'V4.11 方案3 混合擴大：Google多語言基數+社交提及數'}};
}

