// Imitates the parts of Meet that Audion touches: control bar, self tile, captions, chat box,
// and a getUserMedia call so the voice-injection path can be exercised without a real call.
const $ = (id) => document.getElementById(id);
let stream;

$('join').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    console.warn('fake-meet: getUserMedia failed', e);
    return;
  }
  $('selfVideo').srcObject = stream;
  $('selfVideo').style.display = 'block';
  $('selfAvatar').hidden = true;
  $('join').hidden = true;
  $('leave').hidden = false;
  meter(stream);
});

$('leave').addEventListener('click', () => {
  // Like Meet: stay on the page and show a "left" screen (no reload), so end-of-call UI can appear.
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  $('selfVideo').srcObject = null;
  $('leave').hidden = true;
  $('join').hidden = false;
  $('join').textContent = 'Rejoin';
  document.title = 'Fake Meet (left)';
});

function toggle(btn, onLabel, offLabel, cb) {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? onLabel : offLabel);
    cb?.(on);
  });
}
toggle($('mic'), 'Turn off microphone', 'Turn on microphone', (on) =>
  stream?.getAudioTracks().forEach((t) => (t.enabled = on)),
);
toggle($('cam'), 'Turn off camera', 'Turn on camera', (on) =>
  stream?.getVideoTracks().forEach((t) => (t.enabled = on)),
);
toggle($('cc'), 'Turn off captions', 'Turn on captions', (on) => ($('captions').hidden = !on));
$('cc').setAttribute('aria-pressed', 'false');
$('cc').setAttribute('aria-label', 'Turn on captions');
toggle($('chatBtn'), 'Close chat', 'Chat with everyone', (on) => ($('chat').hidden = !on));
$('chatBtn').setAttribute('aria-pressed', 'false');
$('chatBtn').setAttribute('aria-label', 'Chat with everyone');

$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  const li = document.createElement('li');
  li.textContent = `You: ${text}`;
  $('chatLog').append(li);
  $('chatInput').value = '';
});

// Level meter on the outgoing audio track: shows what the other participants would hear.
function meter(s) {
  if (!s.getAudioTracks().length) return;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const bar = document.querySelector('#micMeter i');
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    bar.style.width = `${Math.min(100, (peak / 128) * 100 * 2)}%`;
    requestAnimationFrame(tick);
  };
  tick();
}
