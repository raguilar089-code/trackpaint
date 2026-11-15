// node tools/convert-models.cjs  (with `npm run dev` running on :5173)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const NAMES = ['portimao_garages', 'prop_barrier_1M',
  'prop_tyre_block_A', 'seats_hillslope_A', 'wall_a'];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('console', (m) => m.type() === 'error' && console.error(m.text()));
  await p.goto('http://localhost:5173/trackpaint/tools/convert-models.html');
  await p.waitForFunction(() => window.convert);
  const out = path.join(__dirname, '../public/assets/models');
  const report = {};
  for (const n of (process.argv[2] ? [process.argv[2]] : NAMES)) {
    const r = await p.evaluate((n) => window.convert(n), n);
    fs.writeFileSync(path.join(out, n + '.glb'), Buffer.from(r.glb, 'base64'));
    report[n] = { size: r.size.map((v) => +v.toFixed(2)), min: r.min.map((v) => +v.toFixed(2)), meshes: r.info };
    console.log(n, JSON.stringify(report[n].size), JSON.stringify(report[n].min), r.info.length, 'meshes',
      (fs.statSync(path.join(out, n + '.glb')).size / 1024).toFixed(0) + ' KB');
  }
  fs.writeFileSync('/tmp/claude-0/models-report.json', JSON.stringify(report, null, 1));
  await b.close();
})();
