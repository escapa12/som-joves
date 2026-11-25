import { render } from 'preact';
import { boot, useStore } from './core/store';
import { registerSW } from './core/push';
import { useRoute } from './core/router';
import { modules } from './modules';
import { Join } from './shell/Join';
import { Home } from './shell/Home';
import { MemberDetail, MembersList } from './shell/Members';
import { Audit } from './shell/Audit';
import './ui/styles.css';

function App() {
  const { ready, meId, toast } = useStore();
  const path = useRoute();
  let page;
  if (!ready) page = <div class="splash">🍻</div>;
  else if (!meId) page = <Join />;
  else {
    const [root, ...rest] = path;
    const mod = modules.find((m) => m.id === root);
    if (mod) page = <mod.Page path={rest} />;
    else if (root === 'membres') page = rest[0] ? <MemberDetail id={rest[0]} /> : <MembersList />;
    else if (root === 'registre') page = <Audit />;
    else page = <Home />;
  }
  return (
    <>
      {page}
      {toast && <div class={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </>
  );
}

render(<App />, document.getElementById('app')!);
boot();
registerSW();
