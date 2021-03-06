import { assert } from './assert.js';
import slots from './slots.js';
import spec from './spec.js';

export class ReadableStream {
    constructor(underlyingSource = null, strategy = {}) {
        spec.readableStreamContruct(this, underlyingSource, strategy);
    }

    get locked() {
        return spec.isReadableStreamLocked(this);
    }

    async cancel(reason) {
        if (spec.isReadableStreamLocked(this)) {
            throw spec.createNewTypeError('Cannot cancel a stream that already has a reader');
        }
        return spec.readableStreamCancel(this, reason);
    }

    getReader(options = {}) {
        return spec.readableStreamGetReader(this, options);
    }

    pipeThrough(transform, options) {
        spec.ensureReadableWritablePair(transform);
        if (options == null) {
            options = {};
        } else if (options !== Object(options)) {
            throw spec.createNewTypeError('Invalid options: not an object');
        }
        const signal = options.signal;
        if (signal != null) {
            if (!spec.isAbortSignal(signal)) {
                throw spec.createNewTypeError('Invalid signal: must be an AbortSignal compatible interface');
            }
        }
        if (spec.isReadableStreamLocked(this)) {
            throw spec.createNewTypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream');
        }
        if (spec.isWritableStreamLocked(transform.writable)) {
            throw spec.createNewTypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream');
        }
        spec.readableStreamPipeTo(this, transform.writable, !!options.preventClose, !!options.preventAbort, !!options.preventCancel, signal)
            .then(() => { }, error => {
                console.error(error);
            });
        return transform.readable;
    }

    pipeTo(destination, options) {
        if (options == null) {
            options = {};
        } else if (options !== Object(options)) {
            throw spec.createNewTypeError('Invalid options: not an object');
        }
        if (!(spec.isWritableStream(destination))) {
            throw spec.createNewTypeError('Invalid destination: not an instance of WritableStream');
        }
        if (spec.isReadableStreamLocked(this)) {
            throw spec.createNewTypeError('Cannot pipe a locked stream');
        }
        if (spec.isWritableStreamLocked(destination)) {
            throw spec.createNewTypeError('Cannot pipe to a locked stream');
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
            throw spec.createNewTypeError('Invalid options: must be object, if specified');
        }
        return spec.readableStreamAsyncIteratorInit(this, options);
    }
}

Object.defineProperties(ReadableStream.prototype, {
    [Symbol.asyncIterator]: {
        configurable: true,
        writable: true,
        value: ReadableStream.prototype.values
    }
});

export function ReadableStreamGenericReader(Class) {
    const mixinMap = ReadableStreamGenericReader[Symbol.for('mixin')];
    mixinMap.set(Class.prototype, Class);
    Object.defineProperties(Class.prototype, {
        closed: {
            configurable: true,
            get: function closed() {
                return this[slots.closedAsync].promise;
            }
        },
        cancel: {
            configurable: true,
            writable: true,
            value: function cancel(reason) {
                if (this[slots.stream] == null) {
                    throw spec.createNewTypeError(`This readable stream reader has been released and cannot be used to monitor the stream's state`);
                }
                spec.readableStreamReaderGenericCancel(this, reason);
            }
        }
    });
}

Object.defineProperties(ReadableStreamGenericReader, {
    [Symbol.for('mixin')]: {
        configurable: true,
        value: new WeakMap()
    },
    [Symbol.hasInstance]: {
        configurable: true,
        value: function (instance) {
            if (Function[Symbol.hasInstance].call(this, instance)) {
                return true;
            }
            const mixinMap = this[Symbol.for('mixin')];
            let o = Object.getPrototypeOf(instance);
            while (o != null) {
                if (mixinMap.has(o)) {
                    return true;
                }
                o = Object.getPrototypeOf(o);
            }
            return false;
        }
    }
});

export class ReadableStreamDefaultReader {
    constructor(stream) {
        if (!spec.isReadableStream(stream)) {
            throw spec.createNewTypeError('Parameter 1 is not of type `ReadableStream`.');
        }
        spec.setUpReadableStreamDefaultReader(this, stream);
    }

