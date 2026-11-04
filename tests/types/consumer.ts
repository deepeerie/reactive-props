import { reactive, ReactiveWrapper, type DeepPartial, type ReactiveWrapperType } from '../../dist';
import { BehaviorSubject } from 'rxjs';

interface State {
  user: { id: number; name?: string; settings: { darkMode: boolean } };
  theme: string;
  items: Array<{ id: number }>;
  optional?: number;
  date: Date;
}
const initial: State = {
  user: { id: 1, settings: { darkMode: false } }, theme: 'light', items: [{ id: 1 }], date: new Date(),
};
const state = new ReactiveWrapper(initial);
const fromFactory: ReactiveWrapperType<State> = reactive(initial);
const constructorType: ReactiveWrapper<State> = state;
state.theme = 'dark';
state.user.id = 2;
state.user.settings.darkMode$.next(true);
state.user$.next({ id: 2, settings: { darkMode: true } });
state.items$.next([{ id: 3 }]);
state.items.push({ id: 4 });
state.items.splice(0, 1, { id: 5 });
state.items.unshift({ id: 6 });
state.items[0].id$.next(5);
state.items.length$.next(0);
state.optional$.next(undefined);
const optional: BehaviorSubject<number | undefined> = state.observable('optional');
state.date.getTime();
state.date$.next(new Date());
state.updateData({ user: { settings: { darkMode: true } } });
const patch: DeepPartial<State> = { user: { id: 9 } };
state.updateData(patch);
// @ts-expect-error Incorrect scalar value.
state.theme$.next(1);
// @ts-expect-error Unknown property is not an untyped escape hatch.
state.missing;
// @ts-expect-error Nested subjects retain their types.
state.user.id$.next('bad');
// @ts-expect-error Unknown patch keys.
state.updateData({ typo: true });
// @ts-expect-error Arrays replace whole values, so their elements must be complete.
state.updateData({ items: [{}] });
// @ts-expect-error Unknown observable key.
state.observable('missing');
const token = Symbol('token');
const keys = reactive({ [token]: 1, 'a.b': false, price: 1, price$: 'USD' });
keys.observable(token).next(2);
keys['a.b$'].next(true);
keys.price$ = 'EUR';
keys.observable('price').next(4);
const arrayRoot = reactive([{ id: 1 }]);
arrayRoot.updateData([{ id: 2 }]);
arrayRoot[0].id$.next(3);
// @ts-expect-error Root arrays accept complete array elements.
arrayRoot.updateData([{}]);
void [fromFactory, constructorType, optional];
