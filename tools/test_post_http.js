const http = require('http');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 15000
    };
    const req = http.request(options, (res) => {
      let out = '';
      res.on('data', (chunk) => out += chunk.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: out }));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

(async () => {
  const bodies = [
    { project: 'orto', layer: 'LAYER_A' },
    { project: 'orto', layer: 'LAYER_B' },
    { project: 'orto', layer: 'LAYER_A' }
  ];
  const promises = bodies.map((b) => postJson('/generate-cache', b).then(r => ({ ok: true, r })).catch(e => ({ ok: false, e: String(e) })));
  const results = await Promise.all(promises);
  console.log(JSON.stringify(results, null, 2));
})();