import { describe, expect, it } from 'vitest';
import { defineConfig, describeConfig, findConfigDrift, findEnvReferences } from './index.js';

describe('defineConfig', () => {
  it('宣言をそのまま返す', () => {
    const schema = { API_KEY: { kind: 'secret' } } as const;
    expect(defineConfig(schema)).toBe(schema);
  });

  it('環境変数名として不正な名前を拒む', () => {
    expect(() => defineConfig({ apiKey: { kind: 'secret' } })).toThrow('apiKey');
  });

  it('未知の kind を拒む', () => {
    expect(() => defineConfig({ API_KEY: { kind: 'important' as never } })).toThrow('API_KEY');
  });
});

describe('findEnvReferences', () => {
  it('よく使われる読み方を拾う', () => {
    const source = [
      'const a = process.env.TABLE_NAME;',
      "const b = process.env['BUCKET'];",
      'const c = import.meta.env.VITE_API_BASE_URL;',
      'const d = environment.GITHUB_APP_ID;',
      'const e = env["REGION"] ?? env.REGION;',
    ].join('\n');
    expect(findEnvReferences(source)).toEqual(['BUCKET', 'GITHUB_APP_ID', 'REGION', 'TABLE_NAME', 'VITE_API_BASE_URL']);
  });

  it('環境変数でないプロパティや小文字の名前は拾わない', () => {
    const source = 'config.TABLE_NAME; process.env.lowercase; myenv.TABLE; environment.name;';
    expect(findEnvReferences(source)).toEqual([]);
  });

  it('分割代入は拾えない（宣言側で持つ前提）', () => {
    expect(findEnvReferences('const { TABLE_NAME } = process.env;')).toEqual([]);
  });
});

describe('findConfigDrift', () => {
  const schema = defineConfig({
    TABLE_NAME: { kind: 'wiring' },
    KEY_PARAMETER: { kind: 'secret-ref' },
    LEFTOVER: { kind: 'cost' },
  });

  it('宣言漏れと取り残しを返す', () => {
    const sources = ['process.env.TABLE_NAME; process.env.NEW_FLAG;', "resolve({ parameterVariable: 'KEY_PARAMETER' });"];
    expect(findConfigDrift(schema, sources)).toEqual({ undeclared: ['NEW_FLAG'], unused: ['LEFTOVER'] });
  });

  it('名前の一部が一致しただけでは使用とみなさない', () => {
    const sources = ['process.env.TABLE_NAME; KEY_PARAMETER; LEFTOVER_2;'];
    expect(findConfigDrift(schema, sources).unused).toEqual(['LEFTOVER']);
  });
});

describe('describeConfig', () => {
  it('注意の順に並べ、設定の有無だけを返す', () => {
    const schema = defineConfig({
      PORT: { kind: 'local' },
      TABLE_NAME: { kind: 'wiring' },
      API_KEY: { kind: 'secret', note: 'ローカル開発用' },
      MODEL_ID: { kind: 'cost' },
    });
    const rows = describeConfig(schema, { API_KEY: 'sk-should-not-appear', TABLE_NAME: '', MODEL_ID: 'm' });
    expect(rows).toEqual([
      { name: 'API_KEY', kind: 'secret', note: 'ローカル開発用', set: true },
      { name: 'MODEL_ID', kind: 'cost', note: undefined, set: true },
      { name: 'TABLE_NAME', kind: 'wiring', note: undefined, set: false },
      { name: 'PORT', kind: 'local', note: undefined, set: false },
    ]);
    expect(JSON.stringify(rows)).not.toContain('sk-should-not-appear');
  });
});
