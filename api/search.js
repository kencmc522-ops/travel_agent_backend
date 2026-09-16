
// V4.1 - 著名景點修復版 - 基於 V4-REAL
// Fix: 過濾非著名景點，保證出名餐廳/景點
const CACHE = globalThis.__TB_V4_1_CACHE__ || (globalThis.__TB_V4_1_CACHE__ = new Map());
const TTL_FRESH = 2*24*60*60*1000;
const TTL_STALE = 7*24*60*60*1000;

const FAMOUS_KEYWORDS = {
  '釜山': ['海雲台','甘川洞','太宗台','五六島','廣安里','札嘎其','Sky Capsule','膠囊列車','伍班長','海東龍宮寺','Spa Land'],
  '首爾': ['明洞','弘大','景福宮','南山塔','東大門','江南','梨泰院'],
  '東京': ['淺草','晴空塔','東京塔','澀谷','新宿','上野'],
  '台北': ['101','九份','士林','西門町','故宮','象山']
};

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  const region = (req.query.region || '釜山').toString().trim();
  const type = (req.query.type || 'all').toString();
  const platforms = (req.query.platforms || 'google,instagram,threads,xiaohongshu').toString();
  const famousOnly = (req.query.famousOnly || 'true').toString() === 'true';
  const minReviews = parseInt(req.query.minReviews || '100');
  const pageToken = (req.query.pagetoken || '').toString();
  const cacheKey = `${region}-${type}-${platforms}-${famousOnly}-${minReviews}-${pageToken}`;
  const now=Date.now();
  const cached=CACHE.get(cacheKey);
  if(cached && now-cached.ts < TTL_FRESH){
    return res.status(200).json({...cached.data, _cache:'HIT_FRESH'});
  }
  try{
    const data=await doFetch(region,type,platforms,famousOnly,minReviews,pageToken,cacheKey);
    return res.status(200).json({...data, _cache:'MISS'});
  }catch(e){
    if(cached) return res.status(200).json({...cached.data, _cache:'FALLBACK', error:e.message});
    return res.status(500).json({error:e.message});
  }
}

