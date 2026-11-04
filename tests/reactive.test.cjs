'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { BehaviorSubject, map } = require('rxjs');
const { reactive, ReactiveWrapper } = require('../dist/index.js');

function collect(subject, snapshot = value => value) {
  const values = [];
  subject.subscribe(value => values.push(snapshot(value)));
  return values;
}

test('factory and constructor expose reactive state', () => {
  for (const state of [reactive({ count: 1 }), new ReactiveWrapper({ count: 1 })]) {
    assert.equal(state.count, 1);
    assert.equal(state.count$.value, 1);
    assert.ok(state.count$ instanceof BehaviorSubject);
    assert.equal(typeof state.updateData, 'function');
    assert.equal(typeof state.dispose, 'function');
  }
});

test('wrapping preserves source shape and writes through to raw data', () => {
  const raw = { user: { count: 1 } };
  const state = reactive(raw);
  assert.deepEqual(Reflect.ownKeys(raw), ['user']);
  assert.deepEqual(Reflect.ownKeys(raw.user), ['count']);
  assert.deepEqual(Object.keys(state), ['user']);
  state.user.count = 2;
  assert.equal(raw.user.count, 2);
  assert.equal(Object.hasOwn(raw, '__isProxy'), false);
  assert.equal(JSON.stringify(state), '{"user":{"count":2}}');
});

test('direct assignments emit only when Object.is changes', () => {
  const state = reactive({ count: 0 });
  const values = collect(state.count$);
  state.count = 0;
  state.count = NaN;
  state.count = NaN;
  state.count = 0;
  state.count = -0;
  assert.deepEqual(values, [0, NaN, 0, -0]);
});

test('subject.next updates raw state before subscribers run', () => {
  const raw = { count: 1 };
  const state = reactive(raw);
  const snapshots = [];
  state.count$.subscribe(value => snapshots.push([value, state.count, raw.count]));
  state.count$.next(2);
  state.count$.next(2);
  assert.deepEqual(snapshots, [[1, 1, 1], [2, 2, 2]]);
  assert.equal(state.count$.value, 2);
});

test('RxJS operators and unsubscribe work normally', () => {
  const state = reactive({ count: 1 });
  const values = [];
  const subscription = state.count$.pipe(map(value => value * 2)).subscribe(value => values.push(value));
  state.count$.next(2);
  subscription.unsubscribe();
  state.count = 3;
  assert.deepEqual(values, [2, 4]);
  assert.equal(state.count$.getValue(), 3);
});

test('nested mutation notifies the leaf and every ancestor subject', () => {
  const state = reactive({ user: { settings: { size: 14 } } });
  const leaf = collect(state.user.settings.size$);
  const settings = collect(state.user.settings$, value => value.size);
  const users = collect(state.user$, value => value.settings.size);
  state.user.settings.size = 16;
  assert.deepEqual(leaf, [14, 16]);
  assert.deepEqual(settings, [14, 16]);
  assert.deepEqual(users, [14, 16]);
});

test('replacement leaves saved streams bound to the old object', () => {
  const state = reactive({ user: { count: 1 } });
  const old = state.user;
  const oldValues = collect(old.count$);
  const users = collect(state.user$, value => value.count);
  state.user = { count: 10 };
  old.count = 2;
  state.user.count = 11;
  assert.deepEqual(oldValues, [1, 2]);
  assert.deepEqual(users, [1, 10, 11]);
  assert.equal(state.user.count, 11);
  assert.equal(state.user, state.user);
});

test('object subject.next installs a reactive replacement', () => {
  const state = reactive({ user: { count: 1 } });
  state.user$.next({ count: 10 });
  assert.equal(state.user$.value, state.user);
  assert.equal(state.user.count$.value, 10);
  state.user.count$.next(11);
  assert.equal(state.user.count, 11);
});

test('shared objects share proxy identity and notify both parents', () => {
  const shared = { count: 1 };
  const state = reactive({ left: shared, right: shared });
  assert.equal(state.left, state.right);
  assert.equal(state.left.count$, state.right.count$);
  const left = collect(state.left$, value => value.count);
  const right = collect(state.right$, value => value.count);
  state.left.count$.next(2);
  assert.deepEqual(left, [1, 2]);
  assert.deepEqual(right, [1, 2]);
});

test('replacing one alias detaches only that parent edge', () => {
  const shared = { count: 1 };
  const state = reactive({ left: shared, right: shared });
  const old = state.left;
  const left = collect(state.left$, value => value.count);
  const right = collect(state.right$, value => value.count);
  state.left = { count: 10 };
  old.count = 2;
  assert.deepEqual(left, [1, 10]);
  assert.deepEqual(right, [1, 2]);
});

