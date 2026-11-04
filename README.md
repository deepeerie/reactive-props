# reactive-props

Turn a mutable JavaScript object into typed, reactive properties backed by RxJS.
Read and assign ordinary properties, subscribe through `property$`, and write through
`property$.next(value)`. Both write paths update the same underlying object.

## Run this repository

Requires Node.js 20+ and npm. From the repository directory:

```sh
npm ci
npm test
npm run example
```

`npm run build` creates `dist/index.js` and TypeScript declarations. `npm pack`
builds, checks, and creates an installable package. Install that local `.tgz` in a
consumer project; publication to npm is a separate step. The runtime only depends
on RxJS; it does not require decorators, reflection, or a DI container.

## Usage

```ts
import { ReactiveWrapper, reactive } from 'reactive-props';

const state = new ReactiveWrapper({
  user: { id: 1, settings: { darkMode: false, fontSize: 14 } },
  theme: 'light',
});
// reactive(data) is the equivalent factory form.

const subscription = state.theme$.subscribe(theme => console.log(theme));
// Immediately prints "light".
state.theme = 'dark';           // Prints "dark".
state.theme$.next('green');     // Prints "green"; state.theme is now "green".

state.user.settings.darkMode$.subscribe(console.log);
state.user.settings.darkMode = true;

// Object replacement; the new branch is reactive immediately.
state.user$.next({ id: 2, settings: { darkMode: false, fontSize: 16 } });

// Merge a partial object without losing sibling fields.
state.updateData({ user: { settings: { fontSize: 18 } } });

subscription.unsubscribe();
state.dispose(); // Complete every property stream and prevent further writes.
```

CommonJS is also supported: `const { reactive } = require('reactive-props')`.
Importing the library has no demo side effects. The executable example lives in
[`examples/basic.cjs`](examples/basic.cjs).

## Behavior

- A property stream is a real RxJS `BehaviorSubject`: initial value, `value`,
  `getValue()`, `pipe()`, `asObservable()`, and subscription cleanup work normally.
  `.next()` writes the property. Assigning an `Object.is`-equal value is silent.
- Nested changes notify the changed property and each live ancestor property.
  Object emissions are live proxies, not immutable snapshots. Copy the fields you
  need inside a subscriber if you want to keep historical values.
- Proxies and streams follow **object identity**. Repeated reads return the same
  proxy. Shared references and cycles are supported. A saved `oldUser.id$` keeps
  observing the old object after `state.user` is replaced; it does not switch paths.
  To follow replacements, use RxJS:

  ```ts
  import { switchMap } from 'rxjs';
  const ids$ = state.user$.pipe(switchMap(() => state.user.id$));
  ```

- New properties and deletion are observable. You may obtain a stream before an
  optional property exists; its first value is `undefined`.
- `updateData()` merges own enumerable fields of plain object patches, creates
  missing branches, and replaces arrays and atomic values. Explicit `undefined`
  and `null` are assignments. Cyclic patches and custom-prototype root patches
  are rejected. For a wrapped root array, `updateData(array)` replaces its contents
  while retaining the root proxy and its index/length streams. Patches are
  synchronous, not rollback transactions.
- `updateData()` and ordinary array mutator calls batch notifications until the
  operation finishes. Each affected stream emits its final value once per batch.
  Direct index writes, sparse arrays, length changes, and deletions are tracked.
  Reads of `.value` and new subscriptions see current data even while other
  notifications are pending. A subscriber's writes can trigger further emissions.
- Properties containing dots or symbols work. `object.observable(key)` selects a
  property explicitly. Real own names ending in `$` take precedence over shorthand:
  for `{ price: 1, price$: 'USD' }`, use `observable('price')` for the price stream.
- `dispose()` is idempotent. Existing streams complete, ordinary reads remain
  available, and further writes or creation of streams throw `TypeError`.
  Completing/erroring/unsubscribing a subject yourself stops that stream only.

## Data and TypeScript boundaries

Wrap extensible plain objects (including null-prototype records) or arrays with
mutable data properties. Getters/setters, frozen/sealed objects, and prototype
changes are rejected explicitly. `observable` is reserved on wrapped objects;
`updateData` and `dispose` are also reserved at the root. `__proto__`, `constructor`,
and `prototype` cannot be data keys or patch keys.

Dates, Maps, Sets, functions, and class instances are atomic values. Their internal
mutations are not observed; replace the owning property to notify. Built-in atomic
values retain their TypeScript types. Custom class instances should stay outside
the reactive data model because TypeScript cannot distinguish them from structural
plain object types.

Always mutate through the returned proxy or its subjects. Writes to the original
raw object, atomic internals, or through a separate wrapper over the same raw object
cannot notify this wrapper. The wrapper adds no flags, methods, or proxies to the
source object's own properties.

TypeScript infers nested streams and rejects wrong value/patch types. For replacing
an entire object or array in TypeScript, use `property$.next(rawValue)` or
`updateData()`. A direct replacement such as `state.user = rawUser` works in
JavaScript, but TypeScript's mapped property types cannot express different read
(reactive) and write (raw) types. Scalar assignments and array methods are typed
normally. Arrays in `DeepPartial<T>` still require complete elements because a patch
replaces the array rather than merging its indices.

## Checks

```sh
npm test             # build + public declaration typecheck + behavioral tests
npm run test:package # install tarball in an isolated consumer; check CJS, ESM, types
npm run example      # executable version of the original idea
npm pack             # checked, installable tarball
```

Tests cover both write paths, nested notifications, object replacement, aliases and
cycles, array operations, patching, dynamic keys, RxJS integration, disposal,
prototype protection, and silent imports. CI runs the same checks on Node 20/22/24.
