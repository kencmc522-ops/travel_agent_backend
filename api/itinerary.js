
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  const { selectedIds=[], selectedRestaurants=[], days=2 } = req.body||{};
  const all=[...selectedIds, ...selectedRestaurants].map((id,i)=>({ id, lat:35.1+Math.random()*0.2, lng:129.0+Math.random()*0.3, name:id }));
  function hav(a,b){ const R=6371; const dLat=(b.lat-a.lat)*Math.PI/180; const dLng=(b.lng-a.lng)*Math.PI/180; const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2; return R*2*Math.asin(Math.sqrt(x)); }
  let route=[], rem=[...all], cur=rem.shift(); if(cur) route.push(cur);
  while(rem.length){ let best=0, bestD=Infinity; for(let j=0;j<rem.length;j++){ const d=hav(cur,rem[j]); if(d<bestD){bestD=d; best=j;}} cur=rem.splice(best,1)[0]; route.push({...cur, distanceFromPrev:bestD, travelTime:Math.round(bestD*8+5)}); }
  const perDay=Math.ceil(route.length/days); let itinerary=[];
  for(let d=0; d<days; d++){ const dayItems=route.slice(d*perDay,(d+1)*perDay); let dayCost=0; const items=dayItems.map((it,idx)=>{ const isRest=it.id.includes('restaurant'); const cost=isRest?300:0; dayCost+=cost; return { time:`${9+idx*2}:00`, name:it.name, type:isRest?'餐廳':'景點', travel: idx>0?`${it.travelTime||10}分鐘`:'起點', cost }; }); itinerary.push({ day:d+1, items, dayCost }); }
  return res.status(200).json({ itinerary, totalCost:itinerary.reduce((s,d)=>s+d.dayCost,0) });
}
