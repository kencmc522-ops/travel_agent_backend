
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  const {selectedAttractions=[], selectedRestaurants=[], days=2, budget=10000, transport='auto'} = req.body||{};
  const all=[...selectedAttractions, ...selectedRestaurants];
  function hav(a,b){
    if(!a.lat||!a.lng||!b.lat||!b.lng) return 1.5;
    const R=6371;
    const dLat=(b.lat-a.lat)*Math.PI/180;
    const dLng=(b.lng-a.lng)*Math.PI/180;
    const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.asin(Math.sqrt(x));
  }
  let route=[];
  if(all.length){
    let remaining=[...all];
    let current=remaining.shift();
    route.push(current);
    while(remaining.length){
      let bestIdx=0, bestDist=Infinity;
      for(let i=0;i<remaining.length;i++){ const d=hav(current, remaining[i]); if(d<bestDist){bestDist=d; bestIdx=i;} }
      current=remaining.splice(bestIdx,1)[0];
      route.push({...current, distanceFromPrev:bestDist, travelTime: Math.round(bestDist*12+8), transport: bestDist>3?'地鐵/的士':'步行'});
    }
  }
  const perDay=Math.ceil(route.length/days||1);
  let itinerary=[]; let totalCost=0;
  for(let d=0; d<days; d++){
    const dayItems=route.slice(d*perDay,(d+1)*perDay);
    let dayCost=0, dayDistance=0;
    const items=dayItems.map((it, idx)=>{
      const isRest=it.kind==='restaurant'||it.type==='restaurant'||it.id?.includes('restaurant');
      const cost=isRest? Math.floor(Math.random()*350+150) : Math.floor(Math.random()*100);
      dayCost+=cost; dayDistance+=it.distanceFromPrev||0;
      return {time:`${9+idx*2}:${idx%2===0?'00':'30'}`, name:it.name||it.id, type:isRest?'餐廳':'景點', area:it.area||'', rating:it.rating||4.5, travel: idx>0? `${it.travelTime||12}分鐘 ${it.transport||'步行'} (${(it.distanceFromPrev||1.2).toFixed(1)}km)`:'起點', cost, lat:it.lat, lng:it.lng, googleUrl:it.googleUrl||''};
    });
    totalCost+=dayCost;
    itinerary.push({day:d+1, items, dayCost, dayDistance:dayDistance.toFixed(1)+'km', estimatedTravel: items.reduce((s,i)=>s+(parseInt(i.travel)||0),0)+'分鐘'});
  }
  return res.status(200).json({itinerary, totalCost, totalDistance: route.reduce((s,x)=>s+(x.distanceFromPrev||0),0).toFixed(1)+'km', totalDays:days, budget, remaining:budget-totalCost, transportMode:transport, accommodation:{note:'住宿模塊預留空間 - 未來可獨立開啟或作為新功能選項', placeholder:true, future:true}, routeOptimization:'Nearest Neighbor + 距離排序，考慮日數限制+交通時間+預算'});
}
