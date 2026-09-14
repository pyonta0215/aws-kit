/**
 * SSM Parameter Store の SecureString を読む。
 *
 * API キーなどを CloudFormation や Lambda の環境変数へ保存せず、
 * 環境変数にはパラメータ名だけを置いて、使う瞬間に読むための道具。
 * 値はエラーメッセージにもログにも出さない。
 */
import { SSMClient } from '@aws-sdk/client-ssm';
export interface SecureParameterReader {
    read(name: string): Promise<string>;
}
export declare class SecureParameterError extends Error {
    readonly parameterName: string;
    constructor(parameterName: string, reason: string);
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
export declare function createSsmSecureParameterReader(options?: SsmSecureParameterReaderOptions): SecureParameterReader;
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
 */
export declare function resolveSecret(source: SecretSource, env: Env, reader: SecureParameterReader): Promise<string | undefined>;
/** {@link resolveSecret} と同じ。ただし、どちらも設定されていなければ例外を投げる。 */
export declare function requireSecret(source: SecretSource, env: Env, reader: SecureParameterReader): Promise<string>;
export {};