    async read() {
        if (this[slots.stream] == null) {
            throw spec.createNewTypeError(`Illegal invocation`);
        }
        const readRequest = spec.createAsync({
            chunkSteps: chunk => {
                readRequest.fulfill({ value: chunk, done: false });
            },
            closeSteps: () => {
                readRequest.fulfill({ value: undefined, done: true });
            },
            errorSteps: e => {
                readRequest.reject(e);
            }
        });
        spec.readableStreamDefaultReaderRead(this, readRequest);
        return readRequest.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readRequests].length > 0) {
            throw spec.createNewTypeError(`Tried to release a reader lock when that reader has pending read() calls un-settled`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
}

ReadableStreamGenericReader(ReadableStreamDefaultReader);

export class ReadableStreamBYOBReader {
    constructor(stream) {
        if (!spec.isReadableStream(stream)) {
            throw spec.createNewTypeError(`Parameter 1 is not of type 'ReadableStream'.`);
        }
        spec.setUpReadableStreamBYOBReader(this, stream);
    }

    async read(view) {
        if (view instanceof ArrayBuffer) {
            view = new DataView(view);
        }
        if (!ArrayBuffer.isView(view)) {
            throw spec.createNewTypeError(`Parameter 1 is not 'ArrayBufferView'`);
        }
        if (view.byteLength === 0) {
            throw spec.createNewTypeError(`This readable stream reader cannot be used to read as the view has byte length equal to 0`);
        }
        if (this[slots.stream] == null) {
            throw spec.createNewTypeError(`This readable stream reader has been released and cannot be used to read from its previous owner stream`);
        }
        const readIntoRequest = spec.createAsync({
            chunkSteps: chunk => {
                readIntoRequest.fulfill({ value: chunk, done: false });
            },
            closeSteps: chunk => {
                readIntoRequest.fulfill({ value: chunk, done: true });
            },
            errorSteps: e => {
                readIntoRequest.reject(e);
            }
        });
        spec.readableStreamBYOBReaderRead(this, view, readIntoRequest);
        return readIntoRequest.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readIntoRequests].length > 0) {
            throw spec.createNewTypeError(`Tried to release a reader lock when that reader has pending read() calls un-settled`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
}

ReadableStreamGenericReader(ReadableStreamBYOBReader);

export class ReadableStreamDefaultController {
    get desiredSize() {
        return spec.readableStreamDefaultControllerGetDesiredSize(this);
    }

    close() {
        if (!spec.readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
            throw spec.createNewTypeError(`Cannot close a readable stream that has already been requested to be closed`);
        }
        spec.readableStreamDefaultControllerClose(this);
    }

    enqueue(chunk) {
        if (!spec.readableStreamDefaultControllerCanCloseOrEnqueue(this)) {
            throw spec.createNewTypeError(`Cannot enqueue a chunk into a readable stream that has already been requested to be closed`);
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
            throw spec.createNewTypeError(`Cannot close a readable stream that has already been requested to be closed`);
        }
        spec.readableByteStreamControllerClose(this);
    }

    enqueue(chunk) {
        if (chunk instanceof ArrayBuffer) {
            chunk = new Uint8Array(chunk);
        }
        if (!ArrayBuffer.isView(chunk)) {
            throw spec.createNewTypeError(`Parameter 1 is not an ArrayBufferView`);
        }
        if (chunk.byteLength <= 0) {
            throw spec.createNewTypeError('Cannot enqueue an empty chunk');
        }
        if (!spec.readableByteStreamControllerCanCloseOrEnqueue(this)) {
            throw spec.createNewTypeError(`Cannot close a readable stream that has already been requested to be closed`);
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
            throw spec.createNewTypeError('Parameter 1 is not a non-negative integer');
        }
        if (this[slots.controller] == null) {
            throw spec.createNewTypeError('The BYOB Request has already been invalidated');
        }
        if (this[slots.view].byteLength <= 0) {
            // This is equivalent of IsDeatchedBuffer(...) but without accessing the internal slots;
            // By default, we won't detach the buffer in pure NodeJS implementation (since we cannot access internal slots);
            // We also do not copy the buffer, because this is slow. We trust that the user code won't do anything malicious.
            throw spec.createNewTypeError('The BYOB Request has already been responded to');
        }
        spec.readableByteStreamControllerRespond(this[slots.controller], bytesWritten);
    }

    respondWithNewView(view) {
        if (view instanceof ArrayBuffer) {
            view = new Uint8Array(view);
        }
        if (!ArrayBuffer.isView(view)) {
            throw spec.createNewTypeError(`Parameter 1 is not an 'ArrayBufferView'`);
        }
        if (view.byteLength === 0) {
            throw spec.createNewTypeError(`Parameter 1 is an empty buffer`);
        }
        if (this[slots.controller] == null) {
            throw spec.createNewTypeError(`The BYOB Request has already been invalidated`);
        }
        return this.readableByteStreamControllerRespondWithNewView(this[slots.controller], view);
    }
}

export class WritableStream {
    constructor(underlyingSink = null, strategy = {}) {
        spec.writableStreamConstruct(this, underlyingSink, strategy);
    }

    get locked() {
        return spec.isWritableStreamLocked(this);
    }

    async abort(reason) {
        if (spec.isWritableStreamLocked(this)) {
            throw spec.createNewTypeError('Cannot abort a stream that already has a writer');
        }
        return spec.writableStreamAbort(this, reason);
    }

    async close() {
        if (spec.isWritableStreamLocked(this)) {
            throw spec.createNewTypeError('Cannot close a stream that already has a writer');
        }
        if (spec.writableStreamCloseQueuedOrInFlight(this)) {
            throw spec.createNewTypeError('Cannot close an already-closing stream');
        }
        return spec.writableStreamClose(this);
    }

    getWriter() {
        return spec.acquireWritableStreamDefaultWriter(this);
    }
}

export class WritableStreamDefaultWriter {
    constructor(stream) {
        if (!spec.isWritableStream(stream)) {
            throw spec.createNewTypeError('Parameter 1 is not of type `WritableStream`.');
        }
        spec.setUpWritableStreamDefaultWriter(this, stream);
    }

    get closed() {
        return this[slots.closedAsync].promise;
    }

    get desiredSize() {
        if (this[slots.stream] == null) {
            throw spec.createNewTypeError('The writer is released and cannot modify the stream state');
        }
        return spec.writableStreamDefaultWriterGetDesiredSize(this);
    }

    get ready() {
        return this[slots.readyAsync].promise;
    }

    async abort(reason) {
        if (this[slots.stream] == null) {
            throw spec.createNewTypeError('The writer is released and cannot modify the stream state');
        }
        return spec.writableStreamDefaultWriterAbort(this, reason);
    }

    async close() {
        const stream = this[slots.stream];
        if (stream == null) {
            throw spec.createNewTypeError('The writer is released and cannot modify the stream state');
        }
        if (spec.writableStreamCloseQueuedOrInFlight(stream)) {
            throw spec.createNewTypeError('Cannot close an already-closing stream');
        }
        spec.writableStreamDefaultWriterClose(this);
    }

    releaseLock() {
        const stream = this[slots.stream];
        if (stream == null) {
            return;
        }
        assert?.(stream[slots.writer] != null);
        spec.writableStreamDefaultWriterRelease(this);
    }

    async write(chunk) {
        if (this[slots.stream] == null) {
            throw spec.createNewTypeError('The writer is released and cannot modify the stream state');
        }
        spec.writableStreamDefaultWriterWrite(this, chunk);
    }
}

export class WritableStreamDefaultController {
    error(e) {
        const state = this[slots.state];
        if (state !== 'writable') {
            return;
        }
        spec.writableStreamDefaultControllerError(this, e);
    }

    [slots.abortSteps](reason) {
        const result = (0, this[slots.abortAlgorithm])(reason);
        spec.writableStreamDefaultControllerClearAlgorithms(this);
        return result;
    }

    [slots.errorSteps]() {
        spec.resetQueue(this);
    }
}

export class TransformStream {
    constructor(transformer = null, writableStrategy = {}, readableStrategy = {}) {
        spec.transformStreamConstruct(this, transformer, writableStrategy, readableStrategy);
    }

    get readable() {
        return this[slots.readable];
    }

    get writable() {
        return this[slots.writable];
    }
}

export class TransformStreamDefaultController {
    get desiredSize() {
        const readableController = this[slots.stream][slots.readable][slots.controller];
        return spec.readableStreamDefaultControllerGetDesiredSize(readableController);
    }

    enqueue(chunk) {
        spec.transformStreamDefaultControllerEnqueue(this, chunk);
    }

    error(e) {
        spec.transformStreamDefaultControllerError(this, e);
    }
}

export class ByteLengthQueuingStrategy {
    constructor(init) {
        if (init == null || init !== Object(init)) {
            throw spec.createNewTypeError('Invalid parameter 1: expected an object');
        }
        const highWaterMark = Number(init.highWaterMark);
        if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
            throw spec.createNewRangeError('Invalid highWaterMark: expected non-negative number');
        }
        this[slots.highWaterMark] = highWaterMark;
    }

    get highWaterMark() {
        return this[slots.highWaterMark];
    }

    get size() {
        return spec.byteLengthQueuingStrategySizeFunction;
    }
}

export class CountQueuingStrategy {
    constructor(init) {
        if (init == null || init !== Object(init)) {
            throw spec.createNewTypeError('Invalid parameter 1: expected an object');
        }
        const highWaterMark = Number(init.highWaterMark);
        if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
            throw spec.createNewRangeError('Invalid highWaterMark: expected non-negative number');
        }
        this[slots.highWaterMark] = highWaterMark;
    }

    get highWaterMark() {
        return this[slots.highWaterMark];
    }

    get size() {
        return spec.countQueuingStrategySizeFunction;
    }
}
