// Shared mutable state. Objects are mutated in place so every module sees updates.
export const VIM = '__cosense_vim__';

export const state = {
  mode: 'normal',        // normal | insert | visual | visual-line
  yankReg: '',
  yankType: 'line',      // line | char
  vlStart: -1,           // anchor line of visual-line mode
  cmdBuf: '',            // pending count / operator / motion keys
  cmdLine: false,        // command line is open
  pending: null,         // { type: 'r'|'m'|"'"|'`'|'obj'|'find', count, kind } waiting for one more key
};

export const rt = {
  active: false,         // vim core is set up
  passthrough: false,    // our own synthetic events are in flight
  roLift: 0,             // >0 while readOnly is temporarily lifted
  busy: 0,               // async commands in flight
  busyTimer: 0,
  navPending: null,      // CTRL-O / CTRL-I waiting for page:changed
  pendingMark: null,     // uppercase mark jump waiting for page:changed
  replaying: false,      // "." replay in progress (don't record)
  project: '',
};

export const queue = [];  // keys typed while an async command runs (replayed in order)
