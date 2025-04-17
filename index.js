"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReactiveWrapper = void 0;
const rxjs_1 = require("rxjs");
const inversify_1 = require("inversify");
require("reflect-metadata");
let ReactiveWrapper = (() => {
    let _classDecorators = [(0, inversify_1.injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ReactiveWrapper = _classThis = class {
        constructor(target) {
            this.subjects = new Map();
            this.proxy = this.createProxy(target, '');
            Object.assign(this.proxy, {
                updateData: this.updateData.bind(this)
            });
            // @ts-ignore
            return this.proxy;
        }
        createProxy(obj, path) {
            if (obj && obj.__isProxy) {
                return obj;
            }
            Object.defineProperty(obj, '__isProxy', {
                value: true,
                enumerable: false,
                configurable: false
            });
            for (const key in obj) {
                const subjectPath = path ? `${path}.${key}` : key;
                if (!this.subjects.has(subjectPath)) {
                    this.subjects.set(subjectPath, new rxjs_1.BehaviorSubject(obj[key]));
                }
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    obj[key] = this.createProxy(obj[key], subjectPath);
                }
            }
            return new Proxy(obj, {
                get: (target, prop) => {
                    if (typeof prop === 'string' && prop.endsWith('$')) {
                        const originalProp = prop.slice(0, -1);
                        const subjectPath = path ? `${path}.${originalProp}` : originalProp;
                        return this.subjects.get(subjectPath);
                    }
                    if (typeof target[prop] === 'object' && target[prop] !== null) {
                        return this.createProxy(target[prop], path ? `${path}.${prop}` : prop);
                    }
                    return target[prop];
                },
                set: (target, prop, value) => {
                    var _a;
                    const subjectPath = path ? `${path}.${prop}` : prop;
                    const prevValue = target[prop];
                    target[prop] = value;
                    if (prevValue !== value) {
                        (_a = this.subjects.get(subjectPath)) === null || _a === void 0 ? void 0 : _a.next(value);
                        this.updateParentSubjects(subjectPath);
                    }
                    return true;
                }
            });
        }
        updateParentSubjects(changedPath) {
            var _a;
            const parts = changedPath.split('.');
            while (parts.pop()) {
                const parentPath = parts.join('.');
                if (parentPath) {
                    const parentValue = this.getNestedValue(parentPath);
                    (_a = this.subjects.get(parentPath)) === null || _a === void 0 ? void 0 : _a.next(parentValue);
                }
            }
        }
        getNestedValue(path) {
            return path.split('.').reduce((obj, key) => obj === null || obj === void 0 ? void 0 : obj[key], this.proxy);
        }
        updateData(newData) {
            this.deepUpdate(this.proxy, newData);
        }
        deepUpdate(target, source) {
            for (const key in source) {
                if (source[key] !== undefined) { // Проверяем, что свойство существует
                    if (typeof source[key] === 'object' && source[key] !== null) {
                        this.deepUpdate(target[key], source[key]);
                    }
                    else {
                        target[key] = source[key];
                    }
                }
            }
        }
    };
    __setFunctionName(_classThis, "ReactiveWrapper");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ReactiveWrapper = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ReactiveWrapper = _classThis;
})();
exports.ReactiveWrapper = ReactiveWrapper;
const container = new inversify_1.Container();
container.bind('AppState').toConstantValue({
    user: {
        id: 1,
        settings: {
            darkMode: false,
            fontSize: 14
        }
    },
    theme: 'light'
});
container.bind('ReactiveWrapper')
    .toDynamicValue(ctx => {
    const data = ctx.get('AppState');
    return new ReactiveWrapper(data);
});
const wrapper = container.get('ReactiveWrapper');
wrapper.user$.subscribe(value => {
    console.log('User updated:', value);
});
wrapper.theme$.subscribe(value => {
    console.log('Theme changed:', value);
});
wrapper.updateData({
    user: {
        id: 1,
        settings: {
            darkMode: false,
            fontSize: 14
        }
    },
    theme: 'dark'
});
wrapper.user = {
    id: 444444,
    settings: {
        darkMode: true,
        fontSize: 11111111
    }
};
wrapper.user$.next({
    id: 99999999,
    settings: {
        darkMode: true,
        fontSize: 555555
    }
});
wrapper.updateData({
    user: {
        settings: {
            darkMode: false
        }
    }
});
wrapper.updateData({
    theme: 'super-green'
});
