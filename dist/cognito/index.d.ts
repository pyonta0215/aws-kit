import type { Jwks } from 'aws-jwt-verify/jwk';
export type AccessTokenFailure = 
/** トークンが渡されていない */
'missing'
/** 署名・期限・issuer・Client ID・token_use のどれかが合わない */
 | 'invalid'
/** 検証は通ったが、許可リストに sub が無い */
 | 'forbidden';
export type AccessTokenResult = {
    ok: true;
    sub: string;
    /** Cognito のアクセストークンが持つ `username`。無ければ undefined。 */
    username: string | undefined;
    claims: Readonly<Record<string, unknown>>;
} | {
    ok: false;
    reason: AccessTokenFailure;
};
export interface AccessTokenVerifier {
    verify(token: string | null | undefined): Promise<AccessTokenResult>;
}
export interface CognitoAccessTokenVerifierOptions {
    userPoolId: string;
    /** プロダクト専用の App Client ID。複数を受け付けるときは配列で渡す。 */
    clientId: string | readonly string[];
    /**
     * 通してよい sub。**渡した場合、空なら誰も通さない。**
     * 渡さなければ sub では絞らない（User Pool 側で利用者を制限している前提）。
     */
    allowedSubs?: Iterable<string>;
    /**
     * JWKS を取得せずに使う鍵。テストで合成した鍵を渡すためのもので、本番では渡さない。
     */
    jwks?: Jwks;
}
export declare function createCognitoAccessTokenVerifier(options: CognitoAccessTokenVerifierOptions): AccessTokenVerifier;
export interface CognitoEnvNames {
    userPoolId?: string;
    clientId?: string;
    /**
     * 許可リストを読む環境変数名。指定した場合、その変数が未設定・空なら誰も通さない。
     */
    allowedSubs?: string;
}
/**
 * 環境変数から検証器を作る。User Pool ID か Client ID が無ければ例外を投げる。
 * 設定漏れを「認証なしで動く」に倒さず、起動時に落とすため。
 */
export declare function createCognitoAccessTokenVerifierFromEnv(env?: Readonly<Record<string, string | undefined>>, names?: CognitoEnvNames, extra?: Pick<CognitoAccessTokenVerifierOptions, 'jwks'>): AccessTokenVerifier;
/** `sub-a, sub-b` のようなカンマ区切りを集合にする。空要素は捨てる。 */
export declare function parseAllowedSubs(raw: string | undefined): ReadonlySet<string>;
/** `Authorization: Bearer <token>` からトークンを取り出す。形式が違えば null。 */
export declare function extractBearerToken(header: string | null | undefined): string | null;
/** 失敗理由を HTTP ステータスへ。認証できないものは 401、権限が無いものは 403。 */
export declare function httpStatusFor(reason: AccessTokenFailure): 401 | 403;
