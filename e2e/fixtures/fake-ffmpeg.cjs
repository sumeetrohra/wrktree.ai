// Stands in for ffmpeg in the E2E suites (AGENTDECK_FFMPEG): writes three small JPEG "frames" for
// the output pattern, whatever the input, unless the input says it is broken.
const fs = require("node:fs");

const out = process.argv[process.argv.length - 1];
const input = process.argv[process.argv.indexOf("-i") + 1];
if (fs.readFileSync(input).includes("not a video")) {
  console.error("Invalid data found when processing input");
  process.exit(1);
}
for (let i = 1; i <= 3; i++) {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(100 * i),
    Buffer.from([0xff, 0xd9]),
  ]);
  fs.writeFileSync(out.replace("%03d", String(i).padStart(3, "0")), jpeg);
}
