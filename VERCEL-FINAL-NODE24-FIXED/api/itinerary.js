module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  const selectedIds = (body && body.selectedIds) || [];
  const days = (body && body.days) || 2;
  const perDay = Math.max(1, Math.ceil(selectedIds.length / days));
  const itinerary = [];
  for (let d = 0; d < days; d++) {
    const dayItems = selectedIds.slice(d * perDay, (d + 1) * perDay);
    itinerary.push({ day: d + 1, items: dayItems.map((id, i) => ({ id, time: `${9 + i * 3}:00`, travel: '地鐵 10分', cost: 400 })) });
  }
  return res.status(200).json({ itinerary, summary: { totalCost: selectedIds.length * 400, budget: (body && body.budget) || 10000 } });
};