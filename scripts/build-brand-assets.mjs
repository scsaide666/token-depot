// Resize the supplied TD artwork without redrawing or changing its identity.
// Both asset entrypoints use this source so a rebuild cannot restore an old logo.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const mark = await readFile(new URL("../public/brand/token-depot-td-source.png", import.meta.url));
const root = new URL("../", import.meta.url);
const output = file => new URL(file, root);
await mkdir(output("public/social/"), { recursive: true });
for (const [file, size] of [["public/brand/token-depot-mark-td.png", 256], ["public/brand/token-depot-mark.png", 256], ["public/brand/aihub-mark.png", 256], ["app/icon.png", 256], ["public/apple-icon.png", 180]]) {
  await sharp(mark).resize(size, size).png().toFile(fileURLToPath(output(file)));
}
const sizes = [16, 32, 48, 64];
const images = await Promise.all(sizes.map(size => sharp(mark).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((buffer, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index]; header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(buffer.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += buffer.length;
});
await writeFile(output("app/favicon.ico"), Buffer.concat([header, ...images]));
// Keep the previously published SVG URL consistent with the raster brand asset.
const webMark = await sharp(mark).resize(256, 256).png().toBuffer();
const image = `data:image/png;base64,${webMark.toString("base64")}`;
await writeFile(output("public/brand/token-depot-mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="${image}"/></svg>\n`);
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#F5F9FF"/>
<rect x="40" y="40" width="1120" height="550" rx="16" fill="#FFFFFF" stroke="#DCE7F8"/>
<image x="88" y="88" width="56" height="56" href="${image}"/>
<g font-family="Geist,Arial,sans-serif"><text x="162" y="127" fill="#0F172A" font-size="32" font-weight="600" letter-spacing="-1">Token Depot</text>
<text x="88" y="270" fill="#0F172A" font-size="76" font-weight="600" letter-spacing="-4">One API.</text>
<text x="88" y="356" fill="#0F4FCC" font-size="76" font-weight="600" letter-spacing="-4">Every AI model.</text>
<text x="91" y="422" fill="#475569" font-size="24">Models, usage and billing. In one workspace.</text>
<line x1="88" x2="1112" y1="478" y2="478" stroke="#DCE7F8"/>
<text x="91" y="532" fill="#0F4FCC" font-size="20" font-family="Arial,sans-serif">POST /v1/chat/completions</text>
<text x="1112" y="532" text-anchor="end" fill="#475569" font-size="18">AI API Infrastructure</text></g></svg>`;
const shareImage = await sharp(Buffer.from(social)).png().toBuffer();
await Promise.all(["public/social/token-depot.png", "public/social/aihub.png"].map(file => writeFile(output(file), shareImage)));
console.log("Built Token Depot mark, 4-size favicon, app icon, Apple icon and 1200×630 share image.");
