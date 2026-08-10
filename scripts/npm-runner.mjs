import fs from 'node:fs';

function quoteForCmd(value) {
  const text = String(value ?? '');
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Resolve an npm invocation without spawning npm.cmd directly.
 * Node 24 on Windows can throw EINVAL when child_process.spawn() targets a .cmd
 * shim with shell:false. When running under npm we already know the real
 * npm-cli.js path via npm_execpath, so invoke it with the current Node binary.
 */
export function resolveNpmInvocation(args = []) {
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
      shell: false,
      description: `node ${npmExecPath} ${args.join(' ')}`,
    };
  }

  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `npm ${args.map(quoteForCmd).join(' ')}`],
      shell: false,
      description: `cmd.exe /c npm ${args.join(' ')}`,
    };
  }

  return {
    command: 'npm',
    args,
    shell: false,
    description: `npm ${args.join(' ')}`,
  };
}