test('self cycles preserve identity and notify without recursion', () => {
  const raw = { count: 1 };
  raw.self = raw;
  const state = reactive(raw);
  assert.equal(state.self, state);
  const counts = collect(state.count$);
  const selves = collect(state.self$, value => value.count);
  state.count = 2;
  assert.deepEqual(counts, [1, 2]);
  assert.deepEqual(selves, [1, 2]);
});

test('absent properties can be observed, created, and deleted', () => {
  const raw = {};
  const state = reactive(raw);
  const subject = state.optional$;
  const values = collect(subject);
  state.optional = 3;
  delete state.optional;
  assert.deepEqual(values, [undefined, 3, undefined]);
  assert.equal(state.optional$, subject);
  assert.equal(Object.hasOwn(raw, 'optional'), false);
});

test('literal dotted keys remain independent of nested keys', () => {
  const state = reactive({ 'a.b': 1, a: { b: 2 } });
  const dotted = collect(state.observable('a.b'));
  const nested = collect(state.a.b$);
  state['a.b'] = 3;
  state.a.b = 4;
  assert.deepEqual(dotted, [1, 3]);
  assert.deepEqual(nested, [2, 4]);
});

test('own dollar names win and observable resolves collisions', () => {
  const state = reactive({ name: 'a', name$: 'literal', count: 1 });
  assert.equal(state.name$, 'literal');
  assert.equal(state.observable('count'), state.count$);
  const names = collect(state.observable('name'));
  state.observable('name').next('b');
  state.observable('name$').next('changed');
  assert.deepEqual(names, ['a', 'b']);
  assert.equal(state.name$, 'changed');
});

test('symbol properties support two-way observation', () => {
  const key = Symbol('count');
  const raw = { [key]: 1 };
  const state = reactive(raw);
  const values = collect(state.observable(key));
  state.observable(key).next(2);
  state[key] = 3;
  assert.deepEqual(values, [1, 2, 3]);
  assert.equal(raw[key], 3);
});

test('array index extension notifies index and length subjects', () => {
  const state = reactive({ items: [1] });
  const lengths = collect(state.items.length$);
  const index = collect(state.items.observable(3));
  assert.equal(state.items.observable(3), state.items.observable('3'));
  state.items[3] = 4;
  assert.deepEqual(lengths, [1, 4]);
  assert.deepEqual(index, [undefined, 4]);
});

test('array truncation notifies removed indices and the parent', () => {
  const state = reactive({ items: [1, 2, 3] });
  const second = collect(state.items.observable(1));
  const third = collect(state.items.observable(2));
  const lengths = collect(state.items.length$);
  const arrays = collect(state.items$, value => [...value]);
  state.items.length = 1;
  assert.deepEqual(second, [2, undefined]);
  assert.deepEqual(third, [3, undefined]);
  assert.deepEqual(lengths, [3, 1]);
  assert.deepEqual(arrays, [[1, 2, 3], [1]]);
});

test('array mutators batch notifications around their final result', () => {
  const state = reactive({ items: [1, 2] });
  const arrays = collect(state.items$, value => [...value]);
  const lengths = collect(state.items.length$);
  assert.equal(state.items.push(3, 4), 4);
  assert.deepEqual(state.items.splice(1, 2, 9), [2, 3]);
  assert.equal(state.items.pop(), 4);
  assert.deepEqual(arrays, [[1, 2], [1, 2, 3, 4], [1, 9, 4], [1, 9]]);
  assert.deepEqual(lengths, [2, 4, 3, 2]);
});

test('deleting an array index preserves length', () => {
  const state = reactive({ items: [1, 2] });
  const indices = collect(state.items.observable(0));
  const lengths = collect(state.items.length$);
  delete state.items[0];
  assert.deepEqual(indices, [1, undefined]);
  assert.deepEqual(lengths, [2]);
});

test('patches merge plain objects and create missing object branches', () => {
  const state = reactive({ user: { name: 'A', settings: { dark: false, size: 14 } }, optional: undefined, empty: null });
  const user = state.user;
  const users = collect(state.user$, value => [value.settings.dark, value.settings.size]);
  state.updateData({ user: { settings: { dark: true, size: 16 } }, optional: { n: 3 }, empty: { n: 4 } });
  assert.equal(state.user, user);
  assert.deepEqual(state.user, { name: 'A', settings: { dark: true, size: 16 } });
  assert.deepEqual(users, [[false, 14], [true, 16]]);
  assert.equal(state.optional.n, 3);
  assert.equal(state.empty.n, 4);
});

test('patches assign explicit null and undefined', () => {
  const state = reactive({ first: { n: 1 }, second: 2 });
  const values = collect(state.second$);
  state.updateData({ first: null, second: undefined });
  assert.equal(state.first, null);
  assert.equal(Object.hasOwn(state, 'second'), true);
  assert.deepEqual(values, [2, undefined]);
});

