module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const region = (req.query && (req.query.region || req.query.q)) || '釜山';
  const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
  
  const debug = { region, keyExists: !!GOOGLE_KEY, keyPrefix: GOOGLE_KEY ? GOOGLE_KEY.substring(0, 8)+'...' : 'MISSING' };
  
  if (!GOOGLE_KEY) {
    return res.status(200).json({ region, attractions: [], count:0, usedGoogle:false, debug, error:'MISSING_API_KEY' });
  }
  
  try {
    // 1. Geocode
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&language=zh-TW&key=${GOOGLE_KEY}`;
    const geoRes = await fetch(geoUrl);
    const geoJson = await geoRes.json();
    debug.geoStatus = geoJson.status;
    debug.geoError = geoJson.error_message || null;
    
    let lat = 35.1796, lng = 129.0756, formatted = region;
    if (geoJson.status === 'OK' && geoJson.results[0]) {
      lat = geoJson.results[0].geometry.location.lat;
      lng = geoJson.results[0].geometry.location.lng;
      formatted = geoJson.results[0].formatted_address;
    }
    
    // 2. Nearby Search
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20000&type=tourist_attraction&language=zh-TW&key=${GOOGLE_KEY}`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyJson = await nearbyRes.json();
    debug.nearbyStatus = nearbyJson.status;
    debug.nearbyError = nearbyJson.error_message || null;
    debug.nearbyCount = (nearbyJson.results || []).length;
    
    let places = nearbyJson.results || [];
    
    // 3. 如果 Nearby 0 結果，改用 Text Search 後備 (釜山 旅遊景點)
    if (places.length === 0) {
      const textUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(region + ' 旅遊景點')}&language=zh-TW&key=${GOOGLE_KEY}`;
      const textRes = await fetch(textUrl);
      const textJson = await textRes.json();
      debug.textStatus = textJson.status;
      debug.textError = textJson.error_message || null;
      debug.textCount = (textJson.results || []).length;
      places = textJson.results || [];
    }
    
    // 4. 再冇就用 Busan 英文再試
    if (places.length === 0 && region.includes('釜山')) {
      const textUrl2 = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=Busan tourist attractions&language=zh-TW&key=${GOOGLE_KEY}`;
      const textRes2 = await fetch(textUrl2);
      const textJson2 = await textRes2.json();
      debug.text2Status = textJson2.status;
      debug.text2Count = (textJson2.results || []).length;
      places = textJson2.results || [];
    }
    
    const attractions = places.slice(0, 15).map(p => ({
      id: `gmaps_${p.place_id}`,
      name: p.name,
      area: region,
      rating: p.rating || 4.6,
      ratings_total: p.user_ratings_total || 0,
      formatted_address: p.formatted_address || p.vicinity || '',
      image: p.photos ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${p.photos[0].photo_reference}&key=${GOOGLE_KEY}` : `https://images.unsplash.com/photo-1500835556837-99ac94a94552?w=800`,
      trending: `${(Math.random()*3+1).toFixed(1)}k`,
      tag: 'Google真實',
      sources: ['google'],
      usedGoogle: true,
      lat: p.geometry?.location?.lat || lat,
      lng: p.geometry?.location?.lng || lng,
      place_id: p.place_id
    }));
    
    return res.status(200).json({ 
      region, 
      geo: { lat, lng, formatted }, 
      attractions, 
      count: attractions.length, 
      usedGoogle: true, 
      source: 'google-real-vercel-node24-v2',
      debug // 俾你睇點解頭先 0 結果
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack, region, attractions: [], debug });
  }
};