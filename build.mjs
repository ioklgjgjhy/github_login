// Construit index.html (fichier unique, autonome, utilisable hors ligne) à partir de src/
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const r = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = readFileSync('src/index.template.html', 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html : ${(html.length / 1024).toFixed(0)} ko`);
