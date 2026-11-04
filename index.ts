import { BehaviorSubject, Observable, ObjectUnsubscribedError, type Observer, type Subscription } from 'rxjs';

/** Built-ins are values: replace them to notify, rather than proxying their internals. */
type Atomic = Date | RegExp | Error | Function | Promise<unknown>
  | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
  | WeakMap<object, unknown> | WeakSet<object> | ArrayBuffer | ArrayBufferView;

export type DeepPartial<T> = T extends Atomic | readonly unknown[] ? T
  : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type ReactiveValue<T> = T extends Atomic ? T
  : T extends object ? ReactiveSubjects<T> : T;

export type ReactiveSubjects<T extends object> = {
  // Key remapping keeps array methods accepting raw elements instead of
  // TypeScript rebuilding an Array<ReactiveValue<Element>> for this mapping.
  [K in keyof T as K]: ReactiveValue<T[K]>;
} & {
  [K in keyof T as K extends string | number
    ? `${K}$` extends keyof T ? never : `${K}$` : never]-?: BehaviorSubject<T[K]>;
} & {
  observable<K extends keyof T>(key: K): BehaviorSubject<T[K]>;
};

export interface IReactiveWrapper<T extends object> {
  updateData(data: DeepPartial<T>): void;
  dispose(): void;
}

export type ReactiveWrapperType<T extends object> = ReactiveSubjects<T> & IReactiveWrapper<T>;
export type ReactiveWrapper<T extends object> = ReactiveWrapperType<T>;

type Key = string | symbol;
interface Node {
  raw: object;
  proxy: object;
  children: Map<Key, Node>;
  parents: Map<Node, Set<Key>>;
  subjects: Map<Key, PropertySubject>;
  methods: Map<Key, Function>;
}

const rawTargets = new WeakMap<object, object>();
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const arrayMutators = new Set(['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']);
const own = (object: object, key: Key): boolean => Object.prototype.hasOwnProperty.call(object, key);
const normalizeKey = (key: PropertyKey): Key => typeof key === 'symbol' ? key : String(key);

function unwrap(value: unknown): unknown {
  return value !== null && typeof value === 'object' ? rawTargets.get(value) ?? value : value;
}

