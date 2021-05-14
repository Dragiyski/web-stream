import { assert } from '../../assert.js';
import { promise_rejects_js, assert_throws_js, step_timeout } from '../assert.js';

export const getterRejects = (t, obj, getterName, target) => {
    const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

    return promise_rejects_js(t, TypeError, getter.call(target), getterName + ' should reject with a TypeError');
};

export const getterRejectsForAll = (t, obj, getterName, targets) => {
    return Promise.all(targets.map(target => getterRejects(t, obj, getterName, target)));
};

export const methodRejects = (t, obj, methodName, target, args) => {
    const method = obj[methodName];

    return promise_rejects_js(t, TypeError, method.apply(target, args),
        methodName + ' should reject with a TypeError');
};

export const methodRejectsForAll = (t, obj, methodName, targets, args) => {
    return Promise.all(targets.map(target => methodRejects(t, obj, methodName, target, args)));
};

export const getterThrows = (obj, getterName, target) => {
    const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

    assert_throws_js(TypeError, () => getter.call(target), getterName + ' should throw a TypeError');
};

export const getterThrowsForAll = (obj, getterName, targets) => {
    targets.forEach(target => getterThrows(obj, getterName, target));
};

export const methodThrows = (obj, methodName, target, args) => {
    const method = obj[methodName];
    assert.strictEqual(typeof method, 'function', methodName + ' should exist');

    assert_throws_js(TypeError, () => method.apply(target, args), methodName + ' should throw a TypeError');
};

export const methodThrowsForAll = (obj, methodName, targets, args) => {
    targets.forEach(target => methodThrows(obj, methodName, target, args));
};

export const constructorThrowsForAll = (constructor, firstArgs) => {
    firstArgs.forEach(
        firstArg => assert_throws_js(TypeError, () => new constructor(firstArg), 'constructor should throw a TypeError')
    );
};

export const garbageCollect = () => {
    if (globalThis.gc) {
        // Use --expose_gc for V8 (and Node.js)
        // to pass this flag at chrome launch use: --js-flags="--expose-gc"
        // Exposed in SpiderMonkey shell as well
        globalThis.gc();
    } else if (globalThis.GCController) {
        // Present in some WebKit development environments
        globalThis.GCController.collect();
    } else {
        /* eslint-disable no-console */
        console.warn('Tests are running without the ability to do manual garbage collection. They will still work, but coverage will be suboptimal.');
    }
};

export const delay = ms => new Promise(resolve => step_timeout(resolve, ms));

// For tests which verify that the implementation doesn't do something it shouldn't, it's better not to use a
// timeout. Instead, assume that any reasonable implementation is going to finish work after 2 times around the event
// loop, and use flushAsyncEvents().then(() => assert_array_equals(...));
// Some tests include promise resolutions which may mean the test code takes a couple of event loop visits itself. So go
// around an extra 2 times to avoid complicating those tests.
export const flushAsyncEvents = () => delay(0).then(() => delay(0)).then(() => delay(0)).then(() => delay(0));
