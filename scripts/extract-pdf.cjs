const fs = require("fs"), zlib = require("zlib");
const path = process.argv[2];
const buf = fs.readFileSync(path);

function ascii85decode(str) {
  let s = str;
  const lt = s.indexOf("<~"); if (lt >= 0) s = s.slice(lt + 2);
  const gt = s.indexOf("~>"); if (gt >= 0) s = s.slice(0, gt);
  const out = [];
  let tuple = [], n = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "z" && n === 0) { out.push(0, 0, 0, 0); continue; }
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 117) continue; // skip whitespace/non-base85
    tuple.push(code - 33); n++;
    if (n === 5) {
      let v = 0; for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      tuple = []; n = 0;
    }
  }
  if (n > 0) {
    for (let k = n; k < 5; k++) tuple.push(84);
    let v = 0; for (const t of tuple) v = v * 85 + t;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let k = 0; k < n - 1; k++) out.push(bytes[k]);
  }
  return Buffer.from(out);
}

const res = [];
let found = 0, ok = 0;
const reStream = /stream\r?\n/g;
const latin = buf.toString("latin1");
let m;
while ((m = reStream.exec(latin))) {
  found++;
  const st = m.index + m[0].length;
  const eIdx = buf.indexOf("endstream", st);
  if (eIdx < 0) continue;
  let chunk = buf.slice(st, eIdx).toString("latin1");
  let txt = null;
  // Try: ASCII85 -> inflate ; ASCII85 -> inflateRaw ; raw inflate
  const attempts = [
    () => zlib.inflateSync(ascii85decode(chunk)).toString("latin1"),
    () => zlib.inflateRawSync(ascii85decode(chunk)).toString("latin1"),
    () => ascii85decode(chunk).toString("latin1"),
  ];
  for (const a of attempts) { try { const r = a(); if (r && /[A-Za-z]/.test(r)) { txt = r; break; } } catch {} }
  if (!txt) continue;
  ok++;
  function unesc(s) {
    return s
      .replace(/\\([nrtbf()\\])/g, (a, b) => ({ n: "\n", r: "", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" }[b] ?? b))
      .replace(/\\([0-7]{1,3})/g, (a, o) => String.fromCharCode(parseInt(o, 8)));
  }
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g;
  let t;
  while ((t = re.exec(txt))) {
    if (t[1] != null) res.push(unesc(t[1]));
    else if (t[2] != null) res.push([...t[2].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((x) => unesc(x[1])).join(""));
  }
}
fs.writeFileSync("C:/Users/EOR - 4055/Downloads/_fr_bdr_extract.txt", res.join("\n"));
console.log(`streams found=${found} decoded=${ok} | text fragments=${res.length}`);
console.log("=====\n" + res.join("\n"));
