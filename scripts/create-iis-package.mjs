throw new Error(
  'The legacy combined IIS packager was retired because it copied live .env/storage, '
  + 'mixed frontend and server artifacts, and could rename a non-Windows Node executable to node.exe. '
  + 'Run npm run package:iis-server-only and transfer the two frontend dist folders separately.',
);
