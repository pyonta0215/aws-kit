/**
 * SSM Parameter Store の SecureString を読む。
 *
 * API キーなどを CloudFormation や Lambda の環境変数へ保存せず、
 * 環境変数にはパラメータ名だけを置いて、使う瞬間に読むための道具。
 * 値はエラーメッセージにもログにも出さない。
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
export class SecureParameterError extends Error {
    parameterName;
    kind;
    /** kind が request-failed のときの SDK 例外名（例: AccessDeniedException） */
    sdkErrorName;
    constructor(parameterName, kind, sdkErrorName) {
        // パラメータ名は設定値であって秘密ではない。値や SDK のメッセージはここに入れない。
        super(`SecureString ${parameterName} を読めませんでした: ${sdkErrorName ?? kind}`);
        this.name = 'SecureParameterError';
        this.parameterName = parameterName;
        this.kind = kind;
        this.sdkErrorName = sdkErrorName;
    }
}
export function createSsmSecureParameterReader(options = {}) {
    let client = options.client;
    const ttl = options.cacheTtlMs ?? 0;
    const now = options.now ?? Date.now;
    const cache = new Map();
    async function fetchValue(name) {
        client ??= new SSMClient(options.region ? { region: options.region } : {});
        let value;
        try {
            const response = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
            value = response.Parameter?.Value;
        }
        catch (error) {
            // 失敗の種類だけを出す。復号・権限エラーのメッセージにリクエストを含めない。
            throw new SecureParameterError(name, 'request-failed', error instanceof Error ? error.name : 'UnknownError');
        }
        if (!value)
            throw new SecureParameterError(name, 'empty');
        return value;
    }
    return {
        read(name) {
            if (name.trim() === '')
                return Promise.reject(new SecureParameterError('(空)', 'invalid-name'));
            if (ttl <= 0)
                return fetchValue(name);
            const hit = cache.get(name);
            if (hit && hit.expiresAt > now())
                return hit.value;
            // 同時に来た読み出しは1回の GetParameter にまとめる。失敗は覚えない。
            const value = fetchValue(name);
            cache.set(name, { value, expiresAt: now() + ttl });
            value.catch(() => {
                if (cache.get(name)?.value === value)
                    cache.delete(name);
            });
            return value;
        },
    };
}
/**
 * パラメータ名が設定されていれば SSM から、無ければ値の環境変数から読む。どちらも無ければ undefined。
 *
 * 両方あるときはパラメータを優先する。パラメータ名を設定するのはデプロイ先だけなので、
 * 手元に残った古い環境変数がデプロイ先の秘密を上書きすることが無い。
 * パラメータ名があるのに reader が無いときも、値の環境変数へは逃げずに失敗する（kind: no-reader）。
 */
export async function resolveSecret(source, env, reader) {
    const parameterName = env[source.parameterVariable]?.trim();
    if (parameterName) {
        if (!reader)
            throw new SecureParameterError(parameterName, 'no-reader');
        return reader.read(parameterName);
    }
    const value = source.valueVariable ? env[source.valueVariable] : undefined;
    return value === '' ? undefined : value;
}
/** {@link resolveSecret} と同じ。ただし、どちらも設定されていなければ例外を投げる。 */
export async function requireSecret(source, env, reader) {
    const value = await resolveSecret(source, env, reader);
    if (value === undefined) {
        const names = [source.parameterVariable, source.valueVariable].filter(Boolean).join(' / ');
        throw new Error(`${names} のどちらも設定されていません`);
    }
    return value;
}
