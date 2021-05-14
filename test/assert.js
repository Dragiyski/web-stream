import node_util from 'node:util';
import { test } from 'mocha';
import { assert, AssertionError } from 'chai';

export function assert_unreached(message) {
    assert.fail(message || 'Executed code is supposed to be unreachable');
}

function bring_promise_to_current_realm(promise) {
    return new Promise(promise.then.bind(promise));
}

export function step_func(fn) {
    return _ => fn();
}

export function unreached_func(description) {
    return step_func(function () {
        assert_unreached(description);
    });
};

function merge(a, b) {
    const rv = {};
    let p;
    for (p in a) {
        rv[p] = a[p];
    }
    for (p in b) {
        rv[p] = b[p];
    }
    return rv;
}

function make_message(function_name, description, error, substitutions) {
    for (const p in substitutions) {
        if (Object.prototype.hasOwnProperty.call(substitutions, p)) {
            substitutions[p] = format_value(substitutions[p]);
        }
    }
    const node_form = substitute(['{text}', '${function_name}: ${description}' + error],
        merge(
            {
                function_name: function_name,
                description: (description ? description + ' ' : '')
            },
            substitutions
        )
    );
    return node_form.slice(1).join('');
}

function format_value(value) {
    return node_util.inspect(value);
}

function is_single_node(template) {
    return typeof template[0] === 'string';
}

function substitute(template, substitutions) {
    if (typeof template === 'function') {
        const replacement = template(substitutions);
        if (!replacement) {
            return null;
        }

        return substitute(replacement, substitutions);
    }

    if (is_single_node(template)) {
        return substitute_single(template, substitutions);
    }

    return filter(map(template, function (x) {
        return substitute(x, substitutions);
    }), function (x) { return x !== null; });
}

function filter(array, callable, thisObj) {
    const rv = [];
    for (let i = 0; i < array.length; i++) {
        if (Object.prototype.hasOwnProperty.call(array, i)) {
            const pass = callable.call(thisObj, array[i], i, array);
            if (pass) {
                rv.push(array[i]);
            }
        }
    }
    return rv;
}

function map(array, callable, thisObj) {
    const rv = [];
    rv.length = array.length;
    for (let i = 0; i < array.length; i++) {
        if (Object.prototype.hasOwnProperty.call(array, i)) {
            rv[i] = callable.call(thisObj, array[i], i, array);
        }
    }
    return rv;
}

function extend(array, items) {
    Array.prototype.push.apply(array, items);
}

function substitute_single(template, substitutions) {
    const substitution_re = /\$\{([^ }]*)\}/g;

    function do_substitution(input) {
        const components = input.split(substitution_re);
        const rv = [];
        for (let i = 0; i < components.length; i += 2) {
            rv.push(components[i]);
            if (components[i + 1]) {
                rv.push(String(substitutions[components[i + 1]]));
            }
        }
        return rv;
    }

    function substitute_attrs(attrs, rv) {
        rv[1] = {};
        for (const name in template[1]) {
            if (Object.prototype.hasOwnProperty.call(attrs, name)) {
                const new_name = do_substitution(name).join('');
                const new_value = do_substitution(attrs[name]).join('');
                rv[1][new_name] = new_value;
            }
        }
    }

    function substitute_children(children, rv) {
        for (let i = 0; i < children.length; i++) {
            if (children[i] instanceof Object) {
                const replacement = substitute(children[i], substitutions);
                if (replacement !== null) {
                    if (is_single_node(replacement)) {
                        rv.push(replacement);
                    } else {
                        extend(rv, replacement);
                    }
                }
            } else {
                extend(rv, do_substitution(String(children[i])));
            }
        }
        return rv;
    }

    const rv = [];
    rv.push(do_substitution(String(template[0])).join(''));

    if (template[0] === '{text}') {
        substitute_children(template.slice(1), rv);
    } else {
        substitute_attrs(template[1], rv);
        substitute_children(template.slice(2), rv);
    }

    return rv;
}

export function assert_throws_js_impl(constructor, func, description, assertion_type) {
    try {
        func.call(this);
        assert.fail(make_message(assertion_type, description, '${func} did not throw', { func: func }));
    } catch (e) {
        if (e instanceof AssertionError) {
            throw e;
        }

        // Basic sanity-checks on the thrown exception.
        assert(typeof e === 'object', make_message(
            assertion_type,
            description,
            '${func} threw ${e} with type ${type}, not an object',
            { func: func, e: e, type: typeof e }
        ));

        assert(e !== null, make_message(assertion_type, description, '${func} threw null, not an object', { func: func }));

        // Basic sanity-check on the passed-in constructor
        assert(typeof constructor === 'function', make_message(
            assertion_type,
            description,
            '${constructor} is not a constructor',
            { constructor: constructor }
        ));
        let obj = constructor;
        while (obj) {
            if (typeof obj === 'function' && obj.name === 'Error') {
                break;
            }
            obj = Object.getPrototypeOf(obj);
        }
        assert(obj != null, make_message(
            assertion_type,
            description,
            '${constructor} is not an Error subtype',
            { constructor: constructor }));

        // And checking that our exception is reasonable
        assert(e.constructor === constructor && e.name === constructor.name, make_message(
            assertion_type, description,
            '${func} threw ${actual} (${actual_name}) expected instance of ${expected} (${expected_name})',
            {
                func: func,
                actual: e,
                actual_name: e.name,
                expected: constructor,
                expected_name: constructor.name
            }
        ));
    }
}

export function assert_throws_js(constructor, func, description) {
    assert_throws_js_impl(constructor, func, description, 'assert_throws_js');
}

export function promise_rejects_js(test, constructor, promise, description) {
    return bring_promise_to_current_realm(promise)
        .then(unreached_func('Should have rejected: ' + description))
        .catch(function (e) {
            assert_throws_js_impl(constructor, function () { throw e; },
                description, 'promise_rejects_js');
        });
}

export function step_timeout(f, t) {
    const outer_this = this;
    const args = Array.prototype.slice.call(arguments, 2);
    return setTimeout(function () {
        f.apply(outer_this, args);
    }, t);
}

export function promise_rejects_exactly(test, exception, promise, description) {
    return bring_promise_to_current_realm(promise)
        .then(unreached_func('Should have rejected: ' + description))
        .catch(function (e) {
            assert_throws_exactly_impl(
                exception,
                function () { throw e; },
                description,
                'promise_rejects_exactly'
            );
        });
}

function assert_throws_exactly_impl(exception, func, description, assertion_type) {
    try {
        func.call(this);
        assert.fail(make_message(assertion_type, description, '${func} did not throw', { func: func }));
    } catch (e) {
        if (e instanceof AssertionError) {
            throw e;
        }

        assert.strictEqual(e, exception, make_message(
            assertion_type,
            description,
            '${func} threw ${e} but we expected it to throw ${exception}',
            { func: func, e: e, exception: exception }
        ));
    }
}

export function promise_test(title, test_function) {
    return test(title, function (done) {
        Promise.resolve(test_function()).then(() => { done(); }, error => { done(error); });
    });
};
