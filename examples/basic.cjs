const { ReactiveWrapper } = require('../dist/index.js');

const state = new ReactiveWrapper({
  user: { id: 1, settings: { darkMode: false, fontSize: 14 } },
  theme: 'light',
});

state.user$.subscribe(user => console.log('User:', JSON.stringify(user)));
state.theme$.subscribe(theme => console.log('Theme:', theme));

state.theme = 'dark';
state.theme$.next('green');
state.user.settings.darkMode = true;
state.user$.next({ id: 2, settings: { darkMode: false, fontSize: 16 } });
state.updateData({ user: { settings: { fontSize: 18 } } });
state.dispose();
