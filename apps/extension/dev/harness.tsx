// Dev harness: mounts Audion into a Shadow root on the fake-meet page, exactly as the content script does,
// but without the extension runtime (storage falls back to localStorage). For fast UI iteration and for
// checking real-browser behaviour. Build with: pnpm --filter @audion/extension harness
import ui from '@audion/ui/styles.css?inline';
import { createRoot } from 'react-dom/client';
import { AudionApp } from '../src/panel/AudionApp';
import panel from '../src/panel/panel.css?inline';

const host = document.createElement('div');
document.body.append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = ui + panel;
shadow.append(style);
const container = document.createElement('div');
shadow.append(container);
for (const type of ['keydown', 'keyup', 'keypress'])
  host.addEventListener(type, (e) => e.stopPropagation());

createRoot(container).render(<AudionApp portalContainer={container} alwaysShow />);
