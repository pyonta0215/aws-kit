import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSsmSecureParameterReader,
  requireSecret,
  resolveSecret,
  SecureParameterError,
  type SecureParameterReader,
} from './index.js';

const ssm = mockClient(SSMClient);
const client = new SSMClient({ region: 'us-east-1' });

beforeEach(() => ssm.reset());

describe('createSsmSecureParameterReader', () => {
  it('復号して値を返す', async () => {
    ssm.on(GetParameterCommand, { Name: '/app/key', WithDecryption: true }).resolves({ Parameter: { Value: 'v1' } });
    await expect(createSsmSecureParameterReader({ client }).read('/app/key')).resolves.toBe('v1');
  });

  it('既定ではキャッシュしない', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: 'v1' } });
    const reader = createSsmSecureParameterReader({ client });
    await reader.read('/app/key');
    await reader.read('/app/key');
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(2);
  });

  it('cacheTtlMs の間は使い回し、切れたら読み直す', async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: 'old' } }).resolves({ Parameter: { Value: 'new' } });
    let now = 0;
    const reader = createSsmSecureParameterReader({ client, cacheTtlMs: 1000, now: () => now });
    const [a, b] = await Promise.all([reader.read('/k'), reader.read('/k')]);
    expect([a, b]).toEqual(['old', 'old']);
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(1);
    now = 1001;
    await expect(reader.read('/k')).resolves.toBe('new');
  });

  it('失敗はキャッシュしない', async () => {
    ssm.on(GetParameterCommand).rejectsOnce(Object.assign(new Error('boom'), { name: 'ThrottlingException' })).resolves({
      Parameter: { Value: 'ok' },
    });
    const reader = createSsmSecureParameterReader({ client, cacheTtlMs: Infinity });
    await expect(reader.read('/k')).rejects.toThrow(SecureParameterError);
    await expect(reader.read('/k')).resolves.toBe('ok');
  });

  it('エラーには失敗の種類だけを出し、元のメッセージを含めない', async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error('detail-with-request-body'), { name: 'AccessDeniedException' }));
    const error = await createSsmSecureParameterReader({ client }).read('/k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecureParameterError);
    expect((error as Error).message).toContain('AccessDeniedException');
    expect((error as Error).message).not.toContain('detail-with-request-body');
  });

  it('空の値は失敗', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: '' } });
    await expect(createSsmSecureParameterReader({ client }).read('/k')).rejects.toThrow('値が空');
  });
});

describe('resolveSecret / requireSecret', () => {
  const reader: SecureParameterReader = { read: async (name) => `from-ssm:${name}` };
  const source = { parameterVariable: 'API_KEY_PARAMETER', valueVariable: 'API_KEY' };

  it('パラメータ名があれば値の環境変数より優先する', async () => {
    await expect(resolveSecret(source, { API_KEY_PARAMETER: '/k', API_KEY: 'local' }, reader)).resolves.toBe(
      'from-ssm:/k',
    );
  });

  it('パラメータ名が無ければ値の環境変数を使う', async () => {
    await expect(resolveSecret(source, { API_KEY: 'local' }, reader)).resolves.toBe('local');
  });

  it('どちらも無ければ undefined、require なら例外', async () => {
    await expect(resolveSecret(source, { API_KEY: '' }, reader)).resolves.toBeUndefined();
    await expect(requireSecret(source, {}, reader)).rejects.toThrow('API_KEY_PARAMETER / API_KEY');
  });
});
