/**
 * Cognito User Pool が発行したアクセストークンを検証する。
 *
 * 署名・issuer・期限・`token_use=access`・Client ID の検証は aws-jwt-verify に任せ、
 * 自前で JWT を扱わない。このモジュールが足すのは次の3つだけ。
 *
 * - 失敗を例外でなく値で返す（401 と 403 を呼び出し側で分けられるように）
 * - sub の許可リスト。User Pool を複数プロダクトで共有していると、
 *   「検証が通った」は「このプロダクトを使ってよい」を意味しない
 * - 設定漏れで黙って開かない（fail-closed）
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
export function createCognitoAccessTokenVerifier(options) {
    const clientIds = typeof options.clientId === 'string' ? [options.clientId] : [...options.clientId];
    if (options.userPoolId.trim() === '' || clientIds.length === 0 || clientIds.some((id) => id.trim() === '')) {
        throw new Error('userPoolId と clientId は空にできません');
    }
    const verifier = CognitoJwtVerifier.create({
        userPoolId: options.userPoolId,
        tokenUse: 'access',
        clientId: clientIds,
    });
    if (options.jwks)
        verifier.cacheJwks(options.jwks);
    const allowed = options.allowedSubs === undefined ? undefined : new Set(options.allowedSubs);
    return {
        async verify(token) {
            const raw = token?.trim() ?? '';
            if (raw === '')
                return { ok: false, reason: 'missing' };
            let claims;
            try {
                claims = (await verifier.verify(raw));
            }
            catch {
                // 理由（期限切れ・別プール・署名不一致など）はクライアントへ返さない。
                return { ok: false, reason: 'invalid' };
            }
            const sub = claims.sub;
            if (typeof sub !== 'string' || sub === '')
                return { ok: false, reason: 'invalid' };
            if (allowed !== undefined && !allowed.has(sub))
                return { ok: false, reason: 'forbidden' };
            const username = typeof claims.username === 'string' ? claims.username : undefined;
            return { ok: true, sub, username, claims };
        },
    };
}
/**
 * 環境変数から検証器を作る。User Pool ID か Client ID が無ければ例外を投げる。
 * 設定漏れを「認証なしで動く」に倒さず、起動時に落とすため。
 */
export function createCognitoAccessTokenVerifierFromEnv(env = process.env, names = {}, extra = {}) {
    const poolVar = names.userPoolId ?? 'COGNITO_USER_POOL_ID';
    const clientVar = names.clientId ?? 'COGNITO_CLIENT_ID';
    const userPoolId = env[poolVar]?.trim();
    const clientId = env[clientVar]?.trim();
    if (!userPoolId || !clientId) {
        throw new Error(`${poolVar} と ${clientVar} が必要です`);
    }
    return createCognitoAccessTokenVerifier({
        userPoolId,
        clientId,
        ...(names.allowedSubs === undefined ? {} : { allowedSubs: parseAllowedSubs(env[names.allowedSubs]) }),
        ...extra,
    });
}
/** `sub-a, sub-b` のようなカンマ区切りを集合にする。空要素は捨てる。 */
export function parseAllowedSubs(raw) {
    return new Set((raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== ''));
}
/** `Authorization: Bearer <token>` からトークンを取り出す。形式が違えば null。 */
export function extractBearerToken(header) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
    return match?.[1] ?? null;
}
/** 失敗理由を HTTP ステータスへ。認証できないものは 401、権限が無いものは 403。 */
export function httpStatusFor(reason) {
    return reason === 'forbidden' ? 403 : 401;
}