function isRecord(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isContainer(value: unknown): value is object {
  return Array.isArray(value) || isRecord(value);
}

function assertKey(key: Key, root: boolean): void {
  if (typeof key === 'string' && (unsafeKeys.has(key) || key === 'observable'
    || (root && (key === 'updateData' || key === 'dispose')))) {
    throw new TypeError(`Reserved reactive property: ${key}`);
  }
}

/** Validate before proxying; this also avoids Proxy invariants on frozen data. */
function validateGraph(value: unknown, root: object, seen = new WeakSet<object>()): void {
  value = unwrap(value);
  if (!isContainer(value) || seen.has(value)) return;
  seen.add(value);
  if (!Object.isExtensible(value)) throw new TypeError('Reactive objects must be extensible');
  for (const key of Reflect.ownKeys(value)) {
    assertKey(key, value === root);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const length = Array.isArray(value) && key === 'length';
    if (!('value' in descriptor) || !descriptor.writable || (!descriptor.configurable && !length)) {
      throw new TypeError('Reactive objects require mutable data properties');
    }
    validateGraph(descriptor.value, root, seen);
  }
}

class PropertySubject extends BehaviorSubject<unknown> {
  private snapshot: unknown;

  constructor(private readonly store: Store, readonly node: Node, readonly key: Key) {
    super(store.read(node, key));
    this.snapshot = super.getValue();
  }

  override getValue(): unknown {
    // Preserve RxJS error/unsubscribe behavior, but read live data while active.
    // Other streams may still be waiting for their notification in this batch.
    super.getValue();
    return this.isStopped ? this.snapshot : this.store.read(this.node, this.key);
  }

  override subscribe(
    observerOrNext?: Partial<Observer<unknown>> | ((value: unknown) => void) | null,
    error?: ((error: unknown) => void) | null,
    complete?: (() => void) | null,
  ): Subscription {
    if (this.closed) throw new ObjectUnsubscribedError();
    // BehaviorSubject's initial emission uses its own cached value. Substitute
    // the live value for subscriptions opened during a pending notification.
    return new Observable<unknown>(subscriber => {
      let initial = true;
      return super.subscribe({
        next: value => {
          const current = initial ? this.getValue() : value;
          initial = false;
          subscriber.next(current);
        },
        error: reason => subscriber.error(reason),
        complete: () => subscriber.complete(),
      });
    }).subscribe(typeof observerOrNext === 'object' && observerOrNext !== null
      ? observerOrNext
      : { next: observerOrNext ?? undefined, error: error ?? undefined, complete: complete ?? undefined });
  }

  override next(value: unknown): void {
    this.store.assertActive();
    if (this.closed) throw new ObjectUnsubscribedError();
    if (!this.isStopped) this.store.write(this.node, this.key, value);
  }

  publish(): void {
    if (!this.closed && !this.isStopped) {
      this.snapshot = this.store.read(this.node, this.key);
      super.next(this.snapshot);
    }
  }

  override complete(): void {
    if (!this.closed && !this.isStopped) this.snapshot = this.store.read(this.node, this.key);
    super.complete();
  }
}

class Store {
  private readonly nodes = new WeakMap<object, Node>();
  private readonly subjects = new Set<PropertySubject>();
  private readonly pending = new Set<PropertySubject>();
  private depth = 0;
  private flushing = false;
  private disposed = false;
  private readonly rootNode: Node;
  readonly proxy: object;

  constructor(private readonly target: object) {
    if (!isContainer(target)) throw new TypeError('Wrap a plain object or array');
    validateGraph(target, target);
    this.rootNode = this.nodeFor(target);
    this.proxy = this.rootNode.proxy;
  }

  assertActive(): void {
    if (this.disposed) throw new TypeError('Reactive wrapper has been disposed');
  }

  private nodeFor(raw: object): Node {
    const existing = this.nodes.get(raw);
    if (existing) return existing;
    const node: Node = {
      raw, proxy: raw, children: new Map(), parents: new Map(), subjects: new Map(), methods: new Map(),
    };
    this.nodes.set(raw, node);
    const observable = (key: PropertyKey) => this.subject(node, normalizeKey(key));
    node.proxy = new Proxy(raw, {
      get: (_target, key, receiver) => {
        if (key === 'observable') return observable;
        if (raw === this.target && key === 'updateData') return this.updateData;
        if (raw === this.target && key === 'dispose') return this.dispose;
        // Real data keys win over the shorthand, e.g. { price: 1, price$: 'USD' }.
        if (typeof key === 'string' && key.endsWith('$') && !own(raw, key)) {
          return this.subject(node, key.slice(0, -1));
        }
        const value = Reflect.get(raw, key, receiver);
        if (Array.isArray(raw) && typeof key === 'string' && arrayMutators.has(key)
          && value === Reflect.get(Array.prototype, key)) {
          if (!node.methods.has(key)) {
            const store = this;
            node.methods.set(key, function (this: unknown, ...args: unknown[]) {
              store.assertActive();
              return store.batch(() => Reflect.apply(value, this, args));
            });
          }
          return node.methods.get(key);
        }
        return this.view(value);
      },
      set: (_target, key, value) => this.write(node, key, value),
      deleteProperty: (_target, key) => this.remove(node, key),
      defineProperty: (_target, key, descriptor) => this.define(node, key, descriptor),
      setPrototypeOf: () => { throw new TypeError('Reactive object prototypes cannot change'); },
      preventExtensions: () => { throw new TypeError('Reactive objects must remain extensible'); },
    });
    rawTargets.set(node.proxy, raw);
    for (const key of Reflect.ownKeys(raw)) this.relink(node, key);
    return node;
  }

  private view(value: unknown): unknown {
    const raw = unwrap(value);
    return isContainer(raw) ? this.nodeFor(raw).proxy : raw;
  }

  read(node: Node, key: Key): unknown {
    return this.view(Reflect.get(node.raw, key));
  }

  private subject(node: Node, key: Key): PropertySubject {
    assertKey(key, node.raw === this.target);
    let subject = node.subjects.get(key);
    if (!subject) {
      this.assertActive();
      subject = new PropertySubject(this, node, key);
      node.subjects.set(key, subject);
      this.subjects.add(subject);
    }
    return subject;
  }

  private relink(node: Node, key: Key): void {
    const previous = node.children.get(key);
    if (previous) {
      const keys = previous.parents.get(node)!;
      keys.delete(key);
      if (keys.size === 0) previous.parents.delete(node);
      node.children.delete(key);
    }
    const value = own(node.raw, key) ? unwrap(Reflect.get(node.raw, key)) : undefined;
    if (isContainer(value)) {
      const child = this.nodeFor(value);
      node.children.set(key, child);
      let keys = child.parents.get(node);
      if (!keys) child.parents.set(node, keys = new Set());
      keys.add(key);
    }
  }

  private changed(node: Node, key: Key): void {
    const enqueue = (owner: Node, property: Key) => {
      const subject = owner.subjects.get(property);
      if (subject) this.pending.add(subject);
    };
    enqueue(node, key);
    const visited = new Set<Node>();
    const work = [node];
    while (work.length) {
      const current = work.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const [parent, keys] of current.parents) {
        for (const property of keys) enqueue(parent, property);
        work.push(parent);
      }
    }
  }

  private batch<T>(operation: () => T): T {
    this.depth++;
    try { return operation(); }
    finally {
      this.depth--;
      if (this.depth === 0 && !this.flushing) {
        this.flushing = true;
        try {
          while (this.pending.size) {
            const subject = this.pending.values().next().value!;
            this.pending.delete(subject);
            subject.publish();
          }
        } finally { this.flushing = false; }
      }
    }
  }

  write(node: Node, key: Key, value: unknown): boolean {
    const old = Object.getOwnPropertyDescriptor(node.raw, key);
    return this.define(node, key, {
      value, writable: old?.writable ?? true,
      enumerable: old?.enumerable ?? true, configurable: old?.configurable ?? true,
    });
  }

  private define(node: Node, key: Key, descriptor: PropertyDescriptor): boolean {
    this.assertActive();
    assertKey(key, node.raw === this.target);
    const old = Object.getOwnPropertyDescriptor(node.raw, key);
    const next = { ...old, ...descriptor };
    const length = Array.isArray(node.raw) && key === 'length';
    if ('get' in next || 'set' in next || !next.writable || (!next.configurable && !length)) {
      throw new TypeError('Reactive objects require mutable data properties');
    }
    const value = unwrap('value' in next ? next.value : undefined);
    validateGraph(value, this.target);
    return this.batch(() => {
      const oldLength = Array.isArray(node.raw) ? node.raw.length : undefined;
      const oldKeys = length ? Reflect.ownKeys(node.raw) : [];
      const success = Reflect.defineProperty(node.raw, key, { ...next, value });
      if (!success) return false;
      this.relink(node, key);
      if (!old || !Object.is(unwrap(old.value), value) || old.enumerable !== next.enumerable) {
        this.changed(node, key);
      }
      for (const removed of oldKeys) {
        if (!own(node.raw, removed)) {
          this.relink(node, removed);
          this.changed(node, removed);
        }
      }
      if (Array.isArray(node.raw) && oldLength !== node.raw.length && key !== 'length') {
        this.changed(node, 'length');
      }
      return true;
    });
  }

  private remove(node: Node, key: Key): boolean {
    this.assertActive();
    assertKey(key, node.raw === this.target);
    if (!own(node.raw, key)) return true;
    return this.batch(() => {
      if (!Reflect.deleteProperty(node.raw, key)) return false;
      this.relink(node, key);
      this.changed(node, key);
      return true;
    });
  }

  private readonly updateData = (data: unknown): void => {
    this.assertActive();
    const arrayRoot = Array.isArray(this.target);
    if (!isContainer(data) || (arrayRoot ? !Array.isArray(data) : !isRecord(data))) {
      throw new TypeError(arrayRoot ? 'updateData expects an array' : 'updateData expects a plain object patch');
    }
    // Validate the whole patch before applying it, including unsafe keys and cycles.
    const visiting = new WeakSet<object>();
    const validate = (value: unknown, root: boolean): void => {
      if (!isContainer(value)) return;
      if (visiting.has(value)) throw new TypeError('Cyclic patches are not supported');
      visiting.add(value);
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable) continue;
        assertKey(key, root);
        if (!('value' in descriptor)) throw new TypeError('Patches require data properties');
        validate(descriptor.value, false);
      }
      visiting.delete(value);
    };
    validate(data, true);
    if (Array.isArray(data)) {
      // A root proxy cannot be replaced. Replace its contents, including holes,
      // while keeping its identity and existing index/length subscriptions.
      const entries = Reflect.ownKeys(data).filter(key => Object.getOwnPropertyDescriptor(data, key)!.enumerable)
        .map(key => [key, Object.getOwnPropertyDescriptor(data, key)!.value] as const);
      const keys = new Set(entries.map(([key]) => key));
      const length = data.length;
      this.batch(() => {
        for (const key of Reflect.ownKeys(this.target)) {
          if (key !== 'length' && !keys.has(key)) this.remove(this.rootNode, key);
        }
        for (const [key, value] of entries) this.write(this.rootNode, key, value);
        this.write(this.rootNode, 'length', length);
      });
      return;
    }
    const merge = (node: Node, source: object): void => {
      for (const key of Reflect.ownKeys(source)) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
        if (!descriptor.enumerable) continue;
        const incoming = unwrap(descriptor.value);
        const current = own(node.raw, key) ? unwrap(Reflect.get(node.raw, key)) : undefined;
        if (isRecord(incoming) && isRecord(current)) merge(this.nodeFor(current), incoming);
        else this.write(node, key, incoming);
      }
    };
    this.batch(() => merge(this.rootNode, data));
  };

  private readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    for (const subject of this.subjects) if (!subject.closed) subject.complete();
    this.subjects.clear();
  };
}

/** Wrap mutable plain data without adding metadata or methods to the source object. */
export function reactive<T extends object>(target: T): ReactiveWrapperType<T> {
  return new Store(unwrap(target) as object).proxy as ReactiveWrapperType<T>;
}

/** Constructor form retained for compatibility with the original prototype. */
export const ReactiveWrapper = function ReactiveWrapper<T extends object>(target: T) {
  return reactive(target);
} as unknown as { new <T extends object>(target: T): ReactiveWrapperType<T> };
