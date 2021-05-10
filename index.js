import { assert } from './assert.js';
import slots from './slots.js';
import spec from './spec.js';

export class ReadableStream {
    constructor(underlyingSource = null, strategy = {}) {
        const underlyingSourceDict = spec.makeUnderlyingSourceDict(underlyingSource);
        if (strategy == null) {
            strategy = {};
        }
        spec.initializeReadableStream(this);
        if (underlyingSourceDict.type === 'bytes') {
            if (strategy.size != null) {
                throw new RangeError(`Invalid type is specified`);
            }
            const highWaterMark = spec.extractHighWaterMark(strategy, 0);
            spec.setUpReadableByteStreamControllerFromUnderlyingSource(this, underlyingSource, underlyingSourceDict, highWaterMark);
        } else {
            const sizeAlgorithm = spec.extractSizeAlgorithm(strategy);
            const highWaterMark = spec.extractHighWaterMark(strategy, 1);
            spec.setUpReadableStreamDefaultControllerFromUnderlyingSource(this, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm);
        }
    }

    get locked() {
        return spec.isReadableStreamLocked(this);
    }

    async cancel(reason) {
        if (spec.isReadableStreamLocked(this)) {
            throw new TypeError('The readable stream is locked');
        }
        return spec.readableStreamCancel(this, reason);
    }

    getReader(options = {}) {
        if (options == null) {
            options = {};
        } else if (options !== Object(options)) {
            throw new TypeError('Invalid options: cannot convert to dictionary');
        }
        const mode = options.mode;
        let byob = false;
        if (mode != null) {
            if (mode !== 'byob') {
                throw new TypeError(`The option [mode] must be exactly the string "byob", if present`);
            }
            byob = true;
        }
        return byob ? spec.acquireReadableStreamBYOBReader(this) : spec.acquireReadableStreamDefaultReader(this);
    }

    pipeThrough(transform, options) {
        if (options != null || options !== Object(options)) {
            throw new TypeError('Invalid options: cannot convert to dictionary');
        } else if (options == null) {
            options = {};
        }
        if (transform != null || transform !== Object(transform)) {
            throw new TypeError('Invalid transform: cannot convert to dictionary');
        } else if (transform == null) {
            throw new TypeError('Invalid transform: missing required members: readable, writable');
        }
        if (!('readable' in transform)) {
            throw new TypeError('Invalid transform: missing required member: readable');
        } else if (!(transform.readable instanceof ReadableStream)) {
            throw new TypeError('Invalid transform: member [readable] is not a ReadableStream');
        }
        if (!('writable' in transform)) {
            throw new TypeError('Invalid transform: missing required member: writable');
        } else if (!(transform.writable instanceof WritableStream)) {
            throw new TypeError('Invalid transform: member [writable] is not a WritableStream');
        }
        if (spec.isReadableStreamLocked(this)) {
            throw new TypeError('Cannot pipe a locked stream');
        }
        if (spec.isWritableStreamLocked(transform.writable)) {
            throw new TypeError('Cannot pipe to a locked stream');
        }
        const signal = options.signal;
        spec.readableStreamPipeTo(this, transform.writable, !!options.preventClose, !!options.preventAbort, !!options.preventCancel, signal)
            .then(() => { }, error => {
                console.error(error);
            });
        return transform.readable;
    }

    pipeTo(destination, options) {
        if (options != null || options !== Object(options)) {
            throw new TypeError('Invalid options: cannot convert to dictionary');
        } else if (options == null) {
            options = {};
        }
        if (!(destination instanceof WritableStream)) {
            throw new TypeError('Invalid destination: not an instance of WritableStream');
        }
        if (spec.isReadableStreamLocked(this)) {
            throw new TypeError('Cannot pipe a locked stream');
        }
        if (spec.isWritableStreamLocked(destination)) {
            throw new TypeError('Cannot pipe to a locked stream');
        }
        const signal = options.signal;
        return spec.readableStreamPipeTo(this, destination, options.prevenClose, options.preventAbort, options.preventCancel, signal);
    }

    tee() {
        return spec.readableStreamTee(this, false);
    }

    values(options = null) {
        if (options == null) {
            options = {};
        } else if (options !== Object(options)) {
            throw new TypeError('Invalid options: must be object, if specified');
        }
        return new spec.ReadableStreamAsyncIterator(this, options);
    }

    [Symbol.asyncIterator]() {
        return new spec.ReadableStreamAsyncIterator(this);
    }
}

export class ReadableStreamDefaultReader {
    constructor(stream) {
        if (!(stream instanceof ReadableStream)) {
            throw new TypeError(`Parameter 1 is not of type 'ReadableStream'.`);
        }
        spec.setUpReadableStreamDefaultReader(this, stream);
    }

