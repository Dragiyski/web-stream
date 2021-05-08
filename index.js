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
                throw new RangeError(`Failed to construct 'ReadableStream': Invalid type is specified`);
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
        return (byob ? spec.acquireReadableStreamBYOBReader : spec.acquireReadableStreamDefaultReader)(this);
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
            .then(() => {}, error => {
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
}

export class ReadableStreamDefaultReader {
    constructor(stream) {
        if (!(stream instanceof ReadableStream)) {
            throw new TypeError(`Failed to construct 'ReadableStreamDefaultReader': parameter 1 is not of type 'ReadableStream'.`);
        }
        spec.setUpReadableStreamDefaultReader(this, stream);
    }

    async read() {
        if (this[slots.stream] == null) {
            throw new TypeError(`Failed to execute 'read' on 'ReadableStreamDefaultReader': Illegal invocation`);
        }
        const defer = {};
        defer.promise = new Promise((resolve, reject) => {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        const readRequest = {
            chunkSteps(chunk) {
                defer.resolve({
                    value: chunk,
                    done: false
                });
            },
            closeSteps() {
                defer.resolve({
                    value: undefined,
                    done: true
                });
            },
            errorSteps(e) {
                defer.reject(e);
            }
        };
        spec.readableStreamDefaultReaderRead(this, readRequest);
        return defer.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readRequests].length > 0) {
            throw new TypeError(`Failed to execute 'releaseLock' on 'ReadableStreamDefaultReader': There are outstanding read requests`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
}

export class ReadableStreamBYOBReader {
    constructor(stream) {
        if (!(stream instanceof ReadableStream)) {
            throw new TypeError(`Failed to construct 'ReadableStreamBYOBReader': parameter 1 is not of type 'ReadableStream'.`);
        }
        spec.setUpReadableStreamBYOBReader(this, stream);
    }

    async read(view) {
        if (view instanceof ArrayBuffer) {
            view = new DataView(view);
        }
        if (!ArrayBuffer.isView(view)) {
            throw new TypeError(`Failed to execute 'read' on 'ReadableStreamBYOBReader': parameter 1 is not 'ArrayBufferView'`);
        }
        if (view.byteLength === 0) {
            throw new TypeError(`Failed to execute 'read' on 'ReadableStreamBYOBReader': This readable stream reader cannot be used to read as the view has byte length equal to 0`);
        }
        if (this[slots.stream] == null) {
            throw new TypeError(`Failed to execute 'read' on 'ReadableStreamBYOBReader': This readable stream reader has been released and cannot be used to read from its previous owner stream`);
        }
        const defer = {
            this: this
        };
        defer.promise = new Promise((resolve, reject) => {
            defer.resolve = resolve;
            defer.reject = reject;
        });
        const readIntoRequest = {
            chunkSteps(chunk) {
                defer.resolve({
                    value: chunk,
                    done: false
                });
            },
            closeSteps(chunk) {
                defer.resolve({
                    value: chunk,
                    done: true
                });
            },
            errroSteps(e) {
                defer.reject(e);
            }
        };
        spec.readableStreamBYOBReaderRead(this, view, readIntoRequest);
        return defer.promise;
    }

    releaseLock() {
        if (this[slots.stream] == null) {
            return;
        }
        if (this[slots.readIntoRequests].length > 0) {
            throw new TypeError(`Failed to execute 'releaseLock' on 'ReadableStreamBYOBReader': There are outstanding read requests`);
        }
        spec.readableStreamReaderGenericRelease(this);
    }
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
