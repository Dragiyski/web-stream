import node_fs from 'node:fs';
import node_path from 'node:path';
import node_url from 'node:url';

const __filename = node_url.fileURLToPath(import.meta.url);
const __dirname = node_path.dirname(__filename);

const sourceFile = node_path.resolve(__dirname, 'file-15000.txt');
const highWaterMark = 4096;
const iterations = 400;
const timeMeasurments = new Array(iterations);
let nextMeasurement = 0;

async function iteration() {
    let aggregate = '';
    const decoder = new TextDecoder('utf-8');
    let duration = process.hrtime.bigint();
    const stream = node_fs.createReadStream(sourceFile, { highWaterMark });
    for await (const chunk of stream) {
        aggregate += decoder.decode(chunk, { stream: true });
    }
    aggregate += decoder.decode(new ArrayBuffer(0), { stream: false });
    duration = process.hrtime.bigint() - duration;
    timeMeasurments[nextMeasurement++] = duration;
}

const jobs = [];
for (let i = 0; i < iterations; ++i) {
    jobs.push(iteration());
}

await Promise.all(jobs);

const timeSum = timeMeasurments.reduce((sum, value) => sum + value, 0n);
const timeAverage = Number(timeSum / BigInt(iterations)) + Number(timeSum % BigInt(iterations)) / iterations;
console.log(`fs:stream time: ${timeAverage.toFixed(6)}ns`);
