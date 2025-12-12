const fetch = globalThis.fetch || require('node-fetch');

const requests = [
  { project: 'orto', layer: 'LAYER_A' },
  { project: 'orto', layer: 'LAYER_B' },
  { project: 'orto', layer: 'LAYER_A' } // duplicate target to test lock
];

(async () => {
  const results = await Promise.all(requests.map(async (body, i) => {
    try {
      const res = await fetch('http://127.0.0.1:3000/generate-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      return { index: i, status: res.status, body: text };
    } catch (err) {
      return { index: i, error: String(err) };
    }
  }));
  console.log('Results:', JSON.stringify(results, null, 2));
})();