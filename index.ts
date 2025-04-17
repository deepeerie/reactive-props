import { BehaviorSubject } from 'rxjs';
import { injectable, Container } from 'inversify';
import 'reflect-metadata';

type ReactiveSubjects<T> = {
  [K in keyof T as `${string & K}$`]: T[K] extends object 
    ? ReactiveSubjects<T[K]> & BehaviorSubject<T[K]>
    : BehaviorSubject<T[K]>;
} & T & {
  [key: string]: any;
};

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

interface IReactiveWrapper<T extends object> {
  updateData(newData: DeepPartial<T>): void;
}

type ReactiveWrapperType<T extends object> = ReactiveSubjects<T> & IReactiveWrapper<T>;

@injectable()
export class ReactiveWrapper<T extends object> implements IReactiveWrapper<T> {
  private subjects = new Map<string, BehaviorSubject<any>>();
  private proxy: ReactiveWrapperType<T>;

  constructor(target: T) {
    this.proxy = this.createProxy(target, '') as ReactiveWrapperType<T>;
    Object.assign(this.proxy, {
      updateData: this.updateData.bind(this)
    });

    // @ts-ignore
    return this.proxy;
  }

  private createProxy(obj: any, path: string): any {
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
        this.subjects.set(subjectPath, new BehaviorSubject(obj[key]));
      }

      if (typeof obj[key] === 'object' && obj[key] !== null) {
        obj[key] = this.createProxy(obj[key], subjectPath);
      }
    }

    return new Proxy(obj, {
      get: (target, prop: string) => {
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
      set: (target, prop: string, value) => {
        const subjectPath = path ? `${path}.${prop}` : prop;
        const prevValue = target[prop];
        target[prop] = value;

        if (prevValue !== value) {
          this.subjects.get(subjectPath)?.next(value);
          this.updateParentSubjects(subjectPath);
        }

        return true;
      }
    });
  }

  private updateParentSubjects(changedPath: string): void {
    const parts = changedPath.split('.');
    while (parts.pop()) {
      const parentPath = parts.join('.');
      if (parentPath) {
        const parentValue = this.getNestedValue(parentPath);
        this.subjects.get(parentPath)?.next(parentValue);
      }
    }
  }

  private getNestedValue(path: string): any {
    return path.split('.').reduce((obj, key) => obj?.[key], this.proxy);
  }

  updateData(newData: DeepPartial<T>): void {
    this.deepUpdate(this.proxy, newData);
  }

  private deepUpdate(target: any, source: any): void {
    for (const key in source) {
      if (source[key] !== undefined) { // Проверяем, что свойство существует
        if (typeof source[key] === 'object' && source[key] !== null) {
          this.deepUpdate(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
  }
}

interface UserSettings {
  darkMode: boolean;
  fontSize: number;
}

interface AppState {
  user: {
    id: number;
    settings: UserSettings;
  };
  theme: string;
}

const container = new Container();

container.bind<AppState>('AppState').toConstantValue({
  user: {
    id: 1,
    settings: {
      darkMode: false,
      fontSize: 14
    }
  },
  theme: 'light'
});

container.bind<ReactiveWrapperType<AppState>>('ReactiveWrapper')
  .toDynamicValue(ctx => {
    const data = ctx.get<AppState>('AppState');
    
    return new ReactiveWrapper(data) as unknown as ReactiveWrapperType<AppState>;
  });

  
const wrapper = container.get<ReactiveWrapperType<AppState>>('ReactiveWrapper');

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
