// Ask questions in the terminal, optionally without showing what is typed (for passwords and secrets).
let buffer = '', listening = false;
const waiting = [];

function drain() {
  while (waiting.length) {
    const i = buffer.search(/[\r\n]/);
    if (i < 0) return;
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1).replace(/^\n/, '');
    process.stdout.write('\n');
    waiting.shift()(line);
  }
}

export function ask(question, { hidden = true } = {}) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    waiting.push(resolve);
    if (!listening) {
      listening = true;
      process.stdin.setRawMode?.(true);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        for (const c of chunk) {
          if (c === '\u0003') { process.stdin.setRawMode?.(false); process.stdout.write('\nCancelled. Nothing was changed.\n'); process.exit(1); } // Ctrl-C
          if (c === '\u007f' || c === '\b') { if (buffer.length) process.stdout.write('\b \b'); buffer = buffer.slice(0, -1); continue; } // Backspace
          if (c === '\u001b') continue;                                                          // ignore escape codes from pasting
          // show a dot for each hidden character, so you can see that typing or pasting worked
          if (c !== '\r' && c !== '\n' && process.stdin.isTTY) process.stdout.write(hidden ? '•' : c);
          buffer += c;
        }
        drain();
      });
      process.stdin.resume();
    }
    drain();
  });
}

export function done() {
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
}
