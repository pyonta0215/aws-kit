import type { Jwks } from 'aws-jwt-verify/jwk';
export interface TestTokenIssuerOptions {
    /** 例: `us-east-1_Example1`。実在の User Pool ID を使わない。 */
    userPoolId: string;
    clientId: string;
}
export interface TestTokenIssuer {
    /** 検証器の `jwks` オプションに渡す公開鍵 */
    readonly jwks: Jwks;
    readonly issuer: string;
    /**
     * 有効なアクセストークンを発行する。`claims` で任意の項目を上書きできる
     * （`exp` を過去にする、`token_use: 'id'` にする、など）。
     */
    accessToken(claims?: Record<string, unknown>): string;
}
export declare function createTestTokenIssuer(options: TestTokenIssuerOptions): TestTokenIssuer;