    async read() {
        if (this[slots.stream] == null) {
            throw new TypeError(`Illegal invocation`);
        }
        const readRequest = {
            chunkSteps(chunk) {
                this.resolve({
                    value: chunk,
                    done: false
                });
            },
            closeSteps() {
                this.resolve({
                    value: undefined,
                    done: true
                });
            },
            errorSteps(e) {
                this.reject(e);
            }
        };
        readRequest.promise = new Promise((resolve, reject) => {
            readRequest.resolve = resolve;
            readRequest.reject = reject;
        });
        spec.readableStreamDefaultReaderRead(this, readRequest);
        return readRequest.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readRequests].length > 0) {
            throw new TypeError(`There are outstanding read requests`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
}

export class ReadableStreamBYOBReader {
    constructor(stream) {
        if (!(stream instanceof ReadableStream)) {
            throw new TypeError(`Parameter 1 is not of type 'ReadableStream'.`);
        }
        spec.setUpReadableStreamBYOBReader(this, stream);
    }

    async read(view) {
        if (view instanceof ArrayBuffer) {
            view = new DataView(view);
        }
        if (!ArrayBuffer.isView(view)) {
            throw new TypeError(`Parameter 1 is not 'ArrayBufferView'`);
        }
        if (view.byteLength === 0) {
            throw new TypeError(`This readable stream reader cannot be used to read as the view has byte length equal to 0`);
        }
        if (this[slots.stream] == null) {
            throw new TypeError(`This readable stream reader has been released and cannot be used to read from its previous owner stream`);
        }
        const readIntoRequest = {
            chunkSteps(chunk) {
                this.resolve({
                    value: chunk,
                    done: false
                });
            },
            closeSteps(chunk) {
                this.resolve({
                    value: chunk,
                    done: true
                });
            },
            errorSteps(e) {
                this.reject(e);
            }
        };
        readIntoRequest.promise = new Promise((resolve, reject) => {
            readIntoRequest.resolve = resolve;
            readIntoRequest.reject = reject;
        });
        spec.readableStreamBYOBReaderRead(this, view, readIntoRequest);
        return readIntoRequest.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readIntoRequests].length > 0) {
            throw new TypeError(`There are outstanding read requests`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
}

export class ReadableStreamDefaultController {
    get desiredSize() {
        return spec.readableStreamDefaultControllerGetDesiredSize(this);
    }

    close() {
        if (!spec.readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
            throw new TypeError(`Cannot close a readable stream that has already been requested to be closed`);
        }
        spec.readableStreamDefaultControllerClose(this);
    }

    enqueue(chunk) {
        if (!spec.readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
            throw new TypeError(`Cannot enqueue a chunk into a readable stream that has already been requested to be closed`);
        }
        spec.readableStreamDefaultControllerEnqueue(this, chunk);
    }

    error(e) {
        spec.readableStreamDefaultControllerError(this, e);
    }

    [slots.cancelSteps](reason) {
        spec.resetQueue(this);
        const result = this[slots.cancelAlgorithm](reason);
        spec.readableStreamDefaultControllerClearAlgorithms(this);
        return result;
    }

    [slots.pullSteps](readRequest) {
        const stream = this[slots.stream];
        if (this[slots.queue].length > 0) {
            const chunk = spec.dequeueValue(this);
            if (this[slots.closeRequested] && this[slots.queue].length <= 0) {
                spec.readableStreamDefaultControllerClearAlgorithms(this);
                spec.readableStreamClose(stream);
            } else {
                spec.readableStreamDefaultControllerCallPullIfNeeded(this);
            }
            readRequest.chunkSteps(chunk);
        } else {
            spec.readableStreamAddReadRequest(stream, readRequest);
            spec.readableStreamDefaultControllerCallPullIfNeeded(this);
        }
    }
}

export class ReadableByteStreamController {
    get byobRequest() {
        if (this[slots.byobRequest] == null && this[slots.pendingPullIntos].length > 0) {
            const firstDescriptor = this[slots.pendingPullIntos][0];
            const view = new Uint8Array(firstDescriptor.buffer, firstDescriptor.byteOffset + firstDescriptor.bytesFilled, firstDescriptor.byteLength - firstDescriptor.bytesFilled);
            const byobRequest = Object.create(ReadableStreamBYOBRequest.prototype);
            byobRequest[slots.controller] = this;
            byobRequest[slots.view] = view;
            this[slots.byobRequest] = byobRequest;
        }
        return this[slots.byobRequest];
    }

    get desiredSize() {
        return spec.readableByteStreamControllerGetDesiredSize(this);
    }

    close() {
        if (!spec.readableByteStreamControllerCanCloseOrEnqueue(this)) {
            throw new TypeError(`Cannot close a readable stream that has already been requested to be closed`);
        }
        spec.readableByteStreamControllerClose(this);
    }

    enqueue(chunk) {
        if (chunk instanceof ArrayBuffer) {
            chunk = new Uint8Array(chunk);
        }
        if (!ArrayBuffer.isView(chunk)) {
            throw new TypeError(`Parameter 1 is not an ArrayBufferView`);
        }
        if (chunk.byteLength <= 0) {
            throw new TypeError('chunk is empty');
        }
        if (!spec.readableByteStreamControllerCanCloseOrEnqueue(this)) {
            throw new TypeError(`Cannot close a readable stream that has already been requested to be closed`);
        }
        return spec.readableByteStreamControllerEnqueue(this, chunk);
    }

    error(e) {
        spec.readableByteStreamControllerError(this, e);
    }

    [slots.cancelSteps](reason) {
        if (this[slots.pendingPullIntos].length > 0) {
            this[slots.pendingPullIntos][0].bytesFilled = 0;
        }
        spec.resetQueue(this);
        const result = this[slots.cancelAlgorithm](reason);
        spec.readableByteStreamControllerClearAlgorithms(this);
        return result;
    }

    [slots.pullSteps](readRequest) {
        const stream = this[slots.stream];
        assert?.(spec.readableStreamHasDefaultReader(stream));
        if (this[slots.queueTotalSize] > 0) {
            assert?.(spec.readableStreamGetNumReadRequests(stream) === 0);
            const entry = this[slots.queue].shift();
            this[slots.queueTotalSize] -= entry.byteLength;
            this.readableByteStreamControllerHandleQueueDrain(this);
            const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
            readRequest.chunkSteps(view);
            return;
        }
        const autoAllocateChunkSize = this[slots.autoAllocateChunkSize];
        if (autoAllocateChunkSize != null) {
            assert?.(Number.isSafeInteger(autoAllocateChunkSize) && autoAllocateChunkSize >= 0);
            let buffer;
            try {
                buffer = new ArrayBuffer(autoAllocateChunkSize);
            } catch (error) {
                readRequest.errorSteps(error);
                return;
            }
            const pullIntoDescriptor = {
                buffer,
                byteOffset: 0,
                byteLength: autoAllocateChunkSize,
                bytesFilled: 0,
                elementSize: 1,
                ViewConstructor: Uint8Array,
                ByteConstructor: Uint8Array,
                readerType: 'default'
            };
            this[slots.pendingPullIntos].push(pullIntoDescriptor);
        }
        spec.readableStreamAddReadRequest(stream, readRequest);
        spec.readableByteStreamControllerCallPullIfNeeded(this);
    }
}

export class ReadableStreamBYOBRequest {
    get view() {
        return this[slots.view];
    }

    respond(bytesWritten) {
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 0) {
            throw new TypeError('Parameter 1 is not a non-negative integer');
        }
        if (this[slots.controller] == null) {
            throw new TypeError('The BYOB Request has already been invalidated');
        }
        if (this[slots.view].byteLength <= 0) {
            // This is equivalent of IsDeatchedBuffer(...) but without accessing the internal slots;
            // By default, we won't detach the buffer in pure NodeJS implementation (since we cannot access internal slots);
            // We also do not copy the buffer, because this is slow. We trust that the user code won't do anything malicious.
            throw new TypeError('The BYOB Request has already been responded to');
        }
        spec.readableByteStreamControllerRespond(this[slots.controller], bytesWritten);
    }

    respondWithNewView(view) {
        if (view instanceof ArrayBuffer) {
            view = new Uint8Array(view);
        }
        if (!ArrayBuffer.isView(view)) {
            throw new TypeError(`Parameter 1 is not an 'ArrayBufferView'`);
        }
        if (view.byteLength === 0) {
            throw new TypeError(`Parameter 1 is an empty buffer`);
        }
        if (this[slots.controller] == null) {
            throw new TypeError(`The BYOB Request has already been invalidated`);
        }
        return this.readableByteStreamControllerRespondWithNewView(this[slots.controller], view);
    }
}

export class WritableStream {
    constructor(underlyingSink = null, strategy = {}) {
        const underlyingSinkDict = spec.makeUnderlyingSinkDict(underlyingSink);
        if (strategy == null) {
            strategy = {};
        } else if (strategy !== Object(strategy)) {
            throw new TypeError(`Expected startegy to be an object, if specified`);
        }
        if (underlyingSinkDict.type != null) {
            throw new RangeError(`Invalid type is specified`);
        }
        spec.initializeWritableStream(this);
        const sizeAlgorithm = spec.extractSizeAlgorithm(strategy);
        const highWaterMark = spec.extractHighWaterMark(strategy, 1);
        spec.setUpWritableStreamDefaultControllerFromUnderlyingSink(this, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm);
    }
}

export class WritableStreamDefaultWriter {
}

export class WritableStreamDefaultController {
}

export class TransformStream {
}

export class TransformStreamDefaultController {
}

export class ByteLengthQueuingStrategy {
}

export class CountQueuingStrategy {
}
