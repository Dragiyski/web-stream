import slots from './slots.js';

let assert = null;

if (process?.env?.ENABLE_ASSERT) {
    assert = await import('node:assert');
}

export class ReadableStream {
    constructor(underlyingSource = null, strategy = {}) {
        const underlyingSourceDict = makeUnderlyingSourceDict(underlyingSource);
        if (strategy == null) {
            strategy = {};
        }
        initializeReadableStream(this);
        if (underlyingSourceDict.type === 'bytes') {
            if (strategy.size != null) {
                throw new RangeError('The option [strategy.size] is not compatible with [underlyingSource.type] === "bytes"');
            }
            const highWaterMark = extractHighWaterMark(strategy, 0);
            setUpReadableByteStreamControllerFromUnderlyingSource(this, underlyingSource, underlyingSourceDict, highWaterMark);
        } else {
            const sizeAlgorithm = extractSizeAlgorithm(strategy);
            const highWaterMark = extractHighWaterMark(strategy, 1);
            setUpReadableStreamDefaultControllerFromUnderlyingSource(this, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm);
        }
    }

    get locked() {
        return isReadableStreamLocked(this);
    }

    async cancel(reason) {
        if (isReadableStreamLocked(this)) {
            throw new TypeError('The readable stream is locked');
        }
        return readableStreamCancel(this, reason);
    }

    getReader(options = {}) {
        if (options != null || options !== Object(options)) {
            throw new TypeError('Invalid options: cannot convert to dictionary');
        } else if (options == null) {
            options = {};
        }
        const mode = options.mode;
        let byob = false;
        if (mode != null) {
            if (mode !== 'byob') {
                throw new TypeError(`The option [mode] must be exactly the string "byob", if present`);
            }
            byob = true;
        }
        return (byob ? acquireReadableStreamBYOBReader : acquireReadableStreamDefaultReader)(this);
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
        if (isReadableStreamLocked(this)) {
            throw new TypeError('Cannot pipe a locked stream');
        }
        if (isWritableStreamLocked(transform.writable)) {
            throw new TypeError('Cannot pipe to a locked stream');
        }
        const signal = options.signal;
        readableStreamPipeTo(this, transform.writable, !!options.preventClose, !!options.preventAbort, !!options.preventCancel, signal);
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
        if (isReadableStreamLocked(this)) {
            throw new TypeError('Cannot pipe a locked stream');
        }
        if (isWritableStreamLocked(destination)) {
            throw new TypeError('Cannot pipe to a locked stream');
        }
        const signal = options.signal;
        return readableStreamPipeTo(this, destination, options.prevenClose, options.preventAbort, options.preventCancel, signal);
    }
}

export class ReadableStreamDefaultReader {
}

export class ReadableStreamBYOBReader {
}

export class ReadableStreamDefaultController {
}

export class ReadableByteStreamController {
}

export class ReadableStreamBYOBRequest {
}

export class WritableStream {
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

function makeUnderlyingSourceDict(source) {
    const result = {};
    if (source == null || source !== Object(source)) {
        throw new TypeError('Invalid underlyingSource: expected undefined, null or an object');
    }
    for (const name of ['start', 'pull', 'cancel']) {
        const value = source[name];
        if (value != null) {
            if (typeof value !== 'function') {
                throw new TypeError(`The option [underlyingSource.${name}] must be a function, if present`);
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
}

function initializeReadableStream(stream) {
    stream[slots.state] = 'readable';
    stream[slots.reader] = stream[slots.storedError] = undefined;
    stream[slots.disturbed] = false;
}

function extractHighWaterMark(strategy, defaultHWM) {
    if (strategy.highWaterMark == null) {
        return defaultHWM;
    }
    const highWaterMark = Number(strategy.highWaterMark);
    if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 0) {
        throw RangeError('Invalid [strategy.highWaterMark], expected valid non-negative integer');
    }
    return highWaterMark;
}

function extractSizeAlgorithm(strategy) {
    if (strategy.size == null) {
        return () => 1;
    }
    if (typeof strategy.size !== 'function') {
        throw new TypeError('The option [strategy.size] must be a function, if specified');
    }
    const size = strategy.size.bind(strategy);
    return chunk => size(chunk);
}

function setUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize) {
    assert?.(stream[slots.controller] == null);
    controller[slots.stream] = stream;
    controller[slots.pullAgain] = false;
    controller[slots.pulling] = false;
    controller[slots.byobRequest] = null;
    resetQueue(controller);
    controller[slots.closeRequested] = false;
    controller[slots.started] = false;
    controller[slots.started] = false;
    controller[slots.strategyHWM] = highWaterMark;
    controller[slots.pullAlgorithm] = pullAlgorithm;
    controller[slots.cancelAlgorithm] = cancelAlgorithm;
    controller[slots.autoAllocateChunkSize] = autoAllocateChunkSize;
    controller[slots.pendingPullIntos] = [];
    stream[slots.controller] = controller;
    startAlgorithm(controller).then(() => {
        controller[slots.started] = true;
        readableByteStreamControllerCallPullIfNeeded(controller);
    }, reason => {
        readableByteStreamControllerError(controller, reason);
    });
}

function setUpReadableByteStreamControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark) {
    const controller = new ReadableByteStreamController();
    let startAlgorithm = async () => {};
    let pullAlgorithm = async () => {};
    let cancelAlgorithm = async () => {};
    if (underlyingSourceDict.start != null) {
        startAlgorithm = async controller => underlyingSourceDict.start.call(underlyingSource, controller);
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
    }
    if (autoAllocateChunkSize === 0) {
        throw new TypeError('The option [underlyingSource.autoAllocateChunkSize] cannot be zero.');
    }
    setUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize);
}

function setUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm) {
}

function readableByteStreamControllerCallPullIfNeeded(controller) {
    const shouldPull = readableByteStreamControllerShouldCallPull(controller);
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
            readableByteStreamControllerCallPullIfNeeded(controller);
        }
    }, e => {
        readableByteStreamControllerError(controller, e);
    });
}

function readableByteStreamControllerShouldCallPull(controller) {
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
    if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0) {
        return true;
    }
    if (readableStreamHasBYOBReader(stream) && readableStreamGetNumReadIntoRequests(stream) > 0) {
        return true;
    }
    const desiredSize = readableByteStreamControllerGetDesiredSize(controller);
    assert?.(desiredSize != null);
    return desiredSize > 0;
}

function readableByteStreamControllerError(controller, e) {
    const stream = controller[slots.stream];
    if (stream[slots.state] !== 'readable') {
        return;
    }
    readableByteStreamControllerClearPendingPullIntos(controller);
    resetQueue(controller);
    readableByteStreamControllerClearAlgorithms(controller);
    readableStreamError(stream, e);
}

function readableStreamHasDefaultReader(stream) {
    const reader = stream[slots.reader];
    if (reader == null) {
        return false;
    }
    return reader instanceof ReadableStreamDefaultReader;
}

function readableStreamHasBYOBReader(stream) {
    const reader = stream[slots.reader];
    if (reader == null) {
        return false;
    }
    return reader instanceof ReadableStreamBYOBReader;
}

function readableByteStreamControllerGetDesiredSize(controller) {
    const state = controller[slots.stream][slots.state];
    if (state === 'errored') {
        return null;
    }
    if (state === 'closed') {
        return 0;
    }
    return controller[slots.strategyHWM] - controller[slots.queueTotalSize];
}

function readableStreamGetNumReadRequests(stream) {
    assert?.(readableStreamHasDefaultReader(stream) === true);
    return stream[slots.reader][slots.readRequests].length;
}

function readableStreamGetNumReadIntoRequests(stream) {
    assert?.(readableStreamHasBYOBReader(stream) === true);
    return stream[slots.reader][slots.readRequests].length;
}

function resetQueue(container) {
    container[slots.queue] = [];
    container[slots.queueTotalSize] = 0;
}

function readableByteStreamControllerClearPendingPullIntos(controller) {
    readableByteStreamControllerInvalidateBYOBRequest(controller);
    controller[slots.pendingPullIntos] = [];
}

function readableByteStreamControllerClearAlgorithms(controller) {
    controller[slots.pullAlgorithm] = null;
    controller[slots.cancelAlgorithm] = null;
}

function readableStreamError(stream, e) {
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
}

function readableByteStreamControllerInvalidateBYOBRequest(controller) {
    if (controller[slots.byobRequest] == null) {
        return;
    }
    controller[slots.byobRequest][slots.controller] = null;
    controller[slots.byobRequest][slots.view] = null;
    controller[slots.byobRequest] = null;
}

function isReadableStreamLocked(stream) {
    return stream[slots.reader] != null;
}

async function readableStreamCancel(stream, reason) {
    stream[slots.disturbed] = true;
    if (stream[slots.state] === 'closed') {
        return;
    }
    if (stream[slots.state] === 'errored') {
        throw stream[slots.storedError];
    }
    readableStreamClose(stream);
    await stream[slots.controller][slots.cancelSteps](reason);
}

function readableStreamClose(stream) {
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
}

function acquireReadableStreamDefaultReader(stream) {
    const reader = new ReadableStreamDefaultReader();
    setUpReadableStreamDefaultReader(stream, reader);
    return reader;
}

function setUpReadableStreamDefaultReader(stream, reader) {
    if (isReadableStreamLocked(stream)) {
        throw TypeError('The stream is already locked');
    }
    readableStreamReaderGenericInitialize(reader, stream);
    reader[slots.readRequests] = [];
}

function readableStreamReaderGenericInitialize(reader, stream) {
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
}

function acquireReadableStreamBYOBReader(stream) {
    const reader = new ReadableStreamBYOBReader();
    setUpReadableStreamBYOBReader(stream, reader);
    return reader;
}

function setUpReadableStreamBYOBReader(stream, reader) {
    if (isReadableStreamLocked(stream)) {
        throw TypeError('The stream is already locked');
    }
    if (!(stream[slots.controller] instanceof ReadableByteStreamController)) {
        throw TypeError('The option [mode] can only be "byob" for byte streams');
    }
    readableStreamReaderGenericInitialize(reader, stream);
    reader[slots.readIntoRequests] = [];
}