test('array patches replace the array without stale elements or edges', () => {
  const state = reactive({ items: [{ n: 1 }, { n: 2 }] });
  const old = state.items;
  const arrays = collect(state.items$, value => value.map(item => item.n));
  state.updateData({ items: [{ n: 9 }] });
  old[0].n = 7;
  assert.notEqual(state.items, old);
  assert.deepEqual(state.items, [{ n: 9 }]);
  assert.deepEqual(arrays, [[1, 2], [9]]);
});

test('patches with custom prototypes and cycles are rejected', () => {
  const state = reactive({ count: 1, untouched: 2 });
  const inherited = Object.create({ untouched: 99 });
  inherited.count = 3;
  assert.throws(() => state.updateData(inherited), TypeError);
  const cycle = { count: 3 };
  cycle.self = cycle;
  assert.throws(() => state.updateData(cycle), TypeError);
  assert.equal(state.count, 1);
});

test('Date values remain atomic and can be replaced by a patch', () => {
  const first = new Date(0);
  const second = new Date(1000);
  const state = reactive({ when: first });
  assert.equal(state.when, first);
  assert.equal(state.when.getTime(), 0);
  const values = collect(state.when$, value => value.getTime());
  state.updateData({ when: second });
  assert.equal(state.when, second);
  assert.deepEqual(values, [0, 1000]);
});

test('dangerous writes and patches cannot alter prototypes', () => {
  const raw = { safe: 1 };
  const state = reactive(raw);
  const original = Object.getPrototypeOf(raw);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => { state[key] = {}; }, TypeError);
    const patch = JSON.parse(`{"safe":2,"${key}":{"reactivePropsPolluted":true}}`);
    assert.throws(() => state.updateData(patch), TypeError);
    assert.equal(state.safe, 1);
  }
  assert.equal(Object.getPrototypeOf(raw), original);
  assert.equal(Object.hasOwn(Object.prototype, 'reactivePropsPolluted'), false);
});

test('prototype changes and preventing extensions are rejected', () => {
  const state = reactive({ count: 1 });
  assert.throws(() => Object.setPrototypeOf(state, null), TypeError);
  assert.throws(() => Object.preventExtensions(state), TypeError);
  assert.equal(Object.isExtensible(state), true);
  state.count = 2;
  assert.equal(state.count, 2);
});

test('nonextensible objects and accessor properties are rejected', () => {
  assert.throws(() => reactive(Object.preventExtensions({ count: 1 })), TypeError);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'count', { enumerable: true, configurable: true,
    get() { getterCalls += 1; return 1; },
  });
  assert.throws(() => reactive(accessor), TypeError);
  assert.equal(getterCalls, 0);
});

test('defineProperty updates streams and rejects immutable descriptors', () => {
  const state = reactive({ count: 1 });
  const values = collect(state.count$);
  Object.defineProperty(state, 'count', { value: 2 });
  assert.deepEqual(values, [1, 2]);
  assert.throws(() => Object.defineProperty(state, 'count', { writable: false }), TypeError);
  Object.defineProperty(state, 'extra', { value: 3, configurable: true, writable: true, enumerable: true });
  assert.equal(state.extra$.value, 3);
});

test('reentrant subscribers can write another property', () => {
  const state = reactive({ count: 0, doubled: 0 });
  state.count$.subscribe(value => { state.doubled = value * 2; });
  const doubled = collect(state.doubled$);
  state.count$.next(2);
  assert.deepEqual(doubled, [0, 4]);
});

test('repeated wrapping does not contaminate the raw object', () => {
  const raw = { user: { count: 1 } };
  const first = reactive(raw);
  const second = reactive(raw);
  assert.equal(first.user.count$.value, 1);
  assert.equal(second.user.count$.value, 1);
  second.user.count$.next(2);
  assert.equal(second.user.count, 2);
});

test('dispose completes root and nested streams once and is idempotent', () => {
  const state = reactive({ count: 1, user: { count: 2 } });
  const subjects = [state.count$, state.user$, state.user.count$];
  const completions = [0, 0, 0];
  subjects.forEach((subject, index) => subject.subscribe({ complete() { completions[index] += 1; } }));
  state.dispose();
  state.dispose();
  assert.deepEqual(completions, [1, 1, 1]);
});

test('disposed state rejects writes and new streams but preserves old reads', () => {
  const state = reactive({ count: 1, user: { count: 2 } });
  const subject = state.count$;
  const user = state.user;
  state.dispose();
  assert.equal(state.count$, subject);
  assert.equal(subject.value, 1);
  assert.throws(() => { state.count = 3; }, TypeError);
  assert.throws(() => { user.count = 3; }, TypeError);
  assert.throws(() => subject.next(3), TypeError);
  assert.throws(() => state.updateData({ count: 3 }), TypeError);
  assert.throws(() => state.observable('missing'), TypeError);
});