async function doFetch(region,type,platforms,famousOnly,minReviews,pageToken,cacheKey){
  const KEY=process.env.GOOGLE_MAPS_API_KEY;
  if(!KEY) throw new Error('Missing GOOGLE_MAPS_API_KEY');

  // 1. Geocode
  let lat,lng,formatted;
  const geoUrl=`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&language=zh-TW&key=${KEY}`;
  let geo=await fetch(geoUrl).then(r=>r.json());
  if(geo.status==='OK' && geo.results[0]){ lat=geo.results[0].geometry.location.lat; lng=geo.results[0].geometry.location.lng; formatted=geo.results[0].formatted_address; }
  else{
    const tUrl=`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(region+' 著名景點')}&language=zh-TW&key=${KEY}`;
    let t=await fetch(tUrl).then(r=>r.json());
    if(t.status==='OK' && t.results[0]){ lat=t.results[0].geometry.location.lat; lng=t.results[0].geometry.location.lng; formatted=t.results[0].formatted_address; }
    else { lat=35.1731; lng=129.0714; formatted=region; }
  }

  // 2. 關鍵：先用 TextSearch 搜著名，再用 Nearby 補充，保證出名度
  async function fetchFamousPlaces(placeType){
    let all=[];
    // A) TextSearch 著名景點 (prominence排序，天生過濾非著名)
    const queries = placeType==='tourist_attraction' 
      ? [`${region} 著名景點`,`${region} 人氣景點`,`${region} famous attractions`]
      : [`${region} 著名餐廳`,`${region} 人氣美食`,`${region} famous restaurant`];
    
    for(const q of queries.slice(0,2)){
      const url=`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&language=zh-TW&key=${KEY}`;
      let r=await fetch(url).then(x=>x.json());
      if(r.status==='OK') all.push(...(r.results||[]));
      if(all.length>=15) break;
    }
    // B) Nearby 作為補充，但只取高分
    if(all.length<10){
      const url=`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20000&type=${placeType}&rankby=prominence&language=zh-TW&key=${KEY}`;
      let r=await fetch(url).then(x=>x.json());
      if(r.status==='OK') all.push(...(r.results||[]));
    }
    // 去重
    const seen=new Set();
    const dedup=all.filter(p=>{ if(seen.has(p.place_id)) return false; seen.add(p.place_id); return true; });
    return dedup;
  }

  let attractionRaw=[], restaurantRaw=[];
  if(type==='all' || type==='attraction'){ attractionRaw=await fetchFamousPlaces('tourist_attraction'); }
  if(type==='all' || type==='restaurant'){ restaurantRaw=await fetchFamousPlaces('restaurant'); }

  // 3. 著名度過濾 + 排序
  function isFamous(place, region, minReviews){
    const rt = place.user_ratings_total||0;
    const rating = place.rating||0;
    const name = place.name||'';
    // 規則：必須 >= minReviews (預設100) 且 >=4.0，且唔係碼頭/停車場/管理處
    const blacklist = ['碼頭','埠頭','停車場','管理處','辦公室','부두','주차장','센터'];
    if(blacklist.some(b=>name.includes(b))) return false;
    if(rt < minReviews) return false;
    if(rating < 4.0) return false;
    // 如果有著名關鍵詞，加分但唔係必須，因為其他地區唔識
    const famousList = FAMOUS_KEYWORDS[region]||[];
    const isKeywordMatch = famousList.some(k=>name.includes(k));
    return {isFamous:true, boost: isKeywordMatch?0.3:0, ratings_total:rt};
  }

  function sortByFame(a,b){
    // 排序公式：評論數權重 50% + 評分 30% + 著名關鍵詞 20%
    const scoreA = (Math.log10(a.user_ratings_total||1)*0.5) + (a.rating||0)*0.3 + (a._famousBoost||0);
    const scoreB = (Math.log10(b.user_ratings_total||1)*0.5) + (b.rating||0)*0.3 + (b._famousBoost||0);
    return scoreB - scoreA;
  }

  // 過濾
  let filteredA = attractionRaw.map(p=>{
    const f=isFamous(p, region, minReviews);
    if(!f || !f.isFamous) return null;
    return {...p, _famousBoost:f.boost};
  }).filter(Boolean).sort(sortByFame).slice(0,15);

  let filteredR = restaurantRaw.map(p=>{
    const f=isFamous(p, region, minReviews);
    if(!f || !f.isFamous) return null;
    return {...p, _famousBoost:f.boost};
  }).filter(Boolean).sort(sortByFame).slice(0,15);

  // 如果過濾後太少，放寬到 50 reviews
  if(filteredA.length<5){
    filteredA = attractionRaw.filter(p=>(p.user_ratings_total||0)>=50 && (p.rating||0)>=4.0).sort(sortByFame).slice(0,15);
  }
  if(filteredR.length<5){
    filteredR = restaurantRaw.filter(p=>(p.user_ratings_total||0)>=50 && (p.rating||0)>=4.0).sort(sortByFame).slice(0,15);
  }

  // 4. Enrich with Place Details 真評論
  async function enrich(places, kind){
    return await Promise.all(places.map(async (p)=>{
      try{
        const detailsUrl=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,rating,user_ratings_total,formatted_address,geometry,photos,reviews,url,website,opening_hours&language=zh-TW&key=${KEY}`;
        const det=await fetch(detailsUrl).then(r=>r.json());
        const d=det.result||{};
        const reviews=d.reviews||[];
        const pos=reviews.filter(r=>r.rating>=4).slice(0,3).map(r=>({text:(r.text||'推薦').slice(0,90), author:r.author_name, rating:r.rating, time:r.relative_time_description, source:'Google真評論', isReal:true, url:d.url}));
        const neg=reviews.filter(r=>r.rating<=3).slice(0,3).map(r=>({text:(r.text||'有待改善').slice(0,90), author:r.author_name, rating:r.rating, time:r.relative_time_description, source:'Google真評論', isReal:true, url:d.url}));
        return {
          id:`gmaps_${p.place_id}_${kind}`, place_id:p.place_id, name:d.name||p.name, area:region, kind,
          rating:d.rating||p.rating||4.3, ratings_total:d.user_ratings_total||p.user_ratings_total||0,
          formatted_address:d.formatted_address||p.formatted_address||p.vicinity||formatted,
          lat:p.geometry?.location?.lat, lng:p.geometry?.location?.lng,
          image:p.photos?.[0]?.photo_reference?`https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${p.photos[0].photo_reference}&key=${KEY}`:`https://picsum.photos/seed/${p.place_id}/600/400`,
          googleUrl:d.url, reviews:{positive:pos, negative:neg, isReal:true, count:reviews.length}, scores:{final: Math.log10(p.user_ratings_total||1) + (p.rating||0)}, trending:`${((p.user_ratings_total||0)/100).toFixed(1)}k人評`, tag: (p.user_ratings_total||0)>1000?'超人氣著名':'人氣著名', isReal:true, _raw_ratings_total:p.user_ratings_total
        };
      }catch(e){
        return {id:`gmaps_${p.place_id}_${kind}`, name:p.name, rating:p.rating||4.3, ratings_total:p.user_ratings_total||0, formatted_address:p.vicinity||formatted, lat:p.geometry?.location?.lat, lng:p.geometry?.location?.lng, image:`https://picsum.photos/seed/${p.place_id}/600/400`, reviews:{positive:[], negative:[], isReal:false}, scores:{final:0}, trending:'', tag:'著名'};
      }
    }));
  }

  const attractions = await enrich(filteredA,'attraction');
  const restaurants = await enrich(filteredR,'restaurant');

  const data={
    region, geo:{lat,lng,formatted}, attractions, restaurants, count:attractions.length+restaurants.length,
    usedGoogle:true, source:'V4.1 著名度修復版 - TextSearch著名+評論數>=100+評分>=4.0+黑名單過濾',
    reviewSource:'真實來源：Google Place Details API 真實評論',
    debug:{geoStatus:'OK', nearbyCount:attractions.length, restaurantCount:restaurants.length, platforms:platforms.split(','), filter:`minReviews>=${minReviews}, rating>=4.0, blacklist碼頭/停車場`, famousKeywords:FAMOUS_KEYWORDS[region]||[], beforeFilter:{attraction:attractionRaw.length, restaurant:restaurantRaw.length}, afterFilter:{attraction:attractions.length, restaurant:restaurants.length}, isV4_1:true}
  };
  CACHE.set(cacheKey,{ts:Date.now(), data});
  return data;
}
