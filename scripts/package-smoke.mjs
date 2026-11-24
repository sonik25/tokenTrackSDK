import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = resolve(tmpdir());
const consumer = mkdtempSync(join(tempRoot, 'tokentrack-smoke-'));
const packages = {
  core: 'MemoryStorage',
  openai: 'OpenAIChatWrapper',
  anthropic: 'AnthropicMessagesWrapper',
  gemini: 'GeminiModelsWrapper',
};
const run = (file, args, cwd = consumer) => execFileSync(file, args, { cwd, stdio: 'inherit' });
const pnpm = process.env.npm_execpath;

try {
  assert.ok(pnpm, 'Run via pnpm package:smoke');
  const installs = join(consumer, 'node_modules');
  for (const [name, exported] of Object.entries(packages)) {
    const source = join(root, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    run(process.execPath, [pnpm, 'pack', '--pack-destination', consumer], source);
    const install = join(installs, '@tokentrack', name);
    mkdirSync(install, { recursive: true });
    run('tar', [
      '-xzf',
      join(consumer, `tokentrack-${name}-${manifest.version}.tgz`),
      '--strip-components',
      '1',
      '-C',
      install,
    ]);
    for (const artifact of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
      assert.ok(existsSync(join(install, 'dist', artifact)), `${name}: missing ${artifact}`);
    }
    const packed = JSON.parse(readFileSync(join(install, 'package.json'), 'utf8'));
    assert.equal(packed.name, `@tokentrack/${name}`);
    if (name !== 'core') {
      const core = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
      assert.equal(packed.dependencies['@tokentrack/core'], core.version);
    }
    for (const dependency of Object.keys(packed.dependencies ?? {})) {
      if (dependency === '@tokentrack/core') continue;
      assert.ok(!packed.dependencies[dependency].startsWith('workspace:'));
      const target = join(installs, dependency);
      mkdirSync(dirname(target), { recursive: true });
      if (!existsSync(target)) {
        symlinkSync(realpathSync(join(source, 'node_modules', dependency)), target, 'junction');
      }
    }
    const code = `if (typeof ${exported} !== 'function') throw new Error('${name} failed to load');`;
    for (const [extension, declaration] of [
      ['mjs', 'mts'],
      ['cjs', 'cts'],
    ]) {
      const module = `@tokentrack/${name}`;
      const esm = extension === 'mjs';
      writeFileSync(
        join(consumer, `${name}.${extension}`),
        `${esm ? `import { ${exported} } from '${module}';` : `const { ${exported} } = require('${module}');`}\n${code}\n`,
      );
      writeFileSync(
        join(consumer, `${name}.${declaration}`),
        `${esm ? `import { ${exported} } from '${module}';` : `import sdk = require('${module}');\nconst { ${exported} } = sdk;`}\n${code}\n`,
      );
    }
  }

  for (const name of Object.keys(packages)) {
    run(process.execPath, [`${name}.mjs`]);
    run(process.execPath, [`${name}.cjs`]);
  }
  const entrypoints = Object.keys(packages).flatMap((name) => [`${name}.mts`, `${name}.cts`]);
  run(process.execPath, [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--module',
    'NodeNext',
    '--strict',
    '--noEmit',
    '--typeRoots',
    join(root, 'node_modules/@types'),
    '--types',
    'node',
    ...entrypoints,
  ]);
  run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--module',
      'NodeNext',
      '--strict',
      '--noEmit',
      '--types',
      'node',
      ...readdirSync(join(root, 'examples'))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join('examples', name)),
    ],
    root,
  );
} finally {
  assert.equal(dirname(resolve(consumer)), tempRoot);
  assert.ok(basename(consumer).startsWith('tokentrack-smoke-'));
  rmSync(consumer, { recursive: true, force: true });
}
