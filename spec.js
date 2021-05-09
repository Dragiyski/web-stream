import { assert } from './assert.js';
import slots from './slots.js';
import {
    ReadableStream,
    WritableStream,
    ReadableStreamDefaultReader,
    ReadableStreamBYOBReader,
    ReadableStreamDefaultController,
    ReadableByteStreamController,
    ReadableStreamBYOBRequest
} from './index.js';

const typedArrayTable = new Map();
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

export default {
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
        if (!isFinite(size)) {
            throw RangeError(`The return value of a queuing strategy's size function must be a finite, non-NaN, non-negative number`);
        }
        container[slots.queue].push({ value, size });
        container[slots.queueTotalSize] += size;
    },
    extractHighWaterMark(strategy, defaultHWM) {
        if (strategy.highWaterMark == null) {
            return defaultHWM;
        }
        const highWaterMark = Number(strategy.highWaterMark);
        if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 0) {
            throw RangeError('Invalid [strategy.highWaterMark], expected valid non-negative integer');
        }
        return highWaterMark;
    },
    extractSizeAlgorithm(strategy) {
        if (strategy.size == null) {
            return () => 1;
        }
        if (typeof strategy.size !== 'function') {
            throw new TypeError('The option [strategy.size] must be a function, if specified');
        }
        const size = strategy.size.bind(strategy);
        return chunk => size(chunk);
    },
    initializeReadableStream(stream) {
        stream[slots.state] = 'readable';
        stream[slots.reader] = stream[slots.storedError] = undefined;
        stream[slots.disturbed] = false;
    },
    isReadableStreamLocked(stream) {
        return stream[slots.reader] != null;
    },
    isWritableStreamLocked(stream) {
        return stream[slots.writer] != null;
    },
    makeUnderlyingSourceDict(source) {
        const result = {};
        if (source == null || source !== Object(source)) {
            throw new TypeError(`The underlying source must be null/undefined or object`);
        }
        for (const name of ['start', 'pull', 'cancel']) {
            const value = source[name];
            if (value != null) {
                if (typeof value !== 'function') {
                    throw new TypeError(`The underlying source '${name}' exists, but it is not a function`);
                }
                result[name] = source[name];
            }
        }
        {
            const autoAllocateChunkSize = source.autoAllocateChunkSize;
            if (autoAllocateChunkSize != null) {
                if (!Number.isSafeInteger(autoAllocateChunkSize)) {
                    throw new TypeError(`The option [underlyingSource.autoAllocateChunkSize] must be an integer, if present`);
                }
                result.autoAllocateChunkSize = autoAllocateChunkSize;
            }
        }
        {
            const type = source.type;
            if (type != null) {
                if (type !== 'bytes') {
                    throw new TypeError(`The option [underlyingSource.type] must be exactly the string "bytes", if present`);
                }
                result.type = type;
            }
        }
        return result;
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
                const e = new TypeError('There are outstanding read requests');
                this.readableByteStreamControllerError(controller, e);
                throw e;
            }
            this.readableByteStreamControllerClearAlgorithms(controller);
            this.readableStreamClose(stream);
        }
    },
    readableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor) {
        const bytesFilled = pullIntoDescriptor.bytesFilled;
        const elementSize = pullIntoDescriptor.elementSize;
        assert?.(pullIntoDescriptor.bytesFilled <= pullIntoDescriptor.byteLength);
        assert?.(bytesFilled & elementSize === 0);
        // Here we cannot use the pullIntoDescriptor data as intended, but the general idea is to create a view
        // for the existing buffer, with the same type as the provided view, which is only possible for aligned elements.
        // To do this, we need to compute the aligned byte elements first:
        const byteLength = bytesFilled - bytesFilled % elementSize; // Equivalen of Math.floor(bytesFilled / elementSize) * elementSize;
        return new pullIntoDescriptor.ViewConstructor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, byteLength);
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
            assert(pullIntoDescriptor.readerType === 'byob');
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
                assert?.(controller[slots.queue].length > 0);
                const transferredView = new Uint8Array(transferredBuffer, byteOffset, byteLength);
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
        controller[slots.queue]({ buffer, byteOffset, byteLength });
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
        const maxBytesFilled = pullIntoDescriptor.bytesFilled - maxBytesToCopy;
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
            const sourceView = new pullIntoDescriptor.ByteConstructor(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy);
            const targetView = new pullIntoDescriptor.ByteConstructor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, pullIntoDescriptor.byteLength);
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
                if (typedArrayTable.has(v)) {
                    ArrayBufferView = typedArrayTable.get(v);
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
            const emptyView = new ArrayBufferView(new ArrayBuffer(0));
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
                const e = new TypeError('The controller close() is called before the current pull');
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
            throw new RangeError('response reports bytes outside bounds of BYOB request');
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
                throw new TypeError('The stream is already closed');
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
            throw new RangeError(`The view byte offset does not match the range of the request`);
        }
        if (firstDescriptor.byteLength !== view.byteLength) {
            throw new RangeError(`The view byte length does not match the range of the request`);
        }
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
    readableStreamClose(stream) {
        assert?.(stream[slots.state] === 'readable');
        stream[slots.state] = 'closed';
        const reader = stream[slots.reader];
        if (reader == null) {
            return;
        }
        reader[slots.closedDefer].resolve();
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
        controller[slots.pullAlgorithm]().then(() => {
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
            this.readableStreamDefaultControllerCallPullIfNeeded(controller);
        }
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
        if (stream.state === 'closed') {
            readRequest.closeSteps();
        } else if (stream.state === 'errored') {
            readRequest.errorSteps(stream[slots.storedError]);
        } else {
            assert?.(stream.state === 'readable');
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
        reader[slots.closedDefer].reject(e);
        reader[slots.closedDefer].isHandled = true;
        if (reader instanceof ReadableStreamDefaultReader) {
            for (const readRequest of reader[slots.readRequests]) {
                readRequest.errorSteps(e);
            }
            reader[slots.readRequests] = [];
        } else {
            assert?.(reader instanceof ReadableStreamBYOBReader);
            for (const readIntoRequest of reader[slots.readRequests]) {
                readIntoRequest.errorSteps(e);
            }
            reader[slots.readRequests] = [];
        }
    },
    readableStreamFulfillReadIntoRequest(stream, chunk, done) {
        assert?.(this.readableStreamHasBYOBReader(stream));
        const reader = stream[slots.reader];
        assert?.(reader[slots.readIntoRequests].length > 0);
        const readIntoRequest = reader[slots.readIntoRequest].shift();
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
        return stream[slots.reader][slots.readRequests].length;
    },
    readableStreamGetNumReadRequests(stream) {
        assert?.(this.readableStreamHasDefaultReader(stream) === true);
        return stream[slots.reader][slots.readRequests].length;
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
        const defer = {};
        defer.promise = new Promise((resolve, reject) => {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        if (signal != null) {
            const abortAlgorithm = () => {
                const error = new Error('Pipe operation was aborted');
                error.name = 'AbortError';
                error.code = 'ABORT_ERR';
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
                return defer.promise;
            }
            signal.addEventListener('abort', abortAlgorithm, { once: true });
        }
        /* The following step is not clearly described in the standard, intentionally. Instead, it is up to the agent
        * (current code) to decide how to process it. However, a few guidelines must be followed:
        * - We should never call any stream/reader/writer public API (non-slot symbols); We can still call the
        * undelying source/sink API though.
        * - Operation must be done in a parallel, we should not "await", but rather start as many jobs as we need
        * until we pass the watermark for the destination. Of course, individual reads must not be parallel, a
        * stream must fully read a chunk before continue with the next. The pipe allows the readable stream to
        * continue even when the pipe is in high watermark state.
        * - Only backpressure should stop further processing on read chunks.
        */
        // TODO: Perform read/writes in parallel here. To stop the stream we should use shutdown which will call
        // finalize, which will resolve/reject the promise.

        // Processing: The processing should be as follows: Using 'reader' we read chunks and write them to the 'writer'.
        // (Note, 'reader' and 'writer' belongs to different streams here).
        // If this.writableStreamDefaultWriterGetDesiredSize(writer) <= 0 or null, we stop reading until the value returns
        // to > 0 (back-pressure).
        // Reading is a promise operation, so it might take some time for information to be received.
        // If at any time source[slots.state] changes to 'errored' / 'closed', the propagation of errors is dictated by
        // preventAbort, preventClose, preventCancel arguments. If some of those are true, error/close in one of the stream
        // will prevent error/close in another. This comes from options argument supplied by the user.

        return defer.promise;
    },
    readableStreamReaderGenericInitialize(reader, stream) {
        reader[slots.stream] = stream;
        stream[slots.reader] = reader;
        if (stream[slots.state] === 'readable') {
            const defer = {};
            defer.promise = new Promise((resolve, reject) => {
                defer.resolve = resolve;
                defer.reject = reject;
            });
            reader[slots.closedDefer] = defer;
        } else if (stream[slots.state] === 'closed') {
            stream[slots.closedDefer] = { promise: Promise.resolve(undefined) };
        } else {
            assert?.(stream[slots.state] === 'errored');
            stream[slots.closedDefer] = { promise: Promise.reject(stream[slots.storedError]) };
            stream[slots.closedDefer].isHandled = true;
        }
    },
    readableStreamReaderGenericRelease(reader) {
        assert?.(reader[slots.stream] != null);
        assert?.(reader[slots.stream][slots.reader] === reader);
        if (reader[slots.stream][slots.state] === 'readable') {
            reader[slots.stream][slots.closedDefer].reject(new TypeError('Cannot release a readable stream reader when it still has outstanding read() calls that have not yet settled'));
        } else {
            reader[slots.stream][slots.closedDefer] = {};
            reader[slots.stream][slots.closedDefer].promise = Promise.reject(new TypeError(`This readable stream reader has been released and cannot be used to monitor the stream's state`));
        }
        reader[slots.stream][slots.closedDefer].promise.catch(() => { }); // [[PromiseIsHandled]] = true
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
        const startResult = startAlgorithm(); // Called synchrnonously, so exception thrown propagate immediately.
        Promise.resolve(startResult).then(() => {
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
        let startAlgorithm = () => { };
        let pullAlgorithm = async () => { };
        let cancelAlgorithm = async () => { };
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
                throw new TypeError(`The underlying source 'autoAllocateChunkSize' is not an integer.`);
            }
            if (autoAllocateChunkSize <= 0) {
                throw new TypeError(`The underlying source 'autoAllocateChunkSize' must be positive.`);
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
        reader[slots.readIntoRequests] = [];
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
        const startResult = startAlgorithm(); // Called synchrnonously, so exception thrown propagate immediately.
        Promise.resolve(startResult).then(
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
        let startAlgorithm = () => { };
        let pullAlgorithm = async () => { };
        let cancelAlgorithm = async () => { };
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
    transferArrayBuffer(o) {
        return o;
    }
};
