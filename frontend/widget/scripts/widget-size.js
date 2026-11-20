import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const LIMIT_KB = Number(process.env['WIDGET_SIZE_LIMIT_KB'] ?? 30);
const outputDir = path.resolve(process.cwd(), 'dist');

if (!Number.isFinite(LIMIT_KB) || LIMIT_KB <= 0) {
  console.error('WIDGET_SIZE_LIMIT_KB must be a positive number.');
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  console.error('Widget dist directory not found; run npm run build first.');
  process.exit(1);
}

const bundles = fs.readdirSync(outputDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => {
    const filePath = path.join(outputDir, file);
    const content = fs.readFileSync(filePath);
    return {
      file,
      rawKb: Number((content.length / 1024).toFixed(2)),
      gzipKb: Number((zlib.gzipSync(content).length / 1024).toFixed(2)),
    };
  });

if (bundles.length === 0) {
  console.error('No widget JavaScript bundle found in dist.');
  process.exit(1);
}

const totalGzipKb = Number(bundles.reduce((sum, bundle) => sum + bundle.gzipKb, 0).toFixed(2));
const passed = bundles.every((bundle) => bundle.gzipKb <= LIMIT_KB);

for (const bundle of bundles) {
  console.log(`${bundle.file}: ${bundle.rawKb} KB raw | ${bundle.gzipKb} KB gzip`);
}
console.log(`\nWidget budget: ${LIMIT_KB} KB gzip per bundle`);
console.log(`Total widget JavaScript: ${totalGzipKb} KB gzip`);
console.log(passed ? '✅ Widget size within budget.' : '❌ Widget size budget exceeded.');

fs.writeFileSync(
  path.join(outputDir, 'widget-size-report.json'),
  JSON.stringify({ limitKb: LIMIT_KB, totalGzipKb, bundles, passed }, null, 2),
);

if (!passed) process.exit(1);
