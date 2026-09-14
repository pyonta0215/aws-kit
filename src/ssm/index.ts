/**
 * SSM Parameter Store の SecureString を読む。
 *
 * API キーなどを CloudFormation や Lambda の環境変数へ保存せず、
 * 環境変数にはパラメータ名だけを置いて、使う瞬間に読むための道具。
 * 値はエラーメッセージにもログにも出さない。
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface SecureParameterReader {
  read(name: string): Promise<string>;
}

export type SecureParameterErrorKind =
  /** GetParameter が失敗した（権限・存在しない・スロットリングなど） */
  | 'request-failed'
  /** 値が空、またはパラメータが返ってこなかった */
  | 'empty'
  /** パラメータ名が空 */
  | 'invalid-name'
  /** パラメータ名は設定されているのに、読み出す reader が渡されていない */
  | 'no-reader';

export class SecureParameterError extends Error {
  readonly parameterName: string;
  readonly kind: SecureParameterErrorKind;
  /** kind が request-failed のときの SDK 例外名（例: AccessDeniedException） */
  readonly sdkErrorName: string | undefined;

  constructor(parameterName: string, kind: SecureParameterErrorKind, sdkErrorName?: string) {
    // パラメータ名は設定値であって秘密ではない。値や SDK のメッセージはここに入れない。
    super(`SecureString ${parameterName} を読めませんでした: ${sdkErrorName ?? kind}`);
    this.name = 'SecureParameterError';
    this.parameterName = parameterName;
    this.kind = kind;
    this.sdkErrorName = sdkErrorName;
  }
}

export interface SsmSecureParameterReaderOptions {
  client?: SSMClient;
  region?: string;
  /**
   * 読んだ値を覚えておく時間（ミリ秒）。既定は 0 で、毎回読む。
   * Lambda の実行環境が生きている間ずっと使い回すなら `Infinity`。
   */
  cacheTtlMs?: number;
  /** テスト用の時計 */
  now?: () => number;
}

export function createSsmSecureParameterReader(
  options: SsmSecureParameterReaderOptions = {},
): SecureParameterReader {
  let client = options.client;
  const ttl = options.cacheTtlMs ?? 0;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: Promise<string>; expiresAt: number }>();

  async function fetchValue(name: string): Promise<string> {
    client ??= new SSMClient(options.region ? { region: options.region } : {});
    let value: string | undefined;
    try {
      const response = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      value = response.Parameter?.Value;
    } catch (error) {
      // 失敗の種類だけを出す。復号・権限エラーのメッセージにリクエストを含めない。
      throw new SecureParameterError(name, 'request-failed', error instanceof Error ? error.name : 'UnknownError');
    }
    if (!value) throw new SecureParameterError(name, 'empty');
    return value;
  }

  return {
    read(name) {
      if (name.trim() === '') return Promise.reject(new SecureParameterError('(空)', 'invalid-name'));
      if (ttl <= 0) return fetchValue(name);

      const hit = cache.get(name);
      if (hit && hit.expiresAt > now()) return hit.value;

      // 同時に来た読み出しは1回の GetParameter にまとめる。失敗は覚えない。
      const value = fetchValue(name);
      cache.set(name, { value, expiresAt: now() + ttl });
      value.catch(() => {
        if (cache.get(name)?.value === value) cache.delete(name);
      });
      return value;
    },
  };
}

export interface SecretSource {
  /** SecureString のパラメータ名を持つ環境変数 */
  parameterVariable: string;
  /** 値そのものを持つ環境変数。ローカル開発用。 */
  valueVariable?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * パラメータ名が設定されていれば SSM から、無ければ値の環境変数から読む。どちらも無ければ undefined。
 *
 * 両方あるときはパラメータを優先する。パラメータ名を設定するのはデプロイ先だけなので、
 * 手元に残った古い環境変数がデプロイ先の秘密を上書きすることが無い。
 * パラメータ名があるのに reader が無いときも、値の環境変数へは逃げずに失敗する（kind: no-reader）。
 */
export async function resolveSecret(
  source: SecretSource,
  env: Env,
  reader?: SecureParameterReader,
): Promise<string | undefined> {
  const parameterName = env[source.parameterVariable]?.trim();
  if (parameterName) {
    if (!reader) throw new SecureParameterError(parameterName, 'no-reader');
    return reader.read(parameterName);
  }
  const value = source.valueVariable ? env[source.valueVariable] : undefined;
  return value === '' ? undefined : value;
}

/** {@link resolveSecret} と同じ。ただし、どちらも設定されていなければ例外を投げる。 */
export async function requireSecret(
  source: SecretSource,
  env: Env,
  reader?: SecureParameterReader,
): Promise<string> {
  const value = await resolveSecret(source, env, reader);
  if (value === undefined) {
    const names = [source.parameterVariable, source.valueVariable].filter(Boolean).join(' / ');
    throw new Error(`${names} のどちらも設定されていません`);
  }
  return value;
}
