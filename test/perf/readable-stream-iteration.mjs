import node_fs from 'node:fs';
import node_path from 'node:path';
import node_url from 'node:url';
import node_util from 'node:util';
import { ReadableStream } from '../../index.js';

const __filename = node_url.fileURLToPath(import.meta.url);
const __dirname = node_path.dirname(__filename);

const sourceFile = node_path.resolve(__dirname, 'file-15000.txt');
const highWaterMark = 4096;
const iterations = 400;
const timeMeasurments = new Array(iterations);
let nextMeasurement = 0;

const fs = {
    open: node_util.promisify(node_fs.open.bind(node_fs)),
    read: node_util.promisify(node_fs.read.bind(node_fs)),
    close: node_util.promisify(node_fs.close.bind(node_fs))
};

class FileSource {
    constructor(filename, chunkSize) {
        this.filename = filename;
        this.chunkSize = chunkSize;
        this.type = 'bytes';
    }

    async start() {
        this.fd = await fs.open(this.filename, 'r');
    }

    async pull(controller) {
        if (this.fd == null) {
            return;
        }
        let shouldClose = false;
        const request = controller.byobRequest;
        if (request) {
            const view = request.view;
            const bytesRead = await fs.read(this.fd, {
                buffer: view,
                offset: 0,
                length: view.byteLength
            });
            request.respond(bytesRead);
            shouldClose = bytesRead <= 0;
        } else {
            const buffer = new Uint8Array(this.chunkSize);
            const bytesRead = await fs.read(this.fd, {
                buffer: buffer,
                offset: 0,
                length: buffer.byteLength
            });
            if (bytesRead > 0) {
                controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
            } else {
                shouldClose = true;
            }
        }
        if (shouldClose) {
            await fs.close(this.fd);
            this.fd = null;
            controller.close();
        }
    }

    async cancel() {
        await fs.close(this.fd);
        this.fd = null;
    }
}

async function iteration() {
    let aggregate = '';
    const decoder = new TextDecoder('utf-8');
    let duration = process.hrtime.bigint();
    const source = new FileSource(sourceFile, highWaterMark);
    const stream = new ReadableStream(source, { highWaterMark });
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
console.log(`whatwg:stream time: ${timeAverage.toFixed(6)}ns`);
