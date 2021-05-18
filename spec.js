import { assert } from './assert.js';
import slots from './slots.js';
import {
    ReadableStream,
    WritableStream,
    TransformStream,
    ReadableStreamDefaultReader,
    ReadableStreamBYOBReader,
    ReadableStreamDefaultController,
    ReadableByteStreamController,
    TransformStreamDefaultController,
    WritableStreamDefaultController,
    WritableStreamDefaultWriter
} from './index.js';

const spec = {
    ReadableStreamAsyncIteratorPrototype: Object.create(Object.getPrototypeOf(Object.getPrototypeOf(async function * () {}).prototype), {
        [Symbol.toStringTag]: {
            value: 'ReadableStreamAsyncIterator',
            configurable: true
        }
    }),
    acquireReadableStreamBYOBReader(stream) {
        const reader = Object.create(ReadableStreamBYOBReader.prototype);
        this.setUpReadableStreamBYOBReader(stream, reader);
        return reader;
    },
    acquireReadableStreamDefaultReader(stream) {
        const reader = Object.create(ReadableStreamDefaultReader.prototype);
        this.setUpReadableStreamDefaultReader(stream, reader);
        return reader;
    },
    acquireWritableStreamDefaultWriter(stream) {
        const writer = Object.create(WritableStreamDefaultWriter.prototype);
        this.setUpWritableStreamDefaultWriter(writer, stream);
        return writer;
    },
    asynchronousIteratorInitializationSteps(stream, iterator, args) {
        const reader = this.acquireReadableStreamDefaultReader(stream);
        iterator[slots.reader] = reader;
        iterator[slots.preventCancel] = Boolean(args?.[0]?.preventCancel);
    },
    async asynchronousIteratorNextIterationResult(iterator) {
        const reader = iterator[slots.reader];
        if (reader[slots.stream] == null) {
            iterator[this.ReadableStreamAsyncIterator.endOfIteration] = true;
            throw this.createNewTypeError('Cannot get the next iteration result once the reader has been released');
        }
        const readRequest = this.createAsync({
            chunkSteps: chunk => {
                readRequest.fulfill({ value: chunk, done: false });
            },
            closeSteps: () => {
                this.readableStreamReaderGenericRelease(reader);
                readRequest.fulfill({ value: undefined, done: true });
            },
            errorSteps: e => {
                this.spec.readableStreamReaderGenericRelease(reader);
                readRequest.reject(e);
            }
        });
        this.readableStreamDefaultReaderRead(reader, readRequest);
        return readRequest.promise;
    },
    async asynchronousIteratorReturn(iterator, arg) {
        const reader = iterator[slots.reader];
        if (reader[slots.stream] == null) {
            return;
        }
        // Async iterator guarantees all promises for the iterations has been resolved.
        assert?.(reader[slots.readRequests].length <= 0);
        if (!iterator[slots.preventCancel]) {
            const result = this.readableStreamReaderGenericCancel(reader, arg);
            this.readableStreamReaderGenericRelease(reader);
            return result;
        }
        this.readableStreamReaderGenericRelease(reader);
    },
    closeSentinel: Symbol('close sentinel'),
    createAsync(object = {}) {
        object.promise = this.createNewPromise((fulfill, reject) => {
            object.fulfill = fulfill;
            object.reject = reject;
        });
        object.promise.finally(() => {
            object.fulfill = object.fulfill = null;
        });
        return object;
    },
    createAsyncReturn(value, object = {}) {
        object.promise = this.createNewPromise(fulfill => {
            fulfill(value);
        });
        return object;
    },
    createAsyncThrow(error, object = {}) {
        object.promise = this.createNewPromise((_, reject) => {
            reject(error);
        });
        return object;
    },
    createNew(Constructor, ...args) {
        return new Constructor(...args);
    },
    createNewAbortError() {
        const error = new Error(...arguments);
        error.name = 'AbortError';
        error.code = 'ABORT_ERR';
        return error;
    },
    createNewPromise() {
        return new Promise(...arguments);
    },
    createNewRangeError() {
        return new RangeError(...arguments);
    },
    createNewTypeError() {
        return new TypeError(...arguments);
    },
    createReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark = 1, sizeAlgorithm = () => 1) {
        if (highWaterMark == null) {
            highWaterMark = 1;
        }
        if (sizeAlgorithm == null) {
            sizeAlgorithm = () => 1;
        }
        assert?.(Number.isSafeInteger(highWaterMark) && highWaterMark >= 0);
        const stream = Object.create(ReadableStream.prototype);
        this.initializeReadableStream(stream);
        const controller = Object.create(ReadableStreamDefaultController.prototype);
        this.setUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm);
        return stream;
    },
    createWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) {
        assert?.(Number.isSafeInteger(highWaterMark) && highWaterMark >= 0);
        const stream = Object.create(WritableStream.prototype);
        this.initializeWritableStream(stream);
        const controller = Object.create(WritableStreamDefaultController.prototype);
        this.setUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm);
        return stream;
    },
    dequeueValue(container) {
        assert?.(slots.queue in container && slots.queueTotalSize in container);
        assert?.(container[slots.queue].length > 0);
        const valueWithSize = container[slots.queue].shift();
        container[slots.queueTotalSize] -= valueWithSize.size;
        container[slots.queueTotalSize] = Math.max(0, container[slots.queueTotalSize]);
        return valueWithSize.value;
    },
    enqueueValueWithSize(container, value, size) {
        assert?.(slots.queue in container && slots.queueTotalSize in container);
        if (!isFinite(size) || size < 0) {
            throw RangeError(`The return value of a queuing strategy's size function must be a finite, non-NaN, non-negative number`);
        }
        container[slots.queue].push({ value, size });
        container[slots.queueTotalSize] += size;
    },
    ensureReadableWritablePair(transform) {
        if (transform !== Object(transform)) {
            throw spec.createNewTypeError('Invalid transform: not an object');
        }
        const missing = [];
        if (!('readable' in transform)) {
            missing.push('readable');
        } else if (!this.isReadableStream(transform.readable)) {
            throw spec.createNewTypeError('Invalid transform: member `readable` is not a `ReadableStream`');
        }
        if (!('writable' in transform)) {
            missing.push('writable');
        } else if (!this.isWritableStream(transform.writable)) {
            throw spec.createNewTypeError('Invalid transform: member `writable` is not a `WritableStream`');
        }
        if (missing.length > 0) {
            throw spec.createNewTypeError(`Invalid transform: missing required member: ${missing.join(', ')}`);
        }
    },
    extractHighWaterMark(strategy, defaultHWM) {
        if (strategy.highWaterMark == null) {
            return defaultHWM;
        }
        const highWaterMark = Number(strategy.highWaterMark);
        if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 0) {
            throw this.createNewRangeError('Invalid `strategy.highWaterMark`, expected valid non-negative integer');
        }
        return highWaterMark;
    },
    extractSizeAlgorithm(strategy) {
        if (strategy.size == null) {
            return () => 1;
        }
        if (typeof strategy.size !== 'function') {
            throw this.createNewTypeError('`strategy.size` is not a function');
        }
        const size = strategy.size.bind(strategy);
        return chunk => size(chunk);
    },
    initializeReadableStream(stream) {
        stream[slots.state] = 'readable';
        stream[slots.reader] = stream[slots.storedError] = null;
        stream[slots.disturbed] = false;
    },
    initializeTransformStream(stream, startAsync, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm) {
        const startAlgorithm = () => startAsync.promise;
        const writeAlgorithm = chunk => this.transformStreamDefaultSinkWriteAlgorithm(stream, chunk);
        const abortAlgorithm = reason => this.transformStreamDefaultSinkAbortAlgorithm(stream, reason);
        const closeAlgorithm = () => this.transformStreamDefaultSinkCloseAlgorithm(stream);
        stream[slots.writable] = this.createWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, writableHighWaterMark, writableSizeAlgorithm);
        const pullAlgorithm = () => this.transformStreamDefaultSourcePullAlgorithm(stream);
        const cancelAlgorithm = async reason => { this.transformStreamErrorWritableAndUnblockWrite(stream, reason); };
        stream[slots.readable] = this.createReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, readableHighWaterMark, readableSizeAlgorithm);
        stream[slots.backpressure] = null;
        stream[slots.backpressureChangeAsync] = null;
        this.transformStreamSetBackpressure(stream, true);
        stream[slots.controller] = null;
    },
    initializeWritableStream(stream) {
        stream[slots.state] = 'writable';
        stream[slots.storedError] = null;
        stream[slots.writer] = null;
        stream[slots.controller] = null;
        stream[slots.inFlightWriteRequest] = null;
        stream[slots.closeRequest] = null;
        stream[slots.inFlightCloseRequest] = null;
        stream[slots.pendingAbortRequest] = null;
        stream[slots.writeRequests] = [];
        stream[slots.backpressure] = false;
    },
    isAbortSignal(signal) {
        let object = signal;
        const descriptors = Object.create(null);
        const names = ['aborted', 'addEventListener', 'removeEventListener'];
        while (object != null) {
            for (const name of names) {
                if (name in descriptors) {
                    continue;
                }
                const descriptor = Object.getOwnPropertyDescriptor(object, name);
                if (descriptor != null) {
                    descriptors[name] = descriptor;
                }
            }
            object = Object.getPrototypeOf(object);
        }
        if (!names.every(name => name in descriptors)) {
            return false;
        }
        return typeof descriptors.aborted.get === 'function' && descriptors.addEventListener.value === 'function' && descriptors.removeEventListener.value === 'function';
    },
    isReadableStream(maybeStream) {
        return maybeStream instanceof ReadableStream;
    },
    isReadableStreamLocked(stream) {
        return stream[slots.reader] != null;
    },
    isTransformStream(maybeStream) {
        return maybeStream instanceof TransformStream;
    },
    isTransformerSupportedTypes(readableType, writableType) {
        return readableType == null && writableType == null;
    },
    isUnderlyingSourceSupportedType(type) {
        return type == null || type === 'bytes';
    },
    isUnderlyingSinkSupportedType(type) {
        return type == null;
    },
    isWritableStream(maybeStream) {
        return maybeStream instanceof WritableStream;
    },
    isWritableStreamLocked(stream) {
        return stream[slots.writer] != null;
    },
    makeUnderlyingSinkDict(sink) {
        const result = {};
        if (sink != null && sink !== Object(sink)) {
            throw this.createNewTypeError('`underlyingSink` is not an object');
        }
        for (const name of ['start', 'write', 'close', 'abort']) {
            const value = sink[name];
            if (value != null) {
                if (typeof value !== 'function') {
                    throw this.createNewTypeError(`\`underlyingSink.${name}\` is not a function`);
                }
                result[name] = value;
            }
        }
        const type = sink.type;
        if (type != null) {
            if (!this.isUnderlyingSinkSupportedType(type)) {
                throw this.createNewTypeError('Invalid `underlyingSink.type`: the specified type is not supported');
            }
            result.type = type;
        }
    },
    makeUnderlyingSourceDict(source) {
        const result = {
            type: null
        };
        if (source == null) {
            source = {};
        }
        if (source !== Object(source)) {
            throw this.createNewTypeError('`underlyingSource` is not an object');
        }
        for (const name of ['start', 'pull', 'cancel']) {
            const value = source[name];
            if (value != null) {
                if (typeof value !== 'function') {
                    throw this.createNewTypeError(`\`underlyingSource.${name}\` is not a function`);
                }
                result[name] = source[name];
            }
        }
        {
            const autoAllocateChunkSize = source.autoAllocateChunkSize;
            if (autoAllocateChunkSize != null) {
                if (!Number.isSafeInteger(autoAllocateChunkSize)) {
                    throw this.createNewTypeError(`The option [underlyingSource.autoAllocateChunkSize] must be an integer, if present`);
                }
                result.autoAllocateChunkSize = autoAllocateChunkSize;
            }
        }
        const type = source.type;
        if (!this.isUnderlyingSourceSupportedType(source.type)) {
            throw this.createNewTypeError('Invalid `underlyingSource.type`: the specified type is not supported');
        }
        if (type != null) {
            result.type = type;
        }
        return result;
    },
    makeUnderlyingTransformerDict(transformer) {
        const result = {
            readableType: null,
            writableType: null
        };
        if (transformer == null) {
            transformer = {};
        }
        if (transformer !== Object(transformer)) {
            throw this.createNewTypeError('`underlyingTransformer` is not an object');
        }
        for (const name of ['start', 'transform', 'flush']) {
            const value = transformer[name];
            if (value != null) {
                if (typeof value !== 'function') {
                    throw this.createNewTypeError(`\`underlyingTransformer.${name}\` is not a function`);
                }
                result[name] = transformer[name];
            }
        }
        result.readableType = transformer.readableType ?? null;
        result.writableType = transformer.writableType ?? null;
        if (!this.isTransformerSupportedTypes(readableType, writableType)) {
            throw new RangeError('The `readableType` and `writableType` options are not currently supported and should not exists or set to null/undefined');
        }
        return result;
    },
    peekQueueValue(container) {
        assert?.(slots.queue in container && slots.queueTotalSize in container);
        assert?.(container[slots.queue].length > 0);
        const valueWithSize = container[slots.queue][0];
        return valueWithSize.value;
    },
    promiseIsHandled(promise) {
        // Prevent "unhandled rejection", equivalent to [[PromiseIsHandled]] = true;
        promise.catch(() => {});
    },
    readableByteStreamControllerCallPullIfNeeded(controller) {
        const shouldPull = this.readableByteStreamControllerShouldCallPull(controller);
        if (!shouldPull) {
            return;
        }
        if (controller[slots.pulling]) {
            controller[slots.pullAgain] = true;
            return;
        }
        assert?.(controller[slots.pullAgain] === false);
        controller[slots.pulling] = true;
        controller[slots.pullAlgorithm](controller).then(() => {
            controller[slots.pulling] = false;
            if (controller[slots.pullAgain]) {
                controller[slots.pullAgain] = false;
                this.readableByteStreamControllerCallPullIfNeeded(controller);
            }
        }, e => {
            this.readableByteStreamControllerError(controller, e);
        });
    },
    readableByteStreamControllerCanCloseOrEnqueue(controller) {
        return !controller[slots.closeRequested] && controller[slots.stream][slots.state] === 'readable';
    },
    readableByteStreamControllerClearAlgorithms(controller) {
        controller[slots.pullAlgorithm] = null;
        controller[slots.cancelAlgorithm] = null;
    },
    readableByteStreamControllerClearPendingPullIntos(controller) {
        this.readableByteStreamControllerInvalidateBYOBRequest(controller);
        controller[slots.pendingPullIntos] = [];
    },
    readableByteStreamControllerClose(controller) {
        const stream = controller[slots.stream];
        if (controller[slots.closeRequested] || stream[slots.state] !== 'readable') {
            return;
        }
        if (controller[slots.queueTotalSize] > 0) {
            controller[slots.closeRequested] = true;
            return;
        }
        if (controller[slots.pendingPullIntos].length > 0) {
            const firstPendingPullInto = controller[slots.pendingPullIntos][0];
            if (firstPendingPullInto.bytesFilled > 0) {
                const e = this.createNewTypeError('Insufficient bytes to fill elements in the given buffer');
                this.readableByteStreamControllerError(controller, e);
                throw e;
            }
        }
        this.readableByteStreamControllerClearAlgorithms(controller);
        this.readableStreamClose(stream);
    },
    readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor) {
        const bytesFilled = pullIntoDescriptor.bytesFilled;
        const elementSize = pullIntoDescriptor.elementSize;
        assert?.(pullIntoDescriptor.bytesFilled <= pullIntoDescriptor.byteLength);
        assert?.(bytesFilled % elementSize === 0);
        // Here we cannot use the pullIntoDescriptor data as intended, but the general idea is to create a view
        // for the existing buffer, with the same type as the provided view, which is only possible for aligned elements.
        // To do this, we need to compute the aligned byte elements first:
        const byteLength = bytesFilled - bytesFilled % elementSize; // Equivalen of Math.floor(bytesFilled / elementSize) * elementSize;
        return this.createNew(pullIntoDescriptor.ViewConstructor, pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, byteLength);
    },
    readableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor) {
        assert?.(stream[slots.state] !== 'errored');
        let done = false;
        if (stream[slots.state] === 'closed') {
            assert?.(pullIntoDescriptor.bytesFilled === 0);
            done = true;
        }
        const filledView = this.readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);
        if (pullIntoDescriptor.readerType === 'default') {
            this.readableStreamFulfillReadRequest(stream, filledView, done);
        } else {
            assert?.(pullIntoDescriptor.readerType === 'byob');
            this.readableStreamFulfillReadIntoRequest(stream, filledView, done);
        }
    },
    readableByteStreamControllerEnqueue(controller, chunk) {
        if (!this.readableByteStreamControllerCanCloseOrEnqueue(controller)) {
            return;
        }
        const buffer = chunk.buffer;
        const byteOffset = chunk.byteOffset;
        const byteLength = chunk.byteLength;
        const transferredBuffer = this.transferArrayBuffer(buffer);
        const stream = controller[slots.stream];
        if (this.readableStreamHasDefaultReader(stream)) {
            if (this.readableStreamGetNumReadRequests(stream) === 0) {
                this.readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
            } else {
                assert?.(controller[slots.queue].length <= 0);
                const transferredView = this.createNew(Uint8Array, transferredBuffer, byteOffset, byteLength);
                this.readableStreamFulfillReadRequest(stream, transferredView, false);
            }
        } else if (this.readableStreamHasBYOBReader(stream)) {
            this.readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
            this.readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
        } else {
            assert?.(!this.isReadableStreamLocked(stream));
            this.readableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
        }
        this.readableByteStreamControllerCallPullIfNeeded(controller);
    },
    readableByteStreamControllerEnqueueChunkToQueue(controller, buffer, byteOffset, byteLength) {
        controller[slots.queue].push({ buffer, byteOffset, byteLength });
        controller[slots.queueTotalSize] += byteLength;
    },
    readableByteStreamControllerError(controller, e) {
        const stream = controller[slots.stream];
        if (stream[slots.state] !== 'readable') {
            return;
        }
        this.readableByteStreamControllerClearPendingPullIntos(controller);
        this.resetQueue(controller);
        this.readableByteStreamControllerClearAlgorithms(controller);
        this.readableStreamError(stream, e);
    },
    readableByteStreamControllerFillHeadPullIntoDescriptor(controller, size, pullIntoDescriptor) {
        assert?.(controller[slots.pendingPullIntos].length === 0 || controller[slots.pendingPullIntos][0] === pullIntoDescriptor);
        this.readableByteStreamControllerInvalidateBYOBRequest(controller);
        pullIntoDescriptor.bytesFilled += size;
    },
    readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) {
        const elementSize = pullIntoDescriptor.elementSize;
        const currentAlignedBytes = pullIntoDescriptor.bytesFilled - (pullIntoDescriptor.bytesFilled % elementSize);
        const maxBytesToCopy = Math.min(controller[slots.queueTotalSize], pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled);
        const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
        const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % elementSize);
        let totalBytesToCopyRemaining = maxBytesToCopy;
        let ready = false;
        if (maxAlignedBytes > currentAlignedBytes) {
            totalBytesToCopyRemaining = maxAlignedBytes - pullIntoDescriptor.bytesFilled;
            ready = true;
        }
        const queue = controller[slots.queue];
        while (totalBytesToCopyRemaining > 0) {
            assert?.(queue.length > 0);
            const headOfQueue = queue[0];
            const bytesToCopy = Math.min(totalBytesToCopyRemaining, headOfQueue.byteLength);
            const destStart = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
            // Again, the standard requires accessing ECMAScript internal slots to copy a block of data.
            // We use TypedArray.prototype.set instead, which defined by the standad should be much slower.
            // However, V8 optimizations reduce it (after some checks) to C memmove() function if the types are compatible.

            // To call set on limited bytesToCopy we need to construct a view, since we cannot specify the byteLength.
            const sourceView = this.createNew(pullIntoDescriptor.ByteConstructor, headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy);
            const targetView = this.createNew(pullIntoDescriptor.ByteConstructor, pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, pullIntoDescriptor.byteLength);
            targetView.set(sourceView, destStart); // Optimized to checks + cmemmove()

            if (headOfQueue.byteLength === bytesToCopy) {
                queue.shift();
            } else {
                headOfQueue.byteOffset += bytesToCopy;
                headOfQueue.byteLength -= bytesToCopy;
            }
            controller[slots.queueTotalSize] -= bytesToCopy;
            this.readableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesToCopy, pullIntoDescriptor);
            totalBytesToCopyRemaining -= bytesToCopy;
        }
        // if ready is false check contains only assert statements, so we combine it, essentially removing it, when assert is not on.
        assert?.(
            ready
                ? true
                : controller[slots.queueTotalSize] === 0 &&
                pullIntoDescriptor.bytesFilled > 0 &&
                pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize
        );
        return ready;
    },
    readableByteStreamControllerGetDesiredSize(controller) {
        const state = controller[slots.stream][slots.state];
        if (state === 'errored') {
            return null;
        }
        if (state === 'closed') {
            return 0;
        }
        return controller[slots.strategyHWM] - controller[slots.queueTotalSize];
    },
    readableByteStreamControllerHandleQueueDrain(controller) {
        assert?.(controller[slots.stream][slots.state] === 'readable');
        if (controller[slots.queueTotalSize] === 0 && controller[slots.closeRequested]) {
            this.readableByteStreamControllerClearAlgorithms(controller);
            this.readableStreamClose(controller[slots.stream]);
        } else {
            this.readableByteStreamControllerCallPullIfNeeded(controller);
        }
    },
    readableByteStreamControllerInvalidateBYOBRequest(controller) {
        if (controller[slots.byobRequest] == null) {
            return;
        }
        controller[slots.byobRequest][slots.controller] = null;
        controller[slots.byobRequest][slots.view] = null;
        controller[slots.byobRequest] = null;
    },
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller) {
        assert?.(controller[slots.closeRequested] === false);
        while (controller[slots.pendingPullIntos].length > 0) {
            if (controller[slots.queueTotalSize] === 0) {
                return;
            }
            const pullIntoDescriptor = controller[slots.pendingPullIntos][0];
            if (this.readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
                this.readableByteStreamControllerShiftPendingPullInto(controller);
                this.readableByteStreamControllerCommitPullIntoDescriptor(controller[slots.stream], pullIntoDescriptor);
            }
        }
    },
    readableByteStreamControllerPullInto(controller, view, readIntoRequest) {
        const stream = controller[slots.stream];
        let elementSize = 1;
        let ArrayBufferView = DataView;
        if (!(view instanceof DataView)) {
            assert?.(Number.isSafeInteger(view.BYTES_PER_ELEMENT));
            elementSize = view.BYTES_PER_ELEMENT;
            let v = Object.getPrototypeOf(view);
            do {
                if (this.typedArrayTable.has(v)) {
                    ArrayBufferView = this.typedArrayTable.get(v);
                    break;
                }
                v = Object.getPrototypeOf(v);
            } while (v != null);
        }
        const byteOffset = view.byteOffset;
        const byteLength = view.byteLength;
        const buffer = this.transferArrayBuffer(view.buffer);
        const pullIntoDescriptor = {
            buffer,
            byteOffset,
            byteLength,
            bytesFilled: 0,
            elementSize,
            ViewConstructor: ArrayBufferView,
            readerType: 'byob'
        };
        if (view instanceof DataView) {
            pullIntoDescriptor.ByteConstructor = Uint8Array;
        } else {
            pullIntoDescriptor.ByteConstructor = pullIntoDescriptor.ViewConstructor;
        }
        if (controller[slots.pendingPullIntos].length > 0) {
            controller[slots.pendingPullIntos].push(pullIntoDescriptor);
            this.readableStreamAddReadIntoRequest(stream, readIntoRequest);
            return;
        }
        if (stream[slots.state] === 'closed') {
            const emptyView = this.createNew(ArrayBufferView, this.createNew(ArrayBuffer, 0));
            readIntoRequest.closeSteps(emptyView);
            return;
        }
        if (controller[slots.queueTotalSize] > 0) {
            if (this.readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
                const filledView = this.readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);
                this.readableByteStreamControllerHandleQueueDrain(controller);
                readIntoRequest.chunkSteps(filledView);
                return;
            }
            if (controller[slots.closeRequested]) {
                const e = this.createNewTypeError('Insufficient bytes to fill elements in the given buffer');
                this.readableByteStreamControllerError(controller, e);
                readIntoRequest.errorSteps(e);
                return;
            }
        }
        controller[slots.pendingPullIntos].push(pullIntoDescriptor);
        this.readableStreamAddReadIntoRequest(stream, readIntoRequest);
        this.readableByteStreamControllerCallPullIfNeeded(controller);
    },
    readableByteStreamControllerRespond(controller, bytesWritten) {
        assert?.(controller[slots.pendingPullIntos].length > 0);
        this.readableByteStreamControllerRespondInternal(controller, bytesWritten);
    },
    readableByteStreamControllerRespondInClosedState(controller, firstDescriptor) {
        firstDescriptor.buffer = this.transferArrayBuffer(firstDescriptor.buffer);
        assert?.(firstDescriptor.bytesFilled === 0);
        const stream = controller[slots.stream];
        if (this.readableStreamHasDefaultReader(stream)) {
            while (this.readableStreamGetNumReadIntoRequests(stream) > 0) {
                const pullIntoDescriptor = this.readableByteStreamControllerShiftPendingPullInto(controller);
                this.readableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor);
            }
        }
    },
    readableByteStreamControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor) {
        if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
            throw this.createNewRangeError('bytesWritten out of range');
        }
        this.readableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesWritten, pullIntoDescriptor);
        if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
            return;
        }
        this.readableByteStreamControllerShiftPendingPullInto(controller);
        const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
        if (remainderSize > 0) {
            const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
            const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, remainderSize);
            this.readableByteStreamControllerEnqueueChunkToQueue(controller, remainder, 0, remainder.byteLength);
        }
        pullIntoDescriptor.buffer = this.transferArrayBuffer(pullIntoDescriptor.buffer);
        pullIntoDescriptor.bytesFilled -= remainderSize;
        this.readableByteStreamControllerCommitPullIntoDescriptor(controller[slots.stream], pullIntoDescriptor);
        this.readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
    },
    readableByteStreamControllerRespondInternal(controller, bytesWritten) {
        const firstDescriptor = controller[slots.pendingPullIntos][0];
        const state = controller[slots.stream][slots.state];
        if (state === 'closed') {
            if (bytesWritten > 0) {
                throw this.createNewTypeError('bytesWritten must be 0 when calling respond() on a closed stream');
            }
            this.readableByteStreamControllerRespondInClosedState(controller, firstDescriptor);
        } else {
            assert?.(state === 'readable');
            this.readableByteStreamControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
        }
        this.readableByteStreamControllerCallPullIfNeeded(controller);
    },
    readableByteStreamControllerRespondWithNewView(controller, view) {
        assert?.(controller[slots.pendingPullIntos].length > 0);
        const firstDescriptor = controller[slots.pendingPullIntos][0];
        if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== view.byteOffset) {
            throw this.createNewRangeError('The region specified by view does not match byobRequest');
        }
        if (view.byteLength > firstDescriptor.byteLength) {
            throw this.createNewRangeError('The buffer of view exceeds the capacity than byobRequest');
        }
        // This is a strange function, the new view seems to suppose to be in the same buffer...
        // There are three ways to handle a request by the underlyingSource:
        // 1. Call the controller.enqueue(buffer/view): usable when a buffer is created by the underlying data source.
        // 2. Get the byobRequest if any (if not, do 1), and pass the provided buffer to the underlying data source pulling function,
        // for example, fs.read() requires a buffer to fill data into. Usually those function takes buffer and capacity and returns
        // the actual bytes writter. byobRequest.response() reports how many bytes were actually written.
        // 3. Respond with a new view, this seems to require to be a view within the same buffer, but the idea is in case of JavaSctipt
        // processing yielding data, the data can be in different view from the one provided by the byobRequest. For example,
        // a processor might already have a DataView to write data into the buffer. In this case it is possible the following statement
        // should not be possible.
        firstDescriptor.buffer = view.buffer;
        this.readableByteStreamControllerRespondInternal(controller, view.byteLength);
    },
    readableByteStreamControllerShiftPendingPullInto(controller) {
        const descriptor = controller[slots.pendingPullIntos].shift();
        this.readableByteStreamControllerInvalidateBYOBRequest(controller);
        return descriptor;
    },
    readableByteStreamControllerShouldCallPull(controller) {
        const stream = controller[slots.stream];
        if (stream[slots.state] !== 'readable') {
            return false;
        }
        if (controller[slots.closeRequested]) {
            return false;
        }
        if (!controller[slots.started]) {
            return false;
        }
        if (this.readableStreamHasDefaultReader(stream) && this.readableStreamGetNumReadRequests(stream) > 0) {
            return true;
        }
        if (this.readableStreamHasBYOBReader(stream) && this.readableStreamGetNumReadIntoRequests(stream) > 0) {
            return true;
        }
        const desiredSize = this.readableByteStreamControllerGetDesiredSize(controller);
        assert?.(desiredSize != null);
        return desiredSize > 0;
    },
    readableStreamAddReadRequest(stream, readRequest) {
        assert?.(stream[slots.reader] instanceof ReadableStreamDefaultReader);
        assert?.(stream[slots.state] === 'readable');
        stream[slots.reader][slots.readRequests].push(readRequest);
    },
    readableStreamAddReadIntoRequest(stream, readRequest) {
        assert?.(stream[slots.reader] instanceof ReadableStreamBYOBReader);
        assert?.(stream[slots.state] === 'readable' || stream[slots.state] === 'closed');
        stream[slots.reader][slots.readIntoRequests].push(readRequest);
    },
    readableStreamAsyncIteratorInit(stream, options) {
        const reader = this.acquireReadableStreamDefaultReader(stream);
        const iterator = Object.create(this.ReadableStreamAsyncIteratorPrototype, {
            next: {
                configurable: true,
                writable: true,
                value: function next() {
                    return spec.readableStreamAsyncIteratorNext(stream, this);
                }
            },
            return: {
                configurable: true,
                writable: true,
                value: function (value) {
                    return spec.readableStreamAsyncIteratorReturn(stream, this, value);
                }
            }
        });
        iterator[slots.reader] = reader;
        iterator[slots.preventCancel] = Boolean(options.preventCancel);
        iterator[slots.pendingIteration] = null;
        iterator[slots.finished] = false;
        return iterator;
    },
    readableStreamAsyncIteratorNext(stream, iterator) {
        const nextSteps = async () => {
            if (iterator[slots.finished]) {
                return { value: undefined, done: true };
            }
            return this.readableStreamAsyncIteratorNextStep(stream, iterator).then(result => {
                iterator[slots.pendingIteration] = null;
                if (result.done) {
                    iterator[slots.finished] = true;
                }
                return result;
            }, reason => {
                iterator[slots.pendingIteration] = null;
                iterator[slots.finished] = true;
                throw reason;
            });
        };
        iterator[slots.pendingIteration] = iterator[slots.pendingIteration] != null
            ? iterator[slots.pendingIteration].then(nextSteps, nextSteps)
            : nextSteps();
        return iterator[slots.pendingIteration];
    },
    async readableStreamAsyncIteratorNextStep(stream, iterator) {
        const reader = iterator[slots.reader];
        if (reader[slots.stream] == null) {
            throw this.createNewTypeError('Cannot get the next iteration result once the reader has been released');
        }
        const readRequest = this.createAsync({
            chunkSteps: chunk => {
                readRequest.fulfill({ value: chunk, done: false });
            },
            closeSteps: () => {
                this.readableStreamReaderGenericRelease(reader);
                readRequest.fulfill({ value: undefined, done: true });
            },
            errorSteps: e => {
                this.readableStreamReaderGenericRelease(reader);
                readRequest.reject(e);
            }
        });
        return readRequest.promise;
    },
    readableStreamAsyncIteratorReturn(stream, iterator, value) {
        const returnSteps = async () => {
            if (iterator[slots.finished]) {
                return { value: undefined, done: true };
            }
            iterator[slots.finished] = true;
            return this.readableStreamAsyncIteratorReturnStep(stream, iterator, value);
        };
        iterator[slots.pendingIteration] = iterator[slots.pendingIteration] != null
            ? iterator[slots.pendingIteration].then(returnSteps, returnSteps)
            : returnSteps();
        return iterator[slots.pendingIteration].then(() => ({ value, done: true }));
    },
    readableStreamAsyncIteratorReturnStep(stream, iterator, value) {
        const reader = iterator[slots.reader];
        if (reader[slots.stream] == null) {
            return;
        }
        // Async iterator guarantees all promises for the iterations has been resolved.
        assert?.(reader[slots.readRequests].length <= 0);
        if (!iterator[slots.preventCancel]) {
            const result = this.readableStreamReaderGenericCancel(reader, value);
            this.readableStreamReaderGenericRelease(reader);
            return result;
        }
        this.readableStreamReaderGenericRelease(reader);
    },
    readableStreamBYOBReaderRead(reader, view, readIntoRequest) {
        const stream = reader[slots.stream];
        assert?.(stream != null);
        stream[slots.disturbed] = true;
        if (stream[slots.state] === 'errored') {
            readIntoRequest.errorSteps(stream[slots.storedError]);
        } else {
            this.readableByteStreamControllerPullInto(stream[slots.controller], view, readIntoRequest);
        }
    },
    async readableStreamCancel(stream, reason) {
        stream[slots.disturbed] = true;
        if (stream[slots.state] === 'closed') {
            return;
        }
        if (stream[slots.state] === 'errored') {
            throw stream[slots.storedError];
        }
        this.readableStreamClose(stream);
        await stream[slots.controller][slots.cancelSteps](reason);
    },
    readableStreamContruct(stream, source = null, strategy = {}) {
        const sourceDict = this.makeUnderlyingSourceDict(source);
        if (strategy == null) {
            strategy = {};
        }
        if (strategy !== Object(strategy)) {
            throw this.createNewTypeError('Invalid strategy: not an object');
        }
        this.initializeReadableStream(stream);
        this.readableStreamContructByType(stream, sourceDict, source, strategy);
    },
    readableStreamContructByType(stream, sourceDict, source, strategy) {
        if (sourceDict.type === 'bytes') {
            if (strategy.size != null) {
                throw this.createNewRangeError(`The strategy for a byte stream cannot have a size function`);
            }
            const highWaterMark = this.extractHighWaterMark(strategy, 0);
            this.setUpReadableByteStreamControllerFromUnderlyingSource(stream, source, sourceDict, highWaterMark);
        } else {
            const sizeAlgorithm = this.extractSizeAlgorithm(strategy);
            const highWaterMark = this.extractHighWaterMark(strategy, 1);
            this.setUpReadableStreamDefaultControllerFromUnderlyingSource(stream, source, sourceDict, highWaterMark, sizeAlgorithm);
        }
    },
    readableStreamClose(stream) {
        assert?.(stream[slots.state] === 'readable');
        stream[slots.state] = 'closed';
        const reader = stream[slots.reader];
        if (reader == null) {
            return;
        }
        reader[slots.closedAsync].fulfill();
        if (reader instanceof ReadableStreamDefaultReader) {
            for (const readRequest of reader[slots.readRequests]) {
                readRequest.closeSteps();
            }
            reader[slots.readRequests] = [];
        }
    },
    readableStreamDefaultControllerCallPullIfNeeded(controller) {
        const shouldPull = this.readableStreamDefaultControllerShouldCallPull(controller);
        if (!shouldPull) {
            return;
        }
        if (controller[slots.pulling]) {
            controller[slots.pullAgain] = true;
            return;
        }
        assert?.(controller[slots.pullAgain] === false);
        controller[slots.pulling] = true;
        controller[slots.pullAlgorithm](controller).then(() => {
            // Return value ignored, the user provided pull function should use controller.enqueue() to add chunks.
            controller[slots.pulling] = false;
            if (controller[slots.pullAgain]) {
                controller[slots.pullAgain] = false;
                this.readableStreamDefaultControllerCallPullIfNeeded(controller);
            }
        }, e => {
            this.readableStreamDefaultControllerError(controller, e);
        });
    },
    readableStreamDefaultControllerCanCloseOrEnqueue(controller) {
        return !controller[slots.closeRequested] && controller[slots.stream][slots.state] === 'readable';
    },
    readableStreamDefaultControllerClearAlgorithms(controller) {
        controller[slots.pullAlgorithm] = null;
        controller[slots.cancelAlgorithm] = null;
        controller[slots.strategySizeAlgorithm] = null;
    },
    readableStreamDefaultControllerClose(controller) {
        if (!this.readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
            return;
        }
        const stream = controller[slots.stream];
        controller[slots.closeRequested] = true;
        if (controller[slots.queue].length <= 0) {
            this.readableStreamDefaultControllerClearAlgorithms(controller);
            this.readableStreamClose(stream);
        }
    },
    readableStreamDefaultControllerEnqueue(controller, chunk) {
        if (!this.readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
            return;
        }
        const stream = controller[slots.stream];
        if (this.isReadableStreamLocked(stream) && this.readableStreamGetNumReadRequests(stream) > 0) {
            this.readableStreamFulfillReadRequest(stream, chunk, false);
        } else {
            const chunkSize = (() => {
                try {
                    return controller[slots.strategySizeAlgorithm]();
                } catch (error) {
                    this.readableStreamDefaultControllerError(controller, error);
                    throw error; // Errors caught in the sizeAlgorithm user-provided function
                    // must be caught and result in an errored stream with that error.
                    // However, they must also propagate back to the underlying source.
                    // For example, if we have a NodeJS stream and this stream, error in sizeAlgorithm
                    // will make this stream fail, but it is up to the underlying source to make the NodeJS stream fail.
                }
            })();
            try {
                this.enqueueValueWithSize(controller, chunk, chunkSize);
            } catch (error) {
                this.readableStreamDefaultControllerError(controller, error);
                throw error;
            }
        }
        this.readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    readableStreamDefaultControllerError(controller, e) {
        const stream = controller[slots.stream];
        if (stream[slots.state] !== 'readable') {
            return;
        }
        this.resetQueue(controller);
        this.readableStreamDefaultControllerClearAlgorithms(controller);
        this.readableStreamError(stream, e);
    },
    readableStreamDefaultControllerGetDesiredSize(controller) {
        const state = controller[slots.stream][slots.state];
        if (state === 'errored') {
            return null;
        }
        if (state === 'closed') {
            return 0;
        }
        return controller[slots.strategyHWM] - controller[slots.queueTotalSize];
    },
    readableStreamDefaultControllerShouldCallPull(controller) {
        if (!this.readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
            return false;
        }
        if (!controller[slots.started]) {
            return false;
        }
        const stream = controller[slots.stream];
        if (this.isReadableStreamLocked(stream) && this.readableStreamGetNumReadRequests(stream) > 0) {
            return true;
        }
        const desiredSize = this.readableStreamDefaultControllerGetDesiredSize(controller);
        assert?.(desiredSize != null);
        return desiredSize > 0;
    },
    readableStreamDefaultReaderRead(reader, readRequest) {
        const stream = reader[slots.stream];
        assert?.(stream != null);
        stream[slots.disturbed] = true;
        const state = stream[slots.state];
        if (state === 'closed') {
            readRequest.closeSteps();
        } else if (state === 'errored') {
            readRequest.errorSteps(stream[slots.storedError]);
        } else {
            assert?.(state === 'readable');
            stream[slots.controller][slots.pullSteps](readRequest);
        }
    },
    readableStreamError(stream, e) {
        assert?.(stream[slots.state] === 'readable');
        stream[slots.state] = 'errored';
        stream[slots.storedError] = e;
        const reader = stream[slots.reader];
        if (reader == null) {
            return;
        }
        reader[slots.closedAsync].reject(e);
        this.promiseIsHandled(reader[slots.closedAsync].promise);
        if (reader instanceof ReadableStreamDefaultReader) {
            for (const readRequest of reader[slots.readRequests]) {
                readRequest.errorSteps(e);
            }
            reader[slots.readRequests] = [];
        } else {
            assert?.(reader instanceof ReadableStreamBYOBReader);
            for (const readIntoRequest of reader[slots.readIntoRequests]) {
                readIntoRequest.errorSteps(e);
            }
            reader[slots.readIntoRequests] = [];
        }
    },
    readableStreamFulfillReadIntoRequest(stream, chunk, done) {
        assert?.(this.readableStreamHasBYOBReader(stream));
        const reader = stream[slots.reader];
        assert?.(reader[slots.readIntoRequests].length > 0);
        const readIntoRequest = reader[slots.readIntoRequests].shift();
        if (done) {
            readIntoRequest.closeSteps(chunk);
        } else {
            readIntoRequest.chunkSteps(chunk);
        }
    },
    readableStreamFulfillReadRequest(stream, chunk, done) {
        assert?.(this.readableStreamHasDefaultReader(stream));
        const reader = stream[slots.reader];
        assert?.(reader[slots.readRequests].length > 0);
        const readRequest = reader[slots.readRequests].shift();
        if (done) {
            readRequest.closeSteps();
        } else {
            readRequest.chunkSteps(chunk);
        }
    },
    readableStreamGetNumReadIntoRequests(stream) {
        assert?.(this.readableStreamHasBYOBReader(stream) === true);
        return stream[slots.reader][slots.readIntoRequests].length;
    },
    readableStreamGetNumReadRequests(stream) {
        assert?.(this.readableStreamHasDefaultReader(stream) === true);
        return stream[slots.reader][slots.readRequests].length;
    },
    readableStreamGetReader(stream, options = {}) {
        if (options == null) {
            options = {};
        } else if (options !== Object(options)) {
            throw this.createNewTypeError('Invalid options: cannot convert to dictionary');
        }
        const mode = options.mode;
        let byob = false;
        if (mode != null) {
            if (mode !== 'byob') {
                throw this.createNewTypeError(`The option [mode] must be exactly the string "byob", if present`);
            }
            byob = true;
        }
        return byob ? this.acquireReadableStreamBYOBReader(stream) : this.acquireReadableStreamDefaultReader(stream);
    },
    readableStreamHasBYOBReader(stream) {
        const reader = stream[slots.reader];
        if (reader == null) {
            return false;
        }
        return reader instanceof ReadableStreamBYOBReader;
    },
    readableStreamHasDefaultReader(stream) {
        const reader = stream[slots.reader];
        if (reader == null) {
            return false;
        }
        return reader instanceof ReadableStreamDefaultReader;
    },
    readableStreamPipeIsOrBecomesErrored(stream, promise, action) {
        if (stream[slots.state] === 'errored') {
            action(stream[slots.storedError]);
        } else {
            promise.catch(action);
        }
    },
    readableStreamPipeIsOrBecomesClosed(stream, promise, action) {
        if (stream[slots.state] === 'closed') {
            action();
        } else {
            promise.then(action);
        }
    },
    async readableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel, signal) {
        assert?.(source instanceof ReadableStream);
        assert?.(dest instanceof WritableStream);
        assert?.(typeof preventClose === 'boolean');
        assert?.(typeof preventAbort === 'boolean');
        assert?.(typeof preventCancel === 'boolean');
        assert?.(
            signal == null ||
            typeof signal === 'object' &&
            'aborted' in signal &&
            typeof signal.addEventListener === 'function' &&
            typeof signal.removeEventListener === 'function'
        );
        assert?.(!this.isReadableStreamLocked(source));
        assert?.(!this.isWritableStreamLocked(dest));
        const reader = this.acquireReadableStreamDefaultReader(source);
        const writer = this.acquireWritableStreamDefaultWriter(dest);
        source[slots.disturbed] = true;
        const shuttingDown = false;
        const pipeRequest = this.createAsync();
        if (signal != null) {
            const abortAlgorithm = () => {
                const error = this.createNewAbortError('Pipe operation was aborted');
                const actions = [];
                if (!preventAbort) {
                    actions.push(async () => {
                        if (dest.state === 'writable') {
                            return this.writableStreamAbort(dest, error);
                        }
                    });
                }
                if (!preventCancel) {
                    actions.push(async () => {
                        if (source.state === 'readable') {
                            return this.readableStreamCancel(source, error);
                        }
                    });
                }
                this.shutdownWithAction(actions, error);
            };
            if (signal.aborted) {
                abortAlgorithm();
                return pipeRequest.promise;
            }
            signal.addEventListener('abort', abortAlgorithm, { once: true });
        }

        this.readableStreamPipeIsOrBecomesErrored(source, reader[slots.closedAsync].promise, storedError => {
            if (preventAbort) {
                shutdown(true, storedError);
            } else {
                shutdownWithAction(() => this.writableStreamAbort(dest, storedError), true, storedError);
            }
        });

        return pipeRequest.promise;
    },
    readableStreamReaderGenericCancel(reader, reason) {
        const stream = reader[slots.stream];
        assert?.(stream != null);
        return this.readableStreamCancel(stream, reason);
    },
    readableStreamReaderGenericInitialize(reader, stream) {
        reader[slots.stream] = stream;
        stream[slots.reader] = reader;
        if (stream[slots.state] === 'readable') {
            const task = this.createAsync();
            reader[slots.closedAsync] = task;
        } else if (stream[slots.state] === 'closed') {
            stream[slots.closedAsync] = this.createAsyncReturn();
        } else {
            assert?.(stream[slots.state] === 'errored');
            stream[slots.closedAsync] = this.createAsyncThrow(stream[slots.storedError]);
            this.promiseIsHandled(stream[slots.closedAsync].promise);
        }
    },
    readableStreamReaderGenericRelease(reader) {
        assert?.(reader[slots.stream] != null);
        assert?.(reader[slots.stream][slots.reader] === reader);
        if (reader[slots.stream][slots.state] === 'readable') {
            reader[slots.closedAsync].reject(this.createNewTypeError(`Reader was released and can no longer be used to monitor the stream's closedness`));
        } else {
            reader[slots.closedAsync] = this.createAsyncThrow(this.createNewTypeError(`Reader was released and can no longer be used to monitor the stream's closedness`));
        }
        this.promiseIsHandled(reader[slots.closedAsync].promise);
        reader[slots.stream][slots.reader] = null;
        reader[slots.stream] = null;
    },
    resetQueue(container) {
        container[slots.queue] = [];
        container[slots.queueTotalSize] = 0;
    },
    setUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize) {
        assert?.(stream[slots.controller] == null);
        controller[slots.stream] = stream;
        controller[slots.pullAgain] = false;
        controller[slots.pulling] = false;
        controller[slots.byobRequest] = null;
        this.resetQueue(controller);
        controller[slots.closeRequested] = false;
        controller[slots.started] = false;
        controller[slots.started] = false;
        controller[slots.strategyHWM] = highWaterMark;
        controller[slots.pullAlgorithm] = pullAlgorithm;
        controller[slots.cancelAlgorithm] = cancelAlgorithm;
        controller[slots.autoAllocateChunkSize] = autoAllocateChunkSize;
        controller[slots.pendingPullIntos] = [];
        stream[slots.controller] = controller;
        // Called synchrnonously, so exception thrown propagate immediately.
        Promise.resolve(startAlgorithm(controller)).then(() => {
            controller[slots.started] = true;
            assert?.(controller[slots.pulling] === false);
            assert?.(controller[slots.pullAgain] === false);
            this.readableByteStreamControllerCallPullIfNeeded(controller);
        }, reason => {
            this.readableByteStreamControllerError(controller, reason);
        });
    },
    setUpReadableByteStreamControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark) {
        const controller = Object.create(ReadableByteStreamController.prototype);
        let startAlgorithm = () => {};
        let pullAlgorithm = async () => {};
        let cancelAlgorithm = async () => {};
        if (underlyingSourceDict.start != null) {
            startAlgorithm = controller => underlyingSourceDict.start.call(underlyingSource, controller);
        }
        if (underlyingSourceDict.pull != null) {
            pullAlgorithm = async controller => underlyingSourceDict.pull.call(underlyingSource, controller);
        }
        if (underlyingSourceDict.cancel != null) {
            cancelAlgorithm = async reason => underlyingSourceDict.cancel.call(underlyingSource, reason);
        }
        let autoAllocateChunkSize;
        if (underlyingSourceDict.autoAllocateChunkSize != null) {
            autoAllocateChunkSize = underlyingSourceDict.autoAllocateChunkSize;
            if (!Number.isSafeInteger(autoAllocateChunkSize)) {
                throw this.createNewTypeError(`autoAllocateChunkSize must be valid integer`);
            }
            if (autoAllocateChunkSize <= 0) {
                throw this.createNewTypeError(`autoAllocateChunkSize must be greater than 0`);
            }
        }
        this.setUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize);
    },
    setUpReadableStreamBYOBReader(stream, reader) {
        if (this.isReadableStreamLocked(stream)) {
            throw TypeError(`ReadableStreamDefaultReader constructor can only accept readable streams that are not yet locked to a reader`);
        }
        if (!(stream[slots.controller] instanceof ReadableByteStreamController)) {
            throw TypeError(`Cannot use a BYOB reader with a non-byte stream`);
        }
        this.readableStreamReaderGenericInitialize(reader, stream);
        reader[slots.readIntoRequests] = [3];
    },
    setUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm) {
        assert?.(stream.controller != null);
        controller[slots.stream] = stream;
        this.resetQueue(controller);
        controller[slots.started] = controller[slots.closeRequested] = controller[slots.pullAgain] = controller[slots.pulling] = false;
        controller[slots.strategySizeAlgorithm] = sizeAlgorithm;
        controller[slots.strategyHWM] = highWaterMark;
        controller[slots.pullAlgorithm] = pullAlgorithm;
        controller[slots.cancelAlgorithm] = cancelAlgorithm;
        stream[slots.controller] = controller;
        // Called synchrnonously, so exception thrown propagate immediately.
        Promise.resolve(startAlgorithm(controller)).then(
            () => {
                controller[slots.started] = true;
                assert?.(controller[slots.pulling] === false);
                assert?.(controller[slots.pullAgain] === false);
                this.readableStreamDefaultControllerCallPullIfNeeded(controller);
            },
            r => {
                this.readableStreamDefaultControllerError(controller, r);
            }
        );
    },
    setUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm) {
        const controller = Object.create(ReadableStreamDefaultController.prototype);
        let startAlgorithm = () => {};
        let pullAlgorithm = async () => {};
        let cancelAlgorithm = async () => {};
        if (underlyingSourceDict.start != null) {
            startAlgorithm = controller => underlyingSourceDict.start.call(underlyingSource, controller);
        }
        if (underlyingSourceDict.pull != null) {
            pullAlgorithm = async controller => underlyingSourceDict.pull.call(underlyingSource, controller);
        }
        if (underlyingSourceDict.cancel != null) {
            cancelAlgorithm = async reason => underlyingSourceDict.cancel.call(underlyingSource, reason);
        }
        this.setUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm);
    },
    setUpReadableStreamDefaultReader(stream, reader) {
        if (this.isReadableStreamLocked(stream)) {
            throw TypeError(`ReadableStreamDefaultReader constructor can only accept readable streams that are not yet locked to a reader`);
        }
        this.readableStreamReaderGenericInitialize(reader, stream);
        reader[slots.readRequests] = [];
    },
    setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm) {
        assert?.(this.isTransformStream(stream));
        assert?.(stream[slots.controller] == null);
        controller[slots.stream] = stream;
        stream[slots.controller] = controller;
        controller[slots.transformAlgorithm] = transformAlgorithm;
        controller[slots.flushAlgorithm] = flushAlgorithm;
    },
    setUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict) {
        const controller = Object.create(TransformStreamDefaultController.prototype);
        let transformAlgorithm = async chunk => {
            this.transformStreamDefaultControllerEnqueue(controller, chunk);
        };
        let flushAlgorithm = async () => {};
        if (transformerDict.transform != null) {
            transformAlgorithm = async chunk => transformerDict.transform.call(transformer, chunk, controller);
        }
        if (transformerDict.flush != null) {
            flushAlgorithm = async () => transformerDict.flush.call(transformer, controller);
        }
        this.setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);
    },
    setUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) {
        assert?.(stream instanceof WritableStream);
        assert?.(stream[slots.controller] == null);
        controller[slots.stream] = stream;
        stream[slots.controller] = controller;
        this.resetQueue(controller);
        controller[slots.started] = false;
        controller[slots.strategySizeAlgorithm] = sizeAlgorithm;
        controller[slots.strategyHWM] = highWaterMark;
        controller[slots.writeAlgorithm] = writeAlgorithm;
        controller[slots.closeAlgorithm] = closeAlgorithm;
        controller[slots.abortAlgorithm] = abortAlgorithm;
        const backpressure = this.writableStreamDefaultControllerGetBackpressure(controller);
        this.writableStreamUpdateBackpressure(stream, backpressure);
        Promise.resolve(startAlgorithm(controller)).then(() => {
            assert?.(stream[slots.state] === 'writable' || stream[slots.state] === 'erroring');
            controller[slots.started] = true;
            this.writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
        }, r => {
            assert?.(stream[slots.state] === 'writable' || stream[slots.state] === 'erroring');
            controller[slots.started] = true;
            this.writableStreamDealWithRejection(stream, r);
        });
    },
    setUpWritableStreamDefaultControllerFromUnderlyingSink(stream, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm) {
        const controller = Object.create(WritableStreamDefaultController.prototype);
        let startAlgorithm = () => {};
        let writeAlgorithm = async () => {};
        let closeAlgorithm = async () => {};
        let abortAlgorithm = async () => {};
        if (underlyingSinkDict.start != null) {
            startAlgorithm = controller => underlyingSinkDict.start.call(underlyingSink, controller);
        }
        if (underlyingSinkDict.write != null) {
            writeAlgorithm = async (chunk, controller) => underlyingSinkDict.write.call(underlyingSink, chunk, controller);
        }
        if (underlyingSinkDict.close != null) {
            closeAlgorithm = async () => underlyingSinkDict.close.call(underlyingSink);
        }
        if (underlyingSinkDict.abort != null) {
            abortAlgorithm = async reason => underlyingSinkDict.abort.call(underlyingSink, reason);
        }
        this.setUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm);
    },
    setUpWritableStreamDefaultWriter(writer, stream) {
        if (this.isWritableStreamLocked(stream)) {
            throw this.createNewTypeError('This stream has already been locked for exclusive writing by another writer');
        }
        writer[slots.stream] = stream;
        stream[slots.writer] = writer;
        const state = stream[slots.state];
        if (state === 'writable') {
            if (!this.writableStreamCloseQueuedOrInFlight(stream) && stream[slots.backpressure]) {
                writer[slots.readyAsync] = this.createAsync();
            } else {
                writer[slots.readyAsync] = this.createAsyncReturn();
            }
            writer[slots.closedAsync] = this.createAsync();
        } else if (state === 'erroring') {
            writer[slots.readyAsync] = this.createAsyncThrow(stream[slots.storedError]);
            this.promiseIsHandled(writer[slots.readyAsync].promise);
            writer[slots.closedAsync] = this.createAsync();
        } else if (state === 'closed') {
            writer[slots.readyAsync] = this.createAsyncReturn();
            writer[slots.closedAsync] = this.createAsyncReturn();
        } else {
            assert?.(state === 'errored');
            const storedError = stream[slots.storedError];
            writer[slots.readyAsync] = this.createAsyncThrow(storedError);
            this.promiseIsHandled(writer[slots.readyAsync].promise);
            writer[slots.closedAsync] = this.createAsyncThrow(storedError);
            this.promiseIsHandled(writer[slots.closedAsync].promise);
        }
    },
    transferArrayBuffer(o) {
        return o;
    },
    transformStreamConstruct(stream, transformer, writableStrategy, readableStrategy) {
        if (transformer == null) {
            transformer = {};
        }
        if (transformer !== Object(transformer)) {
            throw this.createNewTypeError('Invalid transformer: not an object');
        }
        if (writableStrategy == null) {
            writableStrategy = {};
        }
        if (writableStrategy !== Object(writableStrategy)) {
            throw this.createNewTypeError('Invalid writableStrategy: not an object');
        }
        if (readableStrategy == null) {
            readableStrategy = {};
        }
        if (readableStrategy !== Object(readableStrategy)) {
            throw this.createNewTypeError('Invalid readableStrategy: not an object');
        }
        const transformerDict = this.makeUnderlyingTransformerDict(transformer);
        const readableHighWaterMark = this.extractHighWaterMark(readableStrategy, 0);
        const readableSizeAlgorithm = this.extractSizeAlgorithm(readableStrategy);
        const writableHighWaterMark = this.extractHighWaterMark(writableStrategy, 1);
        const writableSizeAlgorithm = this.extractSizeAlgorithm(writableStrategy);

        const startAsync = this.createAsync();
        this.initializeTransformStream(stream, startAsync, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm);
        this.setUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict);
    },
    transformStreamDefaultControllerPerformTransform(controller, chunk) {
        return (0, controller[slots.transformAlgorithm])(chunk).catch(r => {
            this.TransformStreamError(controller[slots.stream], r);
            throw r;
        });
    },
    async transformStreamDefaultSinkAbortAlgorithm(stream, reason) {
        this.transformStreamError(stream, reason);
    },
    transformStreamDefaultControllerClearAlgorithms(controller) {
        controller[slots.transformAlgorithm] = null;
        controller[slots.flushAlgorithm] = null;
    },
    transformStreamDefaultSourcePullAlgorithm(stream) {
        assert?.(stream[slots.backpressure] === true);
        assert?.(stream[slots.backpressureChangeAsync] != null);
        this.transformStreamSetBackpressure(stream, false);
        return stream[slots.backpressureChangeAsync].promise;
    },
    transformStreamDefaultSinkCloseAlgorithm(stream) {
        const readable = stream[slots.readable];
        const controller = stream[slots.controller];
        const flushAsync = controller[slots.flushAsync];
        this.transformStreamDefaultControllerClearAlgorithms(controller);
        return flushAsync.promise.then(() => {
            if (readable[slots.state] === 'errored') {
                throw readable[slots.storedError];
            }
            this.readableStreamDefaultControllerClose(readable[slots.controller]);
        }, r => {
            this.transformStreamError(stream, r);
            throw readable[slots.storedError];
        });
    },
    transformStreamDefaultSinkWriteAlgorithm(stream, chunk) {
        assert?.(stream[slots.writable][slots.state] === 'writable');
        const controller = stream[slots.controller];
        if (stream[slots.backpressure]) {
            const backpressureChangeAsync = stream[slots.backpressureChangeAsync];
            assert?.(backpressureChangeAsync != null);
            return backpressureChangeAsync.promise.then(() => {
                const writable = stream[slots.writable];
                const state = writable[slots.state];
                if (state === 'erroring') {
                    throw writable[slots.storedError];
                }
                assert?.(state === 'writable');
                return this.transformStreamDefaultControllerPerformTransform(controller, chunk);
            });
        }
        return this.transformStreamDefaultControllerPerformTransform(controller, chunk);
    },
    transformStreamErrorWritableAndUnblockWrite(stream, e) {
        this.transformStreamDefaultControllerClearAlgorithms(stream[slots.controller]);
        this.writableStreamDefaultControllerErrorIfNeeded(stream[slots.writable][slots.controller], e);
        if (stream[slots.backpressure]) {
            this.transformStreamSetBackpressure(stream, false);
        }
    },
    transformStreamSetBackpressure(stream, backpressure) {
        assert?.(stream[slots.backpressure] !== backpressure);
        if (stream[slots.backpressureChangeAsync] != null) {
            stream[slots.backpressureChangeAsync].fulfill();
        }
        stream[slots.backpressureChangeAsync] = this.createAsync();
        stream[slots.backpressure] = backpressure;
    },
    async writableStreamAbort(stream, reason) {
        const state = stream[slots.state];
        if (state === 'closed' || state === 'errored') {
            return;
        }
        if (stream[slots.pendingAbortRequest] != null) {
            return stream[slots.pendingAbortRequest].promise;
        }
        assert?.(state === 'writable' || state === 'erroring');
        let wasAlreadyErroring = false;
        if (state === 'erroring') {
            wasAlreadyErroring = true;
            reason = undefined;
        }
        const pendingAbortRequest = this.createAsync({ reason, wasAlreadyErroring });
        stream[slots.pendingAbortRequest] = pendingAbortRequest;
        if (!wasAlreadyErroring) {
            this.writableStreamStartErroring(stream, reason);
        }
        return pendingAbortRequest.promise;
    },
    writableStreamAddWriteRequest(stream) {
        assert?.(this.isWritableStreamLocked(stream));
        assert?.(stream[slots.state] === 'writable');
        const request = this.createAsync();
        stream[slots.writeRequests].push(request);
        return request;
    },
    async writableStreamClose(stream) {
        const state = stream[slots.state];
        if (state === 'closed' || state === 'errored') {
            throw this.createNewTypeError(`The stream (in ${state} state) is not in the writable state and cannot be closed`);
        }
        assert?.(state === 'writable' || state === 'erroring');
        assert?.(!this.writableStreamCloseQueuedOrInFlight(stream));
        const closeAsync = this.createAsync();
        stream[slots.closedAsync] = closeAsync;
        const writer = stream[slots.writer];
        if (writer != null && stream[slots.backpressure] && state === 'writable') {
            assert?.(typeof writer[slots.readyAsync]?.fulfill === 'function');
            writer[slots.readyAsync].fulfill();
        }
        this.writableStreamDefaultControllerClose(stream[slots.controller]);
        return closeAsync.promise;
    },
    writableStreamConstruct(stream, sink = null, strategy = {}) {
        const sinkDict = this.makeUnderlyingSinkDict(sink);
        if (strategy == null) {
            strategy = {};
        }
        if (strategy !== Object(strategy)) {
            throw this.createNewTypeError('Invalid strategy: not an object');
        }
        this.initializeWritableStream(stream);
        this.writableStreamConstructByType(stream, sinkDict, sink, strategy);
    },
    writableStreamConstructByType(stream, sinkDict, sink, strategy) {
        const sizeAlgorithm = this.extractSizeAlgorithm(strategy);
        const highWaterMark = this.extractHighWaterMark(strategy, 1);
        this.setUpWritableStreamDefaultControllerFromUnderlyingSink(stream, sink, sinkDict, highWaterMark, sizeAlgorithm);
    },
    writableStreamCloseQueuedOrInFlight(stream) {
        return stream[slots.closeRequest] != null || stream[slots.inFlightCloseRequest] != null;
    },
    writableStreamDealWithRejection(stream, error) {
        const state = stream[slots.state];
        if (state === 'writable') {
            this.writableStreamStartErroring(stream, error);
            return;
        }
        assert?.(state === 'erroring');
        this.writableStreamFinishErroring(stream);
    },
    writableStreamDefaultControllerAdvanceQueueIfNeeded(controller) {
        if (!controller[slots.started]) {
            return;
        }
        const stream = controller[slots.stream];
        if (stream[slots.inFlightWriteRequest] != null) {
            return;
        }
        const state = stream[slots.state];
        assert?.(state !== 'closed' && state !== 'errored');
        if (state === 'erroring') {
            this.writableStreamFinishErroring(stream);
            return;
        }
        if (controller[slots.queue].length <= 0) {
            return;
        }
        const value = this.peekQueueValue(controller);
        if (value === this.closeSentinel) {
            this.writableStreamDefaultControllerProcessClose(controller);
        } else {
            this.writableStreamDefaultControllerProcessWrite(controller, value);
        }
    },
    writableStreamDefaultControllerClearAlgorithms(controller) {
        controller[slots.writeAlgorithm] = null;
        controller[slots.closeAlgorithm] = null;
        controller[slots.abortAlgorithm] = null;
        controller[slots.strategySizeAlgorithm] = null;
    },
    writableStreamDefaultControllerClose(controller) {
        this.enqueueValueWithSize(controller, this.closeSentinel, 0);
        this.writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    writableStreamDefaultControllerError(controller, error) {
        const stream = controller[slots.stream];
        assert?.(stream[slots.state] === 'writable');
        this.writableStreamDefaultControllerClearAlgorithms(controller);
        this.writableStreamStartErroring(stream, error);
    },
    writableStreamDefaultControllerErrorIfNeeded(controller, error) {
        if (controller[slots.stream][slots.state] === 'writable') {
            this.writableStreamDefaultControllerError(controller, error);
        }
    },
    writableStreamDefaultControllerGetBackpressure(controller) {
        return this.writableStreamDefaultControllerGetDesiredSize(controller) <= 0;
    },
    writableStreamDefaultControllerGetChunkSize(controller, chunk) {
        try {
            return controller[slots.strategySizeAlgorithm](chunk);
        } catch (error) {
            this.writableStreamDefaultControllerErrorIfNeeded(controller, error);
            return 1;
        }
    },
    writableStreamDefaultControllerGetDesiredSize(controller) {
        return controller[slots.strategyHWM] - controller[slots.queueTotalSize];
    },
    writableStreamDefaultControllerProcessClose(controller) {
        const stream = controller[slots.stream];
        this.writableStreamMarkCloseRequestInFlight(stream);
        this.dequeueValue(controller);
        assert?.(controller[slots.queue].length <= 0);
        const sinkClosePromise = (0, controller[slots.closeAlgorithm])();
        this.writableStreamDefaultControllerClearAlgorithms(controller);
        sinkClosePromise.then(() => {
            this.writableStreamFinishInFlightClose(stream);
        }, reason => {
            this.writableStreamFinishInFlightCloseWithError(stream, reason);
        });
    },
    writableStreamDefaultControllerProcessWrite(controller, chunk) {
        const stream = controller[slots.stream];
        this.writableStreamMarkFirstWriteRequestInFlight(stream);
        const sinkWritePromise = (0, controller[slots.writeAlgorithm])(chunk);
        sinkWritePromise.then(() => {
            this.writableStreamFinishInFlightWrite(stream);
            const state = stream[slots.state];
            assert?.(state === 'writable' || state === 'erroring');
            this.dequeueValue(controller);
            if (!this.writableStreamCloseQueuedOrInFlight(stream) && state === 'writable') {
                const backpressure = this.writableStreamDefaultControllerGetBackpressure(controller);
                this.WritableStreamUpdateBackpressure(stream, backpressure);
            }
            this.writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
        }, reason => {
            if (stream[slots.state] === 'writable') {
                this.writableStreamDefaultControllerClearAlgorithms(controller);
            }
            this.writableStreamFinishInFlightWriteWithError(stream, reason);
        });
    },
    writableStreamDefaultControllerWrite(controller, chunk, chunkSize) {
        try {
            this.enqueueValueWithSize(chunk, chunkSize);
        } catch (error) {
            this.writableStreamDefaultControllerErrorIfNeeded(controller, error);
            return;
        }
        const stream = controller[slots.stream];
        if (!this.writableStreamCloseQueuedOrInFlight(stream) && stream[slots.state] === 'writable') {
            const backpressure = this.writableStreamDefaultControllerGetBackpressure(controller);
            this.writableStreamUpdateBackpressure(stream, backpressure);
        }
        this.writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    writableStreamDefaultWriterAbort(writer, reason) {
        const stream = writer[slots.stream];
        assert?.(stream != null);
        return this.writableStreamAbort(stream, reason);
    },
    writableStreamDefaultWriterClose(writer) {
        const stream = writer[slots.stream];
        assert?.(stream != null);
        return this.writableStreamClose(stream);
    },
    writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error) {
        if (writer[slots.closedAsync].reject != null) {
            writer[slots.closedAsync].reject(error);
        } else {
            writer[slots.closedAsync] = this.createAsyncThrow(error);
        }
        this.promiseIsHandled(writer[slots.closedAsync].promise);
    },
    writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error) {
        if (writer[slots.readyAsync].reject != null) {
            writer[slots.readyAsync].reject(error);
        } else {
            writer[slots.readyAsync] = this.createAsyncThrow(error);
        }
        this.promiseIsHandled(writer[slots.readyAsync].promise);
    },
    writableStreamDefaultWriterGetDesiredSize(writer) {
        const stream = writer[slots.stream];
        const state = stream[slots.state];
        if (state === 'errored' || state === 'erroring') {
            return null;
        }
        if (state === 'closed') {
            return 0;
        }
        return spec.writableStreamDefaultControllerGetDesiredSize(stream[slots.controller]);
    },
    writableStreamDefaultWriterRelease(writer) {
        const stream = writer[slots.stream];
        assert?.(stream != null);
        assert?.(stream[slots.writer] === writer);
        const releasedError = this.createNewTypeError('Writer was released and can no longer be used to monitor the stream\'s closedness');
        this.writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
        this.writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);
        stream[slots.writer] = null;
        writer[slots.stream] = null;
    },
    async writableStreamDefaultWriterWrite(writer, chunk) {
        const stream = writer[slots.stream];
        assert?.(stream != null);
        const controller = stream[slots.controller];
        const chunkSize = spec.writableStreamDefaultControllerGetChunkSize(controller, chunk);
        // Getting the chunk size executes user code that might throw an exceptions, which will
        // set the stream to erroring and release this writer, thuse stream !== writer[slots.stream]
        if (stream !== writer[slots.stream]) {
            throw this.createNewTypeError('Cannot write to a stream using a released writer');
        }
        const state = stream[slots.state];
        if (state === 'errored') {
            throw stream[slots.storedError];
        }
        if (this.writableStreamCloseQueuedOrInFlight(stream) || state === 'closed') {
            throw this.createNewTypeError('The stream is closing or closed and cannot be written to');
        }
        if (state === 'erroring') {
            throw stream[slots.storedError];
        }
        assert?.(state === 'writable');
        const request = this.writableStreamAddWriteRequest(stream);
        this.writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
        return request.promise;
    },
    writableStreamFinishErroring(stream) {
        assert?.(stream[slots.state] === 'erroring');
        assert?.(!this.writableStreamHasOperationMarkedInFlight(stream));
        stream[slots.state] = 'errored';
        stream[slots.controller][slots.errorSteps]();
        const storedError = stream[slots.storedError];
        for (const writeRequest of stream[slots.writeRequests]) {
            writeRequest.reject(storedError);
        }
        stream[slots.writeRequests].length = 0;
        if (stream[slots.pendingAbortRequest] == null) {
            this.writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
            return;
        }
        const abortRequest = stream[slots.pendingAbortRequest];
        stream[slots.pendingAbortRequest] = null;
        if (abortRequest.wasAlreadyErroring) {
            abortRequest.reject(storedError);
            this.writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
            return;
        }
        stream[slots.controller][slots.abortSteps](abortRequest.reason).then(() => {
            abortRequest.fulfill();
            this.writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
        }, reason => {
            abortRequest.reject(reason);
            this.writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
        });
    },
    writableStreamFinishInFlightClose(stream) {
        assert?.(stream[slots.inFlightCloseRequest] != null);
        stream[slots.inFlightCloseRequest].fulfill();
        stream[slots.inFlightCloseRequest] = null;
        const state = stream[slots.state];
        assert?.(state === 'writable' || state === 'erroring');
        if (state === 'erroring') {
            stream[slots.storedError] = null;
            if (stream[slots.pendingAbortRequest] != null) {
                stream[slots.pendingAbortRequest].fulfill();
                stream[slots.pendingAbortRequest] = null;
            }
        }
        stream[slots.state] = 'closed';
        const writer = stream[slots.writer];
        if (writer != null) {
            writer[slots.closedAsync].fulfill();
        }
        assert?.(stream[slots.pendingAbortRequest] == null);
        assert?.(stream[slots.storedError] == null);
    },
    writableStreamFinishInFlightCloseWithError(stream, error) {
        assert?.(stream[slots.inFlightCloseRequest] != null);
        stream[slots.inFlightCloseRequest].reject(error);
        stream[slots.inFlightCloseRequest] = null;
        assert?.(stream[slots.state] === 'writable' || stream[slots.state] === 'erroring');
        if (stream[slots.pendingAbortRequest] != null) {
            stream[slots.pendingAbortRequest].reject(error);
            stream[slots.pendingAbortRequest] = null;
        }
        this.writableStreamDealWithRejection(stream, error);
    },
    writableStreamFinishInFlightWrite(stream) {
        assert?.(stream[slots.inFlightWriteRequest] != null);
        stream[slots.inFlightWriteRequest].fulfill();
        stream[slots.inFlightWriteRequest] = null;
    },
    writableStreamFinishInFlightWriteWithError(stream, error) {
        assert?.(stream[slots.inFlightWriteRequest] != null);
        stream[slots.inFlightWriteRequest].reject(error);
        stream[slots.inFlightWriteRequest] = null;
        assert?.(stream[slots.state] === 'writable' || stream[slots.state] === 'erroring');
        this.writableStreamDealWithRejection(stream, error);
    },
    writableStreamHasOperationMarkedInFlight(stream) {
        return stream[slots.inFlightWriteRequest] != null || stream[slots.controller][slots.inFlightCloseRequest] != null;
    },
    writableStreamMarkCloseRequestInFlight(stream) {
        assert?.(stream[slots.inFlightCloseRequest] == null);
        assert?.(stream[slots.closeRequest] != null);
        stream[slots.inFlightCloseRequest] = stream[slots.closeRequest];
        stream[slots.closeRequest] = null;
    },
    writableStreamMarkFirstWriteRequestInFlight(stream) {
        assert?.(stream[slots.inFlightCloseRequest] == null);
        assert?.(stream[slots.writeRequests] != null);
        const writeRequest = stream[slots.writeRequests].shift();
        stream[slots.inFlightWriteRequest] = writeRequest;
    },
    writableStreamRejectCloseAndClosedPromiseIfNeeded(stream) {
        assert?.(stream[slots.state] === 'errored');
        if (stream[slots.closeRequest] != null) {
            assert?.(stream[slots.inFlightCloseRequest] == null);
            stream[slots.closeRequest].reject(stream[slots.storedError]);
            stream[slots.closeRequest] = null;
        }
        const writer = stream[slots.writer];
        if (writer != null) {
            writer[slots.closedAsync].reject(stream[slots.storedError]);
            this.promiseIsHandled(writer[slots.closedAsync].promise);
        }
    },
    writableStreamStartErroring(stream, reason) {
        assert?.(stream[slots.storedError] == null);
        assert?.(stream[slots.state] === 'writable');
        const controller = stream[slots.controller];
        assert?.(controller != null);
        stream[slots.state] = 'erroring';
        stream[slots.storedError] = reason;
        const writer = stream[slots.writer];
        if (writer != null) {
            this.writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);
        }
        if (this.writableStreamHasOperationMarkedInFlight(stream) && controller[slots.started]) {
            this.writableStreamFinishErroring(stream);
        }
    },
    writableStreamUpdateBackpressure(stream, backpressure) {
        assert?.(stream[slots.state] === 'writable');
        assert?.(!this.writableStreamCloseQueuedOrInFlight(stream));
        const writer = stream[slots.writer];
        if (writer != null && backpressure !== stream[slots.backpressure]) {
            if (backpressure) {
                writer[slots.readyAsync] = this.createAsync();
            } else {
                writer[slots.readyAsync] = this.createAsyncReturn();
            }
        }
        stream[slots.backpressure] = backpressure;
    }
};

const typedArrayTable = spec.typedArrayTable = new Map();
typedArrayTable.set(Int8Array.prototype, Int8Array);
typedArrayTable.set(Uint8Array.prototype, Uint8Array);
typedArrayTable.set(Uint8ClampedArray.prototype, Uint8ClampedArray);
typedArrayTable.set(Int16Array.prototype, Int16Array);
typedArrayTable.set(Uint16Array.prototype, Uint16Array);
typedArrayTable.set(Int32Array.prototype, Int32Array);
typedArrayTable.set(Uint32Array.prototype, Uint32Array);
typedArrayTable.set(BigInt64Array.prototype, BigInt64Array);
typedArrayTable.set(BigUint64Array.prototype, BigUint64Array);
typedArrayTable.set(Float32Array.prototype, Float32Array);
typedArrayTable.set(Float64Array.prototype, Float64Array);

export default spec;