test('manually closed subjects do not break other state updates', () => {
  const state = reactive({ count: 1 });
  state.count$.unsubscribe();
  let errorHandlerCalled = false;
  assert.throws(() => state.count$.subscribe({ error: () => { errorHandlerCalled = true; } }),
    { name: 'ObjectUnsubscribedError' });
  assert.equal(errorHandlerCalled, false);
  state.count = 2;
  assert.equal(state.count, 2);
  state.dispose();
});

test('requiring the built entry is silent and succeeds in a fresh process', () => {
  const entry = path.resolve(__dirname, '../dist/index.js');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)})`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('batch callbacks read the current value of other subjects', () => {
  const state = reactive({ a: 0, b: 0 });
  const b = state.b$;
  const snapshots = [];
  state.a$.subscribe(value => {
    if (value === 1) snapshots.push([state.b, b.value, b.getValue()]);
  });
  state.updateData({ a: 1, b: 10 });
  assert.deepEqual(snapshots, [[10, 10, 10]]);
});

test('reentrant writes use the current value instead of overwriting a patch', () => {
  const state = reactive({ a: 0, b: 0 });
  const b = state.b$;
  state.a$.subscribe(value => {
    if (value === 1) b.next(b.value + 1);
  });
  const values = collect(b);
  state.updateData({ a: 1, b: 10 });
  assert.equal(state.b, 11);
  assert.deepEqual(values, [0, 11]);
});

test('subscriptions opened during a batch receive the current initial value', () => {
  const { take } = require('rxjs');
  const state = reactive({ a: 0, b: 0 });
  const b = state.b$;
  const values = [];
  state.a$.subscribe(value => {
    if (value === 1) b.asObservable().pipe(take(1)).subscribe(current => values.push(current));
  });
  state.updateData({ a: 1, b: 10 });
  assert.deepEqual(values, [10]);
});

test('array index subscribers see the current length subject value', () => {
  const state = reactive({ items: [1, 2, 3] });
  const length = state.items.length$;
  const sizes = [];
  state.items.observable(0).subscribe(value => {
    if (value === 3) sizes.push([state.items.length, length.value]);
  });
  state.items.splice(0, 2);
  assert.deepEqual(sizes, [[1, 1]]);
});

test('dispose during a batch preserves the final values of completed streams', () => {
  const state = reactive({ a: 0, b: 0 });
  const b = state.b$;
  let completed = false;
  b.subscribe({ complete: () => { completed = true; } });
  state.a$.subscribe(value => {
    if (value === 1) state.dispose();
  });
  state.updateData({ a: 1, b: 10 });
  assert.equal(completed, true);
  assert.equal(b.value, 10);
  assert.equal(state.b, 10);
});

test('root arrays replace contents and preserve subscriptions and sparse holes', () => {
  const raw = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const state = reactive(raw);
  const first = collect(state.observable(0), value => value?.id);
  const second = collect(state.observable(1), value => value?.id);
  const lengths = collect(state.length$);
  state.updateData([{ id: 9 }]);
  assert.deepEqual(raw, [{ id: 9 }]);
  assert.deepEqual(first, [1, 9]);
  assert.deepEqual(second, [2, undefined]);
  assert.deepEqual(lengths, [3, 1]);
  const sparse = new Array(3);
  sparse[2] = { id: 10 };
  state.updateData(sparse);
  assert.equal(state.length, 3);
  assert.equal(Object.hasOwn(state, '0'), false);
  assert.equal(Object.hasOwn(state, '1'), false);
  assert.equal(state[2].id$.value, 10);
  assert.throws(() => state.updateData({ 0: { id: 1 } }), TypeError);
  const hidden = new Array(1);
  Object.defineProperty(hidden, '0', { get() { throw new Error('must not read'); } });
  state.updateData(hidden);
  assert.equal(state.length, 1);
  assert.equal(Object.hasOwn(state, '0'), false);
});

test('completed and errored subjects retain RxJS terminal behavior', () => {
  const state = reactive({ a: 1, b: 2 });
  const a = state.a$;
  a.complete();
  state.a = 3;
  assert.equal(a.value, 1);
  const values = collect(a);
  assert.deepEqual(values, []);
  const b = state.b$;
  const reason = new Error('stopped');
  b.error(reason);
  assert.throws(() => b.getValue(), error => error === reason);
  const errors = [];
  b.subscribe({ error: error => errors.push(error) });
  assert.deepEqual(errors, [reason]);
  state.dispose();
});
